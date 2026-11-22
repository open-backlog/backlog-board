import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HOST, startBoard } from '../server/board.js';
import type { Board } from '../server/board.js';

const T3 = fileURLToPath(new URL('fixtures/t3-application/backlog/', import.meta.url));
const OB = fileURLToPath(new URL('../node_modules/.bin/ob', import.meta.url));
const boards: Board[] = [];
const tmps: string[] = [];
const saved = { ...process.env };
beforeEach(() => {
  // git's global config is the test's own: no handle or identity from this machine leaks in.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'board-gitconfig-')));
  tmps.push(dir);
  writeFileSync(join(dir, 'config'), '');
  process.env['GIT_CONFIG_GLOBAL'] = join(dir, 'config');
  process.env['GIT_CONFIG_NOSYSTEM'] = '1';
});
afterEach(async () => {
  for (const b of boards.splice(0)) await b.close();
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
  for (const k of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM']) if (saved[k] === undefined) Reflect.deleteProperty(process.env, k); else process.env[k] = saved[k];
});

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).replace(/\n$/, '');
const ob = (cwd: string, ...args: string[]) => execFileSync(OB, args, { cwd, encoding: 'utf8' });

/** The t3 fixture in a new repository of its own, committed, with ob.handle ana. */
function repo(): string {
  const root = join(realpathSync(mkdtempSync(join(tmpdir(), 'board-api-'))), 'shop');
  tmps.push(join(root, '..'));
  cpSync(T3, join(root, 'backlog'), { recursive: true });
  git(root, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.name', 'Ana Silva'], ['user.email', 'ana@example.com'], ['ob.handle', 'ana']]) git(root, 'config', k ?? '', v ?? '');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'start');
  return root;
}
/** A second repository with the same files and history, for doing the same thing with ob. */
function twin(root: string): string {
  const other = join(realpathSync(mkdtempSync(join(tmpdir(), 'board-twin-'))), 'shop');
  tmps.push(join(other, '..'));
  cpSync(root, other, { recursive: true });
  return other;
}

async function board(root: string, commit = true): Promise<Board> {
  const b = await startBoard({ dir: root, port: 0, appDir: root, commit });
  boards.push(b);
  return b;
}

interface Answer { status: number; body: unknown }
function call(b: Board, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Answer> {
  const data = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((ok, fail) => {
    const req = request({ host: HOST, port: b.port, path, method, headers: {
      host: `127.0.0.1:${b.port}`, origin: `http://127.0.0.1:${b.port}`, ...(data ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(data)) } : {}), ...headers,
    } }, res => {
      let text = '';
      res.on('data', d => { text += d; });
      res.on('end', () => ok({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null }));
    });
    req.on('error', fail);
    req.end(data);
  });
}
const head = (root: string) => git(root, 'show', '--name-status', '--format=%s', 'HEAD').split('\n').filter(Boolean);
const STORY = '1.2.1';

describe('reading: the same answers as ob', () => {
  it('tree, show and validate equal ob tree, show and validate --json; list has ob list items in order', async () => {
    const root = repo();
    const b = await board(root);
    expect((await call(b, 'GET', '/api/tree')).body).toEqual(JSON.parse(ob(root, 'tree', '--json')));
    expect((await call(b, 'GET', '/api/tree?all=1')).body).toEqual(JSON.parse(ob(root, 'tree', '--json', '--all')));
    expect((await call(b, 'GET', `/api/items/${STORY}`)).body).toEqual(JSON.parse(ob(root, 'show', STORY, '--json')));
    const v = JSON.parse(execFileSync(OB, ['validate', '--json'], { cwd: root, encoding: 'utf8' })) as Record<string, unknown>;
    expect((await call(b, 'GET', '/api/validate')).body).toEqual({ backlog: v['backlog'], valid: v['valid'], errors: v['errors'], warnings: v['warnings'], problems: v['problems'] });

    const listed = (await call(b, 'GET', '/api/items')).body as { items: { id: string; status: string; fields: Record<string, unknown> }[] };
    const obList = JSON.parse(ob(root, 'list', '--json')) as { id: string; status: string }[];
    expect(listed.items.map(i => `${i.id} ${i.status}`)).toEqual(obList.map(i => `${i.id} ${i.status}`));
    const filtered = (await call(b, 'GET', '/api/items?status=todo,doing&repo=shop-api')).body as { items: { id: string }[] };
    expect(filtered.items.map(i => i.id)).toEqual((JSON.parse(ob(root, 'list', '--json', '--status', 'todo,doing', '--repo', 'shop-api')) as { id: string }[]).map(i => i.id));
    expect(listed.items[0]?.fields['id']).toBeDefined();
  });

  it('404 for an unknown item, 405 for a method a path does not take', async () => {
    const b = await board(repo());
    expect(await call(b, 'GET', '/api/items/9.9.9')).toEqual({ status: 404, body: { error: 'no item 9.9.9 in this backlog' } });
    expect((await call(b, 'DELETE', `/api/items/${STORY}`, {})).status).toBe(405);
    expect((await call(b, 'GET', '/api/nope')).status).toBe(404);
    // A refused change, then a read on the same connection.
    expect((await call(b, 'POST', `/api/items/${STORY}/move`, { status: 'x' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await call(b, 'GET', '/api/health')).status).toBe(200);
  });
});

describe('changes: one commit each, the same as ob, and only the files it touched', () => {
  it('move is ob move: the same commit and the same files', async () => {
    const root = repo();
    const other = twin(root);
    const b = await board(root);
    const r = await call(b, 'POST', `/api/items/${STORY}/move`, { status: 'doing' });
    expect(r.status).toBe(200);
    ob(other, 'move', STORY, 'doing');
    expect(head(root)).toEqual(head(other));
    expect(head(root)[0]).toBe(`ob: move ${STORY} to doing`);
    expect(git(root, 'ls-files')).toBe(git(other, 'ls-files'));
    expect(git(root, 'status', '--porcelain')).toBe('');
  });

  it('create is ob new, and comment is ob comment', async () => {
    const root = repo();
    const other = twin(root);
    const b = await board(root);
    const r = await call(b, 'POST', '/api/items', { type: 'story', title: 'Gift cards', parent: '1.1' });
    expect(r.status).toBe(201);
    ob(other, 'new', 'story', 'Gift cards', '--parent', '1.1');
    expect(head(root)).toEqual(head(other));
    const path = (r.body as { path: string }).path;
    expect(readFileSync(join(root, 'backlog', path), 'utf8')).toBe(readFileSync(join(other, 'backlog', path), 'utf8'));

    expect((await call(b, 'POST', `/api/items/${STORY}/comments`, { text: 'Looks good' })).status).toBe(201);
    ob(other, 'comment', STORY, 'Looks good');
    expect(head(root)).toEqual(head(other));
    expect(git(root, 'diff', 'HEAD~1', 'HEAD')).toBe(git(other, 'diff', 'HEAD~1', 'HEAD'));
  });

  it('update changes only those fields, in one commit; unknown fields stay; null removes one', async () => {
    const root = repo();
    const b = await board(root);
    const file = (await call(b, 'GET', `/api/items/${STORY}`)).body as { path: string };
    const abs = join(root, 'backlog', file.path);
    writeFileSync(abs, readFileSync(abs, 'utf8').replace('---\n\n', 'customer: acme\n---\n\n'));
    git(root, 'commit', '-qam', 'a field of our own');
    const r = await call(b, 'PATCH', `/api/items/${STORY}`, { fields: { assignee: 'jo-smith', estimate: 3 } });
    expect(r).toEqual({ status: 200, body: { path: file.path, changed: true, committed: true } });
    expect(head(root)).toEqual([`ob: edit ${STORY} assignee, estimate`, `M\tbacklog/${file.path}`]);
    const diff = git(root, 'diff', '-U0', 'HEAD~1', 'HEAD').split('\n').filter(l => /^[+-](?![+-]{2})/.test(l));
    expect(diff.every(l => /^[+-](assignee|estimate):/.test(l))).toBe(true);
    expect(readFileSync(abs, 'utf8')).toContain('customer: acme');
    await call(b, 'PATCH', `/api/items/${STORY}`, { fields: { assignee: null } });
    expect(readFileSync(abs, 'utf8')).not.toContain('assignee:');
    expect((await call(b, 'PATCH', `/api/items/${STORY}`, { fields: { estimate: 3 } })).body).toEqual({ path: file.path, changed: false, committed: false });
  });

  it("refuses an update ob validate would report, with its message, and puts the file back", async () => {
    const root = repo();
    const b = await board(root);
    const before = git(root, 'rev-parse', 'HEAD');
    const r = await call(b, 'PATCH', `/api/items/${STORY}`, { fields: { parent: '9.9' } });
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toMatch(/^OB002 \[parent-exists\] .+ Fix: /);
    expect(git(root, 'status', '--porcelain')).toBe('');
    expect(git(root, 'rev-parse', 'HEAD')).toBe(before);
  });

  it('never sweeps in other work: staged, unstaged or new files stay as they were', async () => {
    const root = repo();
    const b = await board(root);
    writeFileSync(join(root, 'notes.txt'), 'mine\n');
    appendFileSync(join(root, 'backlog', 'config.yml'), '# mine\n');
    git(root, 'add', 'backlog/config.yml');
    const epic = (await call(b, 'GET', '/api/items/1')).body as { path: string };
    appendFileSync(join(root, 'backlog', epic.path), '\nMy draft.\n');
    const mine = git(root, 'status', '--porcelain');
    await call(b, 'POST', `/api/items/${STORY}/move`, { status: 'doing' });
    await call(b, 'PATCH', `/api/items/${STORY}`, { fields: { assignee: 'ana' } });
    expect(git(root, 'show', '--name-only', '--format=', 'HEAD~1', 'HEAD').split('\n').filter(Boolean).every(f => f.includes(`${STORY}-`))).toBe(true);
    expect(git(root, 'status', '--porcelain')).toBe(mine);
  });

  it("refuses to change an item whose file has your uncommitted changes", async () => {
    const root = repo();
    const b = await board(root);
    const story = (await call(b, 'GET', `/api/items/${STORY}`)).body as { path: string };
    appendFileSync(join(root, 'backlog', story.path), '\nMy draft.\n');
    const r = await call(b, 'POST', `/api/items/${STORY}/move`, { status: 'done' });
    expect(r.status).toBe(409);
    expect((r.body as { error: string }).error).toContain("has changes that aren't committed");
    expect((await call(b, 'PATCH', `/api/items/${STORY}`, { fields: { rank: 1 } })).status).toBe(409);
    expect(git(root, 'log', '--format=%s', '-1')).toBe('start');
  });

  it('with commit off (ob serve --no-commit), changes are made and left to you', async () => {
    const root = repo();
    const b = await board(root, false);
    expect((await call(b, 'POST', `/api/items/${STORY}/move`, { status: 'doing' })).body).toMatchObject({ committed: false });
    expect(git(root, 'log', '--format=%s', '-1')).toBe('start');
    expect(git(root, 'status', '--porcelain')).toMatch(/^R {2}backlog\/stories\/todo\/.+ -> backlog\/stories\/doing\//);
  });

  it('runs changes one at a time: two at once both commit', async () => {
    const root = repo();
    const b = await board(root);
    const todo = (await call(b, 'GET', '/api/items?status=todo')).body as { items: { id: string }[] };
    const [x, y] = todo.items.map(i => i.id);
    const rs = await Promise.all([call(b, 'POST', `/api/items/${x}/move`, { status: 'doing' }), call(b, 'POST', `/api/items/${y}/move`, { status: 'doing' })]);
    expect(rs.map(r => r.status)).toEqual([200, 200]);
    expect(git(root, 'log', '--format=%s', '-2').split('\n').sort()).toEqual([`ob: move ${x} to doing`, `ob: move ${y} to doing`].sort());
  });

  it('bad requests: a status, a body, the type', async () => {
    const b = await board(repo());
    expect((await call(b, 'POST', `/api/items/${STORY}/move`, { status: 'later' })).status).toBe(400);
    expect((await call(b, 'POST', '/api/items/1/move', { status: 'done' })).body).toEqual({ error: "1 is an epic, which doesn't move: its status comes from its items" });
    expect((await call(b, 'POST', '/api/items', { type: 'story', title: 'X', parent: '9.9' })).status).toBe(400);
    expect((await call(b, 'PATCH', `/api/items/${STORY}`, { fields: { x: { y: 1 } } })).status).toBe(400);
    expect((await call(b, 'PATCH', `/api/items/${STORY}`, [1])).status).toBe(400);
  });
});

describe('only the board itself may change things', () => {
  it('refuses changes from another origin, with no origin, or not as JSON; reading needs neither', async () => {
    const root = repo();
    const b = await board(root);
    const move = (headers: Record<string, string>) => call(b, 'POST', `/api/items/${STORY}/move`, { status: 'doing' }, headers);
    expect((await move({ origin: 'https://evil.example' })).status).toBe(403);
    expect((await move({ origin: `http://127.0.0.1:${b.port + 1}` })).status).toBe(403);
    expect((await move({ origin: '' })).status).toBe(403);
    expect((await move({ 'content-type': 'text/plain' })).status).toBe(415);
    expect((await move({ 'content-type': 'application/x-www-form-urlencoded' })).status).toBe(415);
    expect(git(root, 'log', '--format=%s', '-1')).toBe('start');
    expect((await move({ origin: `http://localhost:${b.port}` })).status).toBe(200);
    expect((await call(b, 'GET', '/api/tree', undefined, { origin: 'https://evil.example' })).status).toBe(200);
  });
});

describe('/api/events', () => {
  /** Opens the stream; resolves each change event's paths and when it came. */
  function listen(b: Board) {
    const got: { at: number; paths: string[] }[] = [];
    const req = request({ host: HOST, port: b.port, path: '/api/events', headers: { host: `127.0.0.1:${b.port}` } }, res => {
      let buf = '';
      res.on('data', d => {
        buf += d;
        for (let i = buf.indexOf('\n\n'); i !== -1; i = buf.indexOf('\n\n')) {
          const msg = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = /^event: change\ndata: (.*)$/m.exec(msg);
          if (data) got.push({ at: Date.now(), paths: (JSON.parse(data[1] ?? '{}') as { paths: string[] }).paths });
        }
      });
    });
    req.end();
    const until = async (ok: () => boolean, ms = 1000) => {
      const start = Date.now();
      while (!ok() && Date.now() - start < ms) await new Promise(r => setTimeout(r, 10));
    };
    return { got, until, stop: () => req.destroy() };
  }

  it('an edit in a text editor reaches the browser within a second, and so does a board change', async () => {
    const root = repo();
    const b = await board(root);
    const s = listen(b);
    await new Promise(r => setTimeout(r, 200));
    const story = (await call(b, 'GET', `/api/items/${STORY}`)).body as { path: string };
    const saved = Date.now();
    appendFileSync(join(root, 'backlog', story.path), '\nEdited in an editor.\n');
    await s.until(() => s.got.length > 0);
    expect(s.got[0]?.paths).toContain(story.path);
    expect((s.got[0]?.at ?? Infinity) - saved).toBeLessThan(1000);
    git(root, 'checkout', '--', '.');
    await new Promise(r => setTimeout(r, 200));
    s.got.length = 0;
    await call(b, 'POST', `/api/items/${STORY}/move`, { status: 'doing' });
    await s.until(() => s.got.some(g => g.paths.some(p => p.startsWith('stories/doing/'))));
    expect(s.got.flatMap(g => g.paths).some(p => p.startsWith('stories/doing/'))).toBe(true);
    s.stop();
  });
});
