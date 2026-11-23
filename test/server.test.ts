import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { connect, createServer } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBacklog } from 'open-backlog';
import { afterEach, describe, expect, it } from 'vitest';

import { allowedHost, HOST, startBoard } from '../server/board.js';
import type { Board } from '../server/board.js';

const T3 = fileURLToPath(new URL('fixtures/t3-application/backlog/', import.meta.url));
const boards: Board[] = [];
const tmps: string[] = [];
afterEach(async () => {
  for (const b of boards.splice(0)) await b.close();
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
});

/** A built app stand-in: index.html and one script. */
function appDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'board-app-')));
  tmps.push(dir);
  writeFileSync(join(dir, 'index.html'), '<!doctype html><ob-root></ob-root>');
  mkdirSync(join(dir, 'media'));
  writeFileSync(join(dir, 'main-ABC.js'), 'console.log(1)');
  return dir;
}

async function board(opts: Parameters<typeof startBoard>[0] = {}): Promise<Board> {
  const b = await startBoard({ dir: T3, port: 0, appDir: appDir(), ...opts });
  boards.push(b);
  return b;
}

/** A raw GET with its own Host header (fetch won't send one). */
function get(port: number, path: string, host = `127.0.0.1:${port}`, method = 'GET'): Promise<{ status: number; type: string; body: string }> {
  return new Promise((ok, fail) => {
    const req = request({ host: HOST, port, path, method, headers: { host } }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => ok({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), body }));
    });
    req.on('error', fail);
    req.end();
  });
}

describe('the board server', () => {
  it('listens on 127.0.0.1 only: not on any other address of this computer', async () => {
    const b = await board();
    expect(b.url).toBe(`http://127.0.0.1:${b.port}/`);
    const others = Object.values(networkInterfaces()).flat().flatMap(a => (a && a.family === 'IPv4' && !a.internal ? [a.address] : []));
    for (const address of others) {
      const reached = await new Promise<boolean>(ok => {
        const s = connect({ host: address, port: b.port, timeout: 1000 }, () => { s.destroy(); ok(true); });
        s.on('error', () => ok(false));
        s.on('timeout', () => { s.destroy(); ok(false); });
      });
      expect(reached, address).toBe(false);
    }
    expect((await get(b.port, '/api/v1/health')).status).toBe(200);
  });

  it('answers /api/v1/health from open-backlog: the backlog, its items, the versions', async () => {
    const b = await board();
    const r = await get(b.port, '/api/v1/health');
    expect(r.type).toBe('application/json');
    const core = JSON.parse(readFileSync(fileURLToPath(new URL('../node_modules/open-backlog/package.json', import.meta.url)), 'utf8')) as { version: string };
    const own = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version: string };
    const backlog = loadBacklog(T3);
    expect(JSON.parse(r.body)).toEqual({ board: own.version, core: core.version, spec: '0.1', backlog: { name: backlog.config['name'], items: backlog.items.length } });
    expect(backlog.items.length).toBeGreaterThan(5);
  });

  it('finds the backlog from a folder inside the repository, as ob does', async () => {
    const b = await board({ dir: join(T3, 'stories', 'todo') });
    expect(b.backlogDir).toBe(T3.replace(/\/$/, ''));
  });

  it("serves the app's files, its page for other paths, and nothing outside it", async () => {
    const b = await board();
    expect(await get(b.port, '/')).toMatchObject({ status: 200, type: 'text/html; charset=utf-8', body: '<!doctype html><ob-root></ob-root>' });
    expect(await get(b.port, '/main-ABC.js')).toMatchObject({ status: 200, type: 'text/javascript; charset=utf-8' });
    expect((await get(b.port, '/item/2.3.4')).body).toContain('<ob-root>');
    expect((await get(b.port, '/missing.js')).status).toBe(404);
    expect((await get(b.port, '/%2e%2e/%2e%2e/package.json')).status).toBe(404);
    expect((await get(b.port, '/api/v1/nothing')).status).toBe(404);
    expect((await get(b.port, '/api/health')).status).toBe(404); // the API is versioned: /api/v1/
    expect((await get(b.port, '/', `127.0.0.1:${b.port}`, 'POST')).status).toBe(405);
  });

  it('refuses requests addressed to any other host name (DNS rebinding)', async () => {
    const b = await board();
    expect((await get(b.port, '/api/v1/health', `localhost:${b.port}`)).status).toBe(200);
    expect((await get(b.port, '/api/v1/health', 'evil.example')).status).toBe(421);
    expect((await get(b.port, '/api/v1/health', `evil.example:${b.port}`)).status).toBe(421);
    expect((await get(b.port, '/api/v1/health', `127.0.0.1:${b.port + 1}`)).status).toBe(421);
    expect(allowedHost(undefined, 80)).toBe(false);
    expect(allowedHost('localhost', 80)).toBe(true);
  });

  it("says why it can't start: no backlog, or the port is taken", async () => {
    const empty = realpathSync(mkdtempSync(join(tmpdir(), 'board-none-')));
    tmps.push(empty);
    await expect(startBoard({ dir: empty, port: 0 })).rejects.toThrow(/backlog/);
    const taken = createServer();
    await new Promise<void>(ok => taken.listen(0, HOST, ok));
    const port = (taken.address() as { port: number }).port;
    await expect(startBoard({ dir: T3, port })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    taken.close();
  });

  it('depends on open-backlog alone at run time, so its rules are the CLI rules (D1)', () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies)).toEqual(['open-backlog']);
  });

  it('depends on the open-backlog minor version it is tested with (2.4.7), which is its own (2.4.8: ob serve runs it)', () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version: string; dependencies: Record<string, string> };
    const core = JSON.parse(readFileSync(fileURLToPath(new URL('../node_modules/open-backlog/package.json', import.meta.url)), 'utf8')) as { version: string };
    const line = (v: string) => v.split('.').slice(0, 2).join('.');
    expect(pkg.dependencies['open-backlog']).toBe(`^${line(core.version)}.0`);
    expect(line(pkg.version)).toBe(line(core.version));
  });
});
