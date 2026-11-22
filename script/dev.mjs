// npm run dev: the board in development, against a fixture backlog (test/fixtures/t3-application).
// The server (server/main.ts, restarted by tsx on every change) listens on 127.0.0.1:4310, and the
// Angular dev server on 127.0.0.1:4300 reloads the app and passes /api to the server
// (app/proxy.conf.json). Open http://127.0.0.1:4300/. Ctrl-C stops both.
//   npm run dev <folder>   to serve another backlog (--dir <folder> works too)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const at = process.argv.indexOf('--dir');
const dir = (at > 0 ? process.argv[at + 1] : process.argv.slice(2).find(a => !a.startsWith('-'))) ?? 'test/fixtures/t3-application/backlog';
const bin = name => fileURLToPath(new URL(`../node_modules/.bin/${name}`, import.meta.url));

const children = [
  spawn(bin('tsx'), ['watch', 'server/main.ts', '--dir', dir, '--port', '4310'], { cwd: root, stdio: 'inherit' }),
  spawn(bin('ng'), ['serve'], { cwd: root, stdio: 'inherit' }),
];
console.log(`board dev: ${dir} at http://127.0.0.1:4300/ (API on 127.0.0.1:4310)`);
let stopping = false;
const stop = code => {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill('SIGTERM');
  process.exitCode = code;
};
for (const c of children) c.on('exit', code => stop(code ?? 0));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
