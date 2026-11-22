import { existsSync, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findBacklog, loadBacklog, SPEC_VERSION } from 'open-backlog';

/**
 * The board's server (2.4.1, D4): an HTTP server on this computer only (127.0.0.1) that serves
 * the built Angular app and a JSON API over open-backlog. Every rule (reading, IDs, validation,
 * git) is open-backlog's (D1); this file only answers requests. The API grows in 2.4.2.
 */

/** The only address the board listens on: this computer. */
export const HOST = '127.0.0.1';
/** The port when none is given; ob serve (2.4.8) passes --port. */
export const DEFAULT_PORT = 4310;

export interface BoardOptions {
  /** Where to look for the backlog: this folder, or the first parent with backlog/config.yml. */
  dir?: string;
  /** 0 for any free port. */
  port?: number;
  /** The built app (dist/app), served as files; by default the one in this package. */
  appDir?: string;
}

export interface Board {
  url: string;
  port: number;
  /** The backlog folder it serves. */
  backlogDir: string;
  close(): Promise<void>;
}

export interface Health {
  board: string;
  core: string;
  spec: string;
  backlog: { name: string; items: number };
}

/** This package's folder: one up from server/ (in development), two up from dist/server/. */
const ROOT = [fileURLToPath(new URL('..', import.meta.url)), fileURLToPath(new URL('../..', import.meta.url))]
  .find(d => existsSync(join(d, 'package.json')) && (JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')) as { name?: string }).name === 'open-backlog-board') ?? process.cwd();
const ownVersion = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;
const coreVersion = (createRequire(import.meta.url)('open-backlog/package.json') as { version: string }).version;

/** The built app, shipped in the package: dist/app/. */
export const APP_DIR = join(ROOT, 'dist', 'app');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
};

/**
 * Starts the board for the backlog found from `dir`. Resolves once it's listening on 127.0.0.1;
 * rejects with open-backlog's BacklogError if there is no backlog, or with EADDRINUSE.
 */
export async function startBoard(opts: BoardOptions = {}): Promise<Board> {
  const backlogDir = findBacklog(resolve(opts.dir ?? process.cwd()));
  loadBacklog(backlogDir); // fail now, not on the first request, if it can't be read
  const appDir = resolve(opts.appDir ?? APP_DIR);
  let port = opts.port ?? DEFAULT_PORT;

  const server = createServer((req, res) => {
    handle(req, res).catch(e => send(res, 500, 'application/json', JSON.stringify({ error: (e as Error).message })));
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Only a page loaded from this board may talk to it: a site that points its own name at
    // 127.0.0.1 (DNS rebinding) sends its own Host, and is refused.
    if (!allowedHost(req.headers.host, port)) return send(res, 421, 'text/plain; charset=utf-8', 'This board answers only at 127.0.0.1 or localhost.\n');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain; charset=utf-8', 'Not allowed.\n');
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);

    if (path === '/api/health') {
      const b = loadBacklog(backlogDir);
      const health: Health = { board: ownVersion, core: coreVersion, spec: SPEC_VERSION, backlog: { name: String(b.config['name'] ?? ''), items: b.items.length } };
      return send(res, 200, 'application/json', JSON.stringify(health));
    }
    if (path.startsWith('/api/')) return send(res, 404, 'application/json', JSON.stringify({ error: `no API ${path}` }));

    // The app's files; a path that isn't one (an item's page, such as /item/2.3.4) is the app's own
    // page, unless it asks for a kind of file the app has (a missing .js is a 404).
    const file = resolve(appDir, `.${path}`);
    if (file !== appDir && !file.startsWith(appDir + sep)) return send(res, 404, 'text/plain; charset=utf-8', 'Not found.\n');
    const found = await isFile(file) ? file : TYPES[extname(path)] ? null : join(appDir, 'index.html');
    if (!found || !await isFile(found)) return send(res, 404, 'text/plain; charset=utf-8', 'Not found.\n');
    return send(res, 200, TYPES[extname(found)] ?? 'application/octet-stream', await readFile(found), req.method === 'HEAD');
  }

  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(port, HOST, () => { server.off('error', fail); ok(); });
  });
  port = (server.address() as AddressInfo).port;
  return {
    url: `http://${HOST}:${port}/`,
    port,
    backlogDir,
    close: () => new Promise<void>(ok => { server.closeAllConnections(); server.close(() => ok()); }),
  };
}

/** 127.0.0.1 or localhost, on this port (or none given). */
export function allowedHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const m = /^(127\.0\.0\.1|localhost)(?::(\d+))?$/.exec(host);
  return m !== null && (m[2] === undefined || Number(m[2]) === port);
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

function send(res: ServerResponse, status: number, type: string, body: string | Buffer, headOnly = false): void {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
  });
  res.end(headOnly ? undefined : body);
}
