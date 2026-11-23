// --open (2.4.8, for ob serve): the board's address in the default browser, once it is listening.
// The only program the board runs that isn't git, which goes through open-backlog (D2).
import { spawn } from 'node:child_process';

/** The command that opens a URL: $BROWSER when set, else the system's own opener. */
export function browserCommand(url: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): [string, string[]] {
  const browser = env['BROWSER'];
  if (browser) return [browser, [url]];
  if (platform === 'darwin') return ['open', [url]];
  if (platform === 'win32') return ['cmd', ['/c', 'start', '""', url]];
  return ['xdg-open', [url]];
}

/** Opens the URL; when that can't be done (no browser, as over ssh), says to open it by hand. */
export function openBrowser(url: string, warn: (text: string) => void): void {
  const [command, args] = browserCommand(url);
  let warned = false;
  const fail = () => {
    if (!warned) warn(`Couldn't open a browser: open ${url} yourself.\n`);
    warned = true;
  };
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', fail);
    child.on('exit', code => { if (code) fail(); });
    child.unref();
  } catch {
    fail();
  }
}
