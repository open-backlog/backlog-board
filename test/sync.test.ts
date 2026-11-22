import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HOST, startBoard } from '../server/board.js';
import type { Board } from '../server/board.js';
import { conflictOf, syncStatus } from '../server/sync.js';
import type { Conflict, SyncResult, SyncStatus } from '../server/sync.js';

/** Sync (2.4.6) against real git: a shared "origin" and two clones of it, yours and a teammate's. */
const T3 = fileURLToPath(new URL('fixtures/t3-application/backlog/', import.meta.url));
const OB = fileURLToPath(new URL('../node_modules/.bin/ob', import.meta.url));
const boards: Board[] = [];
const tmps: string[] = [];
const kids: ChildProcess[] = [];
const saved = { ...process.env };
beforeEach(() => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'board-gitconfig-')));
  tmps.push(dir);
  writeFileSync(join(dir, 'config'), '[user]\n\tname = Ana Silva\n\temail = ana@example.com\n[ob]\n\thandle = ana\n[init]\n\tdefaultBranch = main\n');
  process.env['GIT_CONFIG_GLOBAL'] = join(dir, 'config');
  process.env['GIT_CONFIG_NOSYSTEM'] = '1';
});
afterEach(async () => {
  for (const b of boards.splice(0)) await b.close();
  for (const k of kids.splice(0)) k.kill();
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
  for (const k of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM']) if (saved[k] === undefined) Reflect.deleteProperty(process.env, k); else process.env[k] = saved[k];
});

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ob = (cwd: string, ...args: string[]) => execFileSync(OB, args, { cwd, encoding: 'utf8' });
const tmp = (name: string) => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `board-sync-${name}-`)));
  tmps.push(d);
  return d;
};

/** origin (bare), your clone with the t3 backlog, and a teammate's clone. */
function team(): { origin: string; mine: string; mate: string } {
  const origin = join(tmp('origin'), 'shop.git');
  git(tmp('x'), 'init', '-q', '--bare', '-b', 'main', origin);
  const mine = join(tmp('mine'), 'shop');
  cpSync(T3, join(mine, 'backlog'), { recursive: true });
  git(mine, 'init', '-q', '-b', 'main');
  git(mine, 'add', '-A');
  git(mine, 'commit', '-qm', 'start');
  git(mine, 'remote', 'add', 'origin', origin);
  git(mine, 'push', '-q', '-u', 'origin', 'main');
  const mate = join(tmp('mate'), 'shop');
  git(tmp('y'), 'clone', '-q', origin, mate);
  git(mate, 'config', 'user.name', 'Raj Patel');
  git(mate, 'config', 'ob.handle', 'raj');
  return { origin, mine, mate };
}

async function board(root: string): Promise<Board> {
  const b = await startBoard({ dir: root, port: 0, appDir: root });
  boards.push(b);
  return b;
}

interface Answer<T = unknown> { status: number; body: T }
function call<T = unknown>(b: Board, method: string, path: string, body?: unknown): Promise<Answer<T>> {
  const data = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((ok, fail) => {
    const req = request({ host: HOST, port: b.port, path, method, headers: {
      host: `127.0.0.1:${b.port}`, origin: `http://127.0.0.1:${b.port}`, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(data ?? '')),
    } }, res => {
      let text = '';
      res.on('data', d => { text += d; });
      res.on('end', () => ok({ status: res.statusCode ?? 0, body: (text ? JSON.parse(text) : null) as T }));
    });
    req.on('error', fail);
    req.end(data ?? '');
  });
}
const status = async (b: Board) => (await call<SyncStatus>(b, 'GET', '/api/v1/sync')).body;
const CARD = 'backlog/stories/todo/1.2.1-card-form.md';

describe('Sync', () => {
  it('shares nothing until Sync; then gets teammates’ changes (rebase) and sends yours', async () => {
    const { origin, mine, mate } = team();
    const b = await board(mine);
    const shared = git(origin, 'rev-parse', 'main');
    expect(await status(b)).toEqual({ git: true, branch: 'main', upstream: 'origin/main', unshared: [], behind: 0, uncommitted: [], conflict: null });

    expect((await call(b, 'POST', '/api/v1/items/1.2.1/move', { status: 'doing' })).status).toBe(200);
    expect((await call(b, 'POST', '/api/v1/items/1.1.2/comments', { text: 'Looks good' })).status).toBe(201);
    const before = await status(b);
    expect(before.unshared.map(c => c.subject)).toEqual(['ob: comment on 1.1.2', 'ob: move 1.2.1 to doing']);
    expect(git(origin, 'rev-parse', 'main')).toBe(shared); // nothing pushed on its own

    ob(mate, 'new', 'story', 'Saved cards', '--parent', '1.2');
    git(mate, 'push', '-q');

    const r = await call<SyncResult>(b, 'POST', '/api/v1/sync');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ received: 1, sent: 2, status: { unshared: [], behind: 0, conflict: null } });
    expect(git(origin, 'log', '--format=%s', 'main')).toBe('ob: comment on 1.1.2\nob: move 1.2.1 to doing\nob: add 1.2.3 Saved cards\nstart');
    expect(git(mine, 'rev-list', '--merges', '--count', 'HEAD')).toBe('0'); // rebased: one straight line
    expect(git(mine, 'ls-files', 'backlog/stories/todo')).toContain('1.2.3-saved-cards.md');

    const again = await call<SyncResult>(b, 'POST', '/api/v1/sync');
    expect(again.body).toMatchObject({ received: 0, sent: 0 });
  });

  it('stops on a conflict, says which files and what to do, and leaves it for you to resolve by hand', async () => {
    const { origin, mine, mate } = team();
    const b = await board(mine);
    expect((await call(b, 'PATCH', '/api/v1/items/1.2.1', { fields: { title: 'Card form, mine' } })).status).toBe(200);
    writeFileSync(join(mate, CARD), readFileSync(join(mate, CARD), 'utf8').replace(/^title: .*$/m, 'title: Card form, theirs'));
    git(mate, 'commit', '-qam', 'ob: edit 1.2.1 title');
    git(mate, 'push', '-q');
    const theirs = git(mate, 'rev-parse', 'HEAD');

    const r = await call<{ error: string; conflict: Conflict }>(b, 'POST', '/api/v1/sync');
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Nothing was sent/);
    expect(r.body.conflict.kind).toBe('rebase');
    expect(r.body.conflict.steps.join('\n')).toMatch(/git add .*\n.*git rebase --continue[\s\S]*git rebase --abort/);
    expect(r.body.conflict.files).toEqual([CARD]);
    expect(git(origin, 'rev-parse', 'main')).toBe(theirs); // nothing of mine was sent
    const file = r.body.conflict.files[0] ?? '';
    expect(readFileSync(join(mine, file), 'utf8')).toMatch(/<<<<<<<[\s\S]*Card form, (mine|theirs)[\s\S]*>>>>>>>/);

    // While it's open: the status shows it, the board makes no changes, and Sync won't run.
    expect((await status(b)).conflict?.files).toEqual(r.body.conflict.files);
    const edit = await call<{ error: string }>(b, 'POST', '/api/v1/items/1.1.2/move', { status: 'done' });
    expect(edit.status).toBe(409);
    expect(edit.body.error).toMatch(/rebase is in progress/);
    expect((await call(b, 'POST', '/api/v1/sync')).status).toBe(409);

    // Undone by hand, everything is as it was before Sync.
    git(mine, 'rebase', '--abort');
    expect(conflictOf(mine)).toBeNull();
    const after = await status(b);
    expect(after.unshared.map(c => c.subject)).toEqual(['ob: edit 1.2.1 title']);
    expect(readFileSync(join(mine, CARD), 'utf8')).toContain('title: Card form, mine');
  });

  it('never asks for a login: a remote that wants a password fails at once, with what to check', async () => {
    const { mine } = team();
    // A remote that answers every request with 401, as a server wanting a password does. It runs
    // in its own process: the board's git calls wait for git to finish.
    const server = spawn(process.execPath, ['-e', `require('node:http').createServer((q, s) => { s.writeHead(401, { 'WWW-Authenticate': 'Basic realm="x"' }); s.end(); }).listen(0, '127.0.0.1', function () { console.log(this.address().port); })`]);
    kids.push(server);
    const port = await new Promise<string>(ok => server.stdout?.once('data', d => ok(String(d).trim())));
    git(mine, 'remote', 'set-url', 'origin', `http://127.0.0.1:${port}/shop.git`);
    git(mine, 'config', 'credential.helper', '');
    const b = await board(mine);
    const started = Date.now();
    const r = await call<{ error: string }>(b, 'POST', '/api/v1/sync');
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(r.status).toBe(502);
    expect(r.body.error).toMatch(/couldn't log in to origin: check that git pull works in a terminal/);
    expect(r.body.error).toMatch(/never asks for a password or token/);
    expect(process.env['GIT_TERMINAL_PROMPT']).toBe(saved['GIT_TERMINAL_PROMPT']); // put back after
  });

  it('says what to do with no remote branch, uncommitted changes, or no git at all', async () => {
    const { mine } = team();
    git(mine, 'checkout', '-qb', 'cards');
    const b = await board(mine);
    expect((await status(b)).upstream).toBeNull();
    const none = await call<{ error: string }>(b, 'POST', '/api/v1/sync');
    expect(none).toMatchObject({ status: 409 });
    expect(none.body.error).toMatch(/cards has no remote branch .* git push -u origin cards/);

    git(mine, 'checkout', '-q', 'main');
    writeFileSync(join(mine, CARD), readFileSync(join(mine, CARD), 'utf8') + '\nMore.\n');
    expect((await status(b)).uncommitted).toEqual([` M ${CARD}`]);
    const dirty = await call<{ error: string }>(b, 'POST', '/api/v1/sync');
    expect(dirty.status).toBe(409);
    expect(dirty.body.error).toBe(`A file has changes that aren't committed (${CARD}); commit or stash them, then Sync`);

    const loose = tmp('loose');
    cpSync(T3, join(loose, 'backlog'), { recursive: true });
    expect(syncStatus(loose)).toMatchObject({ git: false, unshared: [], conflict: null });
    const nogit = await board(loose);
    expect((await call(nogit, 'POST', '/api/v1/sync')).status).toBe(400);
  });
});
