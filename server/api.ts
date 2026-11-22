import { readFileSync, watch, writeFileSync } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

import {
  addComment, addItem, BacklogError, buildOrder, buildTree, changes, columnOrder, commit, isStoryLevel, listItems, loadBacklog, message,
  moveItem, progressOf, recentlyDone, reposOf, showItem, STORY_LEVEL_TYPES, updateItem, validateDir,
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
 *   GET    /api/board?parent=&repo=&type=&all=1                              the columns, in column order
 *   GET    /api/tree?all=1                                                   as ob tree --json
 *   GET    /api/validate                                                     as ob validate --json
 *   GET    /api/events                                                       server-sent events
 *   POST   /api/items                 { type, title, parent?, slug? }        as ob new
 *   POST   /api/items/:id/move        { status }                             as ob move
 *   PATCH  /api/items/:id             { fields?: { name: value | null }, description? }   an edit, one commit
 *   POST   /api/items/:id/comments    { text, handle? }                      as ob comment
 *   POST   /api/items/:id/rank        { after: id | null }                   reorder in its column (its rank only)
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

/** A card: what the board shows, from the item's fields. */
export interface Card {
  id: string;
  type: string;
  title: string;
  status: Status;
  repo: string[];
  assignee: string | null;
  rank: number | null;
  parent: string | null;
}

export interface BoardOut {
  columns: Record<Status, Card[]>;
  /** Done items left out because they were finished more than 30 days ago (0 with all). */
  hiddenDone: number;
  /** What the filters can choose from. */
  options: { epics: Choice[]; features: Choice[]; repos: string[]; types: string[] };
}
export interface Choice { id: string; title: string; parent: string | null }

const card = (i: Item): Card => ({
  id: i.id, type: i.type, title: i.title, status: i.status ?? 'todo', repo: reposOf(i),
  assignee: typeof i.fields['assignee'] === 'string' ? i.fields['assignee'] : null,
  rank: typeof i.fields['rank'] === 'number' ? i.fields['rank'] : null, parent: i.parent ?? null,
});

/**
 * Where a card dropped after `after` (null: at the top) goes, by its own rank alone: between two
 * ranked cards, halfway; after the last ranked one, one more; at the top, one less than the first
 * (or 1). Cards with no rank come after ranked ones (spec, section 4), so a card can't go between
 * two of them by changing only its own rank: it goes right after the ranked cards instead.
 */
export function rankFor(column: { id: string; rank: number | null }[], id: string, after: string | null): number {
  const others = column.filter(c => c.id !== id);
  const ranked = others.filter(c => c.rank !== null).map(c => c.rank as number);
  const at = after === null ? 0 : others.findIndex(c => c.id === after) + 1;
  if (after !== null && at === 0) throw new ApiError(400, `${after} is not in that column`);
  const prev = others[at - 1];
  const next = others[at];
  const last = ranked.length ? Math.max(...ranked) : null;
  if (prev && prev.rank === null) return last === null ? 1 : last + 1;
  if (!prev) return next?.rank != null ? next.rank - 1 : 1;
  const prevRank = prev.rank as number;
  if (next?.rank != null) return (prevRank + next.rank) / 2;
  return prevRank + 1;
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

  /** The columns, filtered as ob list filters, each in column order (rank, then ID). */
  const board = (q: URLSearchParams): BoardOut => {
    const b = load();
    const filters: ListFilters = {};
    for (const key of ['parent', 'repo', 'type', 'assignee', 'sprint'] as const) {
      const v = q.getAll(key).flatMap(s => s.split(',')).map(s => s.trim()).filter(Boolean);
      if (v.length) filters[key] = v;
    }
    const r = listItems(b, filters, { all: q.get('all') === '1', days: DONE_DAYS });
    const columns = Object.fromEntries(STATUSES.map(st => [st, columnOrder(r.items.filter(i => i.status === st)).map(card)])) as Record<Status, Card[]>;
    const choice = (i: Item): Choice => ({ id: i.id, title: i.title, parent: i.parent ?? null });
    const ordered = buildOrder(b.items);
    const repos = b.config['repos'];
    return {
      columns, hiddenDone: r.hiddenDone,
      options: {
        epics: ordered.filter(i => i.type === 'epic').map(choice),
        features: ordered.filter(i => i.type === 'feature').map(choice),
        repos: repos && typeof repos === 'object' ? Object.keys(repos) : [],
        types: [...STORY_LEVEL_TYPES],
      },
    };
  };

  /** Reorders a card in its column by changing its rank alone, as one edit (ob: edit <id> rank). */
  const rank = (id: string, body: Record<string, unknown>) => serial(() => {
    const after = body['after'] === null || body['after'] === undefined ? null : text(body, 'after');
    const b = load();
    const item = one(b, id);
    if (!isStoryLevel(item)) throw new ApiError(400, `${id} is not on the board: only stories, bugs, spikes and tasks are`);
    const column = columnOrder(b.items.filter(i => isStoryLevel(i) && i.status === item.status)).map(card);
    return updateNow(id, { fields: { rank: rankFor(column, id, after) } });
  });

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
   * Changes front-matter fields (null removes one) and/or the description, in one commit
   * ("ob: edit 2.3.4 assignee, description"). If the change gives the item a problem ob validate
   * reports, the file is put back and the problem is the answer.
   */
  const update = (id: string, body: Record<string, unknown>) => serial(() => updateNow(id, body));
  function updateNow(id: string, body: Record<string, unknown>) {
    const fields = body['fields'] ?? {};
    const description = body['description'];
    if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) throw new ApiError(400, 'send { "fields": { "name": value } }; null removes a field');
    if (description !== undefined && typeof description !== 'string') throw new ApiError(400, 'description is text (Markdown)');
    if (!Object.keys(fields).length && description === undefined) throw new ApiError(400, 'send fields, a description, or both');
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
    if (Object.keys(changes_).length) updateItem(backlogDir, item, changes_);
    if (description !== undefined) {
      // The body as read, now after whatever front matter the field changes left.
      const now = readText(path);
      const after = withDescription(now, item.body, description);
      if (after !== now) writeText(path, after);
    }
    const final = readText(path);
    if (final === original) return { path: item.path, changed: false, committed: false };
    const added = validateDir(backlogDir).problems.filter(p => p.path === item.path && p.severity === 'error' && !before.has(`${p.code} ${p.message}`));
    if (added.length) {
      writeText(path, original);
      throw new ApiError(400, added.map(p => `${p.code} [${p.rule}] ${p.message}. Fix: ${p.fix}.`).join(' '));
    }
    const descChanged = description !== undefined && withDescription(original, item.body, description) !== original;
    const what = [...Object.keys(changes_), ...(descChanged ? ['description'] : [])];
    const committed = opts.commit ? commit([path], message.edit(id, what.join(', '))) : false;
    return { path: item.path, changed: true, committed };
  }

  const comment = (id: string, body: Record<string, unknown>) => serial(() => {
    one(load(), id);
    return addComment(load(), id, {
      text: text(body, 'text'),
      ...(body['handle'] != null ? { handle: text(body, 'handle') } : {}),
      commit: opts.commit,
    });
  });

  /** ob show --json, plus the description: the body up to ## Comments, which the editor edits. */
  const show = (id: string) => {
    const item = one(load(), id);
    return { ...showItem(load(), id), description: descriptionOf(item.body) };
  };

  return { list, board, tree, validation, create, move, update, rank, comment, show };
}

export type Api = ReturnType<typeof createApi>;

const COMMENTS = /^## Comments[ \t]*$/m;

/** An item's description: its body up to `## Comments` (which the spec puts last), or all of it. */
export function descriptionOf(body: string): string {
  const at = body.search(COMMENTS);
  return at === -1 ? body : body.slice(0, at);
}

/**
 * The file with a new description: the front matter byte for byte, the new description, then
 * the comments as they were. `body` is the item's body as read (the end of the file).
 */
export function withDescription(file: string, body: string, description: string): string {
  if (!file.endsWith(body)) throw new ApiError(409, 'the file changed while it was being edited; try again');
  const front = file.slice(0, file.length - body.length);
  const at = body.search(COMMENTS);
  const comments = at === -1 ? '' : body.slice(at);
  const nl = file.includes('\r\n') ? '\r\n' : '\n';
  if (description.replace(/\s+$/, '') === descriptionOf(body).replace(/\s+$/, '')) return file;
  let text = description.replace(/\r?\n/g, nl).replace(/\s+$/, '');
  if (text) {
    text += nl;
    if (comments) text += nl;
    // A blank line after the front matter, as ob new writes it.
    if (!text.startsWith(nl)) text = nl + text;
  } else if (comments) text = nl;
  return front + text + comments;
}

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
  const m = /^\/api\/items(?:\/([^/]+))?(?:\/(move|comments|rank))?$/.exec(path);
  const q = new URL(req.url ?? '/', 'http://x').searchParams;
  const method = req.method ?? 'GET';
  try {
    if (path === '/api/board' && method === 'GET') send(200, api.board(q));
    else if (path === '/api/tree' && method === 'GET') send(200, api.tree(q));
    else if (path === '/api/validate' && method === 'GET') send(200, api.validation());
    else if (m && !m[1] && method === 'GET') send(200, api.list(q));
    else if (m && !m[1] && method === 'POST') send(201, await api.create(json(raw)));
    else if (m?.[1] && !m[2] && method === 'GET') send(200, api.show(decodeURIComponent(m[1])));
    else if (m?.[1] && !m[2] && method === 'PATCH') send(200, await api.update(decodeURIComponent(m[1]), json(raw)));
    else if (m?.[1] && m[2] === 'move' && method === 'POST') send(200, await api.move(decodeURIComponent(m[1]), json(raw)));
    else if (m?.[1] && m[2] === 'rank' && method === 'POST') send(200, await api.rank(decodeURIComponent(m[1]), json(raw)));
    else if (m?.[1] && m[2] === 'comments' && method === 'POST') send(201, await api.comment(decodeURIComponent(m[1]), json(raw)));
    else if (m || path === '/api/board' || path === '/api/tree' || path === '/api/validate') send(405, { error: `${method} is not allowed on ${path}` });
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
