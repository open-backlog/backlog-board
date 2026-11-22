import { readFileSync, watch, writeFileSync } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

import {
  addComment, addItem, BacklogError, buildTree, changes, commit, isStoryLevel, listItems, loadBacklog, message, moveItem,
  progressOf, recentlyDone, showItem, updateItem, validateDir,
} from 'open-backlog';
import type { Backlog, FieldValue, Item, ListFilters, Node, Progress, Status } from 'open-backlog';

/**
 * The board's JSON API (2.4.2): HTTP in front of open-backlog, the same functions the ob command
 * calls, so the board and the CLI can't disagree (D1). Every change is one commit of only the
 * files it touched (D3), and a file with changes you haven't committed is never swept into one.
 * Changes run one at a time. /api/events tells the browser when anything in the backlog folder
 * changes, from the board or from an editor.
 *
 *   GET    /api/items?status=&type=&parent=&repo=&assignee=&sprint=&all=1   as ob list --json
 *   GET    /api/items/:id                                                    as ob show --json
 *   GET    /api/tree?all=1                                                   as ob tree --json
 *   GET    /api/validate                                                     as ob validate --json
 *   GET    /api/events                                                       server-sent events
 *   POST   /api/items                 { type, title, parent?, slug? }        as ob new
 *   POST   /api/items/:id/move        { status }                             as ob move
 *   PATCH  /api/items/:id             { fields: { name: value | null } }     an edit, one commit
 *   POST   /api/items/:id/comments    { text, handle? }                      as ob comment
 */

const STATUSES: readonly Status[] = ['todo', 'doing', 'done'];
const DONE_DAYS = 30;

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface ApiOptions {
  backlogDir: string;
  /** Commit each change (default true); false leaves committing to you (ob serve --no-commit). */
  commit: boolean;
}

/** One item as lists show it: what a card needs, and its fields. */
export interface ItemOut {
  id: string;
  type: string;
  title: string;
  status: Status | null;
  parent: string | null;
  path: string;
  fields: Record<string, unknown>;
}

export interface TreeOut {
  id: string;
  type: string;
  title: string;
  status: Status | null;
  path: string;
  progress: Progress | null;
  children: TreeOut[];
}

const itemOut = (i: Item): ItemOut => ({ id: i.id, type: i.type, title: i.title, status: i.status ?? null, parent: i.parent ?? null, path: i.path, fields: i.fields });

export function createApi(opts: ApiOptions) {
  const { backlogDir } = opts;
  const load = () => loadBacklog(backlogDir);
  let queue: Promise<unknown> = Promise.resolve();
  /** Changes one at a time, so two clicks can't race in git. */
  const serial = <T>(fn: () => T): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  };

  function one(b: Backlog, id: string): Item {
    const found = b.items.filter(i => i.id === id);
    if (!found[0]) throw new ApiError(404, `no item ${id} in this backlog`);
    if (found.length > 1) throw new ApiError(409, `${found.length} items have id ${id} (${found.map(i => i.path).join(', ')}); run ob validate --fix first`);
    return found[0];
  }

  /** A file with your own uncommitted changes would be swept into the board's commit: refuse. */
  function mustBeClean(item: Item): void {
    if (opts.commit && changes(backlogDir, [join(backlogDir, item.path)]).length) {
      throw new ApiError(409, `${item.path} has changes that aren't committed; commit or undo them first`);
    }
  }

  const list = (q: URLSearchParams) => {
    const filters: ListFilters = {};
    for (const key of ['status', 'type', 'parent', 'repo', 'assignee', 'sprint'] as const) {
      const v = q.getAll(key).flatMap(s => s.split(',')).map(s => s.trim()).filter(Boolean);
      if (v.length) filters[key] = v;
    }
    const r = listItems(load(), filters, { all: q.get('all') === '1', days: DONE_DAYS });
    return { items: r.items.map(itemOut), hiddenDone: r.hiddenDone };
  };

  /** The tree as ob tree --json gives it, from the same core functions. */
  const tree = (q: URLSearchParams): TreeOut[] => {
    const b = load();
    const recent = q.get('all') === '1' ? null : recentlyDone(b, new Date(Date.now() - DONE_DAYS * 86_400_000));
    const visible = (n: Node) => n.item.status !== 'done' || !recent || recent.has(n.item.path);
    const out = (n: Node): TreeOut => {
      const story = isStoryLevel(n.item);
      const p = story ? null : progressOf(n);
      return {
        id: n.item.id, type: n.item.type, title: n.item.title, status: story ? n.item.status ?? null : p?.status ?? null,
        path: n.item.path, progress: p, children: n.children.filter(visible).map(out),
      };
    };
    return buildTree(b.items).roots.filter(visible).map(out);
  };

  const validation = () => {
    const { backlog, problems } = validateDir(backlogDir);
    const errors = problems.filter(p => p.severity === 'error').length;
    return { backlog: backlog?.dir ?? backlogDir, valid: errors === 0, errors, warnings: problems.length - errors, problems };
  };

  const create = (body: Record<string, unknown>) => serial(() => {
    const r = addItem(load(), {
      type: text(body, 'type'), title: text(body, 'title'),
      ...(body['parent'] != null ? { parent: text(body, 'parent') } : {}),
      ...(body['slug'] != null ? { slug: text(body, 'slug') } : {}),
      commit: opts.commit,
    });
    return r;
  });

  const move = (id: string, body: Record<string, unknown>) => serial(() => {
    const status = text(body, 'status') as Status;
    if (!STATUSES.includes(status)) throw new ApiError(400, `"${status}" is not a status: use todo, doing or done`);
    const b = load();
    const item = one(b, id);
    if (!isStoryLevel(item)) throw new ApiError(400, `${id} is ${item.type === 'epic' ? 'an' : 'a'} ${item.type}, which doesn't move: its status comes from its items`);
    if (item.status === status) return { path: item.path, committed: false };
    mustBeClean(item);
    return moveItem(b, item, status, { commit: opts.commit });
  });

  /**
   * Changes front-matter fields (null removes one). If the change gives the item a problem
   * ob validate reports, the file is put back and the problem is the answer.
   */
  const update = (id: string, body: Record<string, unknown>) => serial(() => {
    const fields = body['fields'];
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new ApiError(400, 'send { "fields": { "name": value } }; null removes a field');
    const b = load();
    const item = one(b, id);
    const changes_: Record<string, FieldValue | undefined> = {};
    for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
      if (v === null) changes_[k] = undefined;
      else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || (Array.isArray(v) && v.every(x => typeof x === 'string'))) changes_[k] = v as FieldValue;
      else throw new ApiError(400, `${k}: a field is text, a number, true or false, or a list of text`);
    }
    mustBeClean(item);
    const path = join(backlogDir, item.path);
    const before = new Set(validateDir(backlogDir).problems.filter(p => p.path === item.path).map(p => `${p.code} ${p.message}`));
    const original = readText(path);
    const changed = updateItem(backlogDir, item, changes_);
    if (!changed) return { path: item.path, changed: false, committed: false };
    const added = validateDir(backlogDir).problems.filter(p => p.path === item.path && p.severity === 'error' && !before.has(`${p.code} ${p.message}`));
    if (added.length) {
      writeText(path, original);
      throw new ApiError(400, added.map(p => `${p.code} [${p.rule}] ${p.message}. Fix: ${p.fix}.`).join(' '));
    }
    const committed = opts.commit ? commit([path], message.edit(id, Object.keys(changes_).join(', '))) : false;
    return { path: item.path, changed: true, committed };
  });

  const comment = (id: string, body: Record<string, unknown>) => serial(() => {
    one(load(), id);
    return addComment(load(), id, {
      text: text(body, 'text'),
      ...(body['handle'] != null ? { handle: text(body, 'handle') } : {}),
      commit: opts.commit,
    });
  });

  return { list, tree, validation, create, move, update, comment, show: (id: string) => { one(load(), id); return showItem(load(), id); } };
}

export type Api = ReturnType<typeof createApi>;

function text(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (typeof v !== 'string') throw new ApiError(400, `${key} is missing, or isn't text`);
  return v;
}

/* Reading and writing the one file an update may have to put back; everything else is open-backlog's. */
const readText = (p: string) => readFileSync(p, 'utf8');
const writeText = (p: string, t: string) => writeFileSync(p, t);

/** Routes /api/… requests to the API; returns false for anything else. */
export async function route(api: Api, req: IncomingMessage, path: string, raw: Buffer, send: (status: number, body: unknown) => void): Promise<boolean> {
  const m = /^\/api\/items(?:\/([^/]+))?(?:\/(move|comments))?$/.exec(path);
  const q = new URL(req.url ?? '/', 'http://x').searchParams;
  const method = req.method ?? 'GET';
  try {
    if (path === '/api/tree' && method === 'GET') send(200, api.tree(q));
    else if (path === '/api/validate' && method === 'GET') send(200, api.validation());
    else if (m && !m[1] && method === 'GET') send(200, api.list(q));
    else if (m && !m[1] && method === 'POST') send(201, await api.create(json(raw)));
    else if (m?.[1] && !m[2] && method === 'GET') send(200, api.show(decodeURIComponent(m[1])));
    else if (m?.[1] && !m[2] && method === 'PATCH') send(200, await api.update(decodeURIComponent(m[1]), json(raw)));
    else if (m?.[1] && m[2] === 'move' && method === 'POST') send(200, await api.move(decodeURIComponent(m[1]), json(raw)));
    else if (m?.[1] && m[2] === 'comments' && method === 'POST') send(201, await api.comment(decodeURIComponent(m[1]), json(raw)));
    else if (m || path === '/api/tree' || path === '/api/validate') send(405, { error: `${method} is not allowed on ${path}` });
    else return false;
  } catch (e) {
    if (e instanceof ApiError) send(e.status, { error: e.message });
    else if (e instanceof BacklogError) send(/^no item /.test(e.message) ? 404 : 400, { error: e.message });
    else throw e;
  }
  return true;
}

/** A request's whole body, at most 1 MB. */
export async function readBody(req: IncomingMessage): Promise<Buffer> {
  let size = 0;
  const parts: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new ApiError(413, 'the request is too large');
    parts.push(chunk as Buffer);
  }
  return Buffer.concat(parts);
}

/** A JSON object body. */
function json(raw: Buffer): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(raw.toString('utf8') || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
    return v as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'the request body must be a JSON object');
  }
}

/**
 * Server-sent events: "change" (with the paths, from the backlog folder) whenever a file in it
 * changes, from the board or an editor; a quiet ": ping" every 15 s keeps the stream open.
 */
export function createEvents(backlogDir: string) {
  const clients = new Set<ServerResponse>();
  let pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  const flush = () => {
    timer = null;
    const paths = [...pending].sort();
    pending = new Set();
    for (const c of clients) c.write(`event: change\ndata: ${JSON.stringify({ paths })}\n\n`);
  };
  const watcher: FSWatcher = watch(backlogDir, { recursive: true }, (_event, file) => {
    pending.add(String(file ?? '').split('\\').join('/'));
    // Changes that come together (a git mv, an editor's save) are sent once, 50 ms later.
    timer ??= setTimeout(flush, 50);
  });
  const ping = setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 15_000);
  ping.unref();
  return {
    open(res: ServerResponse): void {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
      res.write(': connected\n\n');
      clients.add(res);
      res.on('close', () => clients.delete(res));
    },
    close(): void {
      watcher.close();
      clearInterval(ping);
      if (timer) clearTimeout(timer);
      for (const c of clients) c.end();
      clients.clear();
    },
  };
}
