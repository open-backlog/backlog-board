// After npm run build: the package as a user gets it. Checks it holds only the built server and
// app, installs the packed tarball globally into a temporary prefix (with open-backlog from npm),
// starts the installed open-backlog-board on a fixture backlog, and fetches the app, a bundle and
// /api/health from it on 127.0.0.1.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tmp = mkdtempSync(join(tmpdir(), 'board-smoke-'));
const fail = msg => { console.error(`smoke: FAILED — ${msg}`); process.exitCode = 1; };
let board;
try {
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--silent'], { cwd: root, encoding: 'utf8' }));
  const files = packed.files.map(f => f.path);
  const extra = files.filter(f => !/^(package\.json|README\.md|LICENSE|dist\/server\/[a-z]+\.(js|d\.ts)|dist\/app\/.+)$/.test(f));
  const missing = ['dist/server/main.js', 'dist/server/board.js', 'dist/app/index.html', 'dist/app/board-icon.png', 'LICENSE', 'README.md'].filter(f => !files.includes(f));
  if (extra.length || missing.length) fail(`the package has ${extra.join(', ') || 'nothing extra'} and lacks ${missing.join(', ') || 'nothing'}`);
  else console.log(`smoke: the package is ${files.length} files: the built server and app, README, LICENSE, package.json`);

  const tgz = execFileSync('npm', ['pack', '--silent', '--pack-destination', tmp], { cwd: root, encoding: 'utf8' }).trim().split('\n').pop();
  execFileSync('npm', ['install', '--global', '--prefix', tmp, '--silent', join(tmp, tgz)], { stdio: 'inherit' });
  const bin = join(tmp, 'bin', 'open-backlog-board');
  const fixture = join(root, 'test', 'fixtures', 't3-application', 'backlog', 'stories');

  board = spawn(bin, ['--dir', fixture, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  board.stderr.on('data', d => { err += d; });
  const url = await new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error(`no URL after 10s: ${out}${err}`)), 10000);
    board.stdout.on('data', d => { out += d; const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(out); if (m) { clearTimeout(t); ok(m[0]); } });
    board.on('exit', code => no(new Error(`exited ${code}: ${err}`)));
  });
  console.log(`smoke: the installed open-backlog-board listens on ${url}`);

  const page = await (await fetch(url)).text();
  const script = /src="(main-[^"]+\.js)"/.exec(page)?.[1];
  const js = script ? await fetch(url + script) : null;
  // The server's Content-Security-Policy allows no inline script: the page must have none.
  const inline = [...page.matchAll(/<script(?![^>]*\bsrc=)[^>]*>|\son[a-z]+=/g)].map(m => m[0]);
  if (inline.length) fail(`the page has inline script, which the board's CSP blocks: ${inline.join(', ')}`);
  if (!page.includes('<ob-root>') || !js?.ok || !js.headers.get('content-type')?.startsWith('text/javascript')) fail(`the app: page ${page.slice(0, 80)}, script ${script} ${js?.status}`);
  else console.log(`smoke: it serves the built app (${script})`);

  const health = await (await fetch(url + 'api/health')).json();
  const core = JSON.parse(readFileSync(join(tmp, 'lib', 'node_modules', pkg.name, 'node_modules', 'open-backlog', 'package.json'), 'utf8')).version;
  if (health.board !== pkg.version || health.core !== core || health.backlog?.name !== 'shop' || !(health.backlog?.items > 0)) fail(`/api/health gave ${JSON.stringify(health)}`);
  else console.log(`smoke: /api/health reads the backlog through open-backlog ${core} (${health.backlog.name}, ${health.backlog.items} items)`);
} catch (e) {
  fail(e.message);
} finally {
  board?.kill('SIGTERM');
  rmSync(tmp, { recursive: true, force: true });
}
