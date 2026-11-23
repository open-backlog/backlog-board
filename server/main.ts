#!/usr/bin/env node
// open-backlog-board [<folder>] [--port <n>] [--open]: the board for the backlog found from
// <folder> (or here), on 127.0.0.1; --dir <folder> also works. ob serve (2.4.8) runs it with --open.
import { parseArgs } from 'node:util';

import { DEFAULT_PORT, startBoard } from './board.js';
import { openBrowser } from './open.js';

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { dir: { type: 'string' }, port: { type: 'string' }, open: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  if (positionals.length > 1 || (positionals.length && values.dir)) throw new Error('give one folder');
  const dir = positionals[0] ?? values.dir;
  if (values.help) {
    process.stdout.write(`Usage: open-backlog-board [<folder>] [--port <n>] [--open]\n\nThe board for the backlog in <folder> or a parent (default: here), at http://127.0.0.1:${DEFAULT_PORT}/\n(or the next free port). It listens on this computer only. Stop it with Ctrl-C.\n\n  --port <n>  listen on this port\n  --open      open it in your browser ($BROWSER, if set)\n`);
  } else {
    const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`--port ${values.port} is not a port number`);
    // No port given and 4310 is taken (another board, perhaps): the next free one, up to 4329.
    let board;
    for (let p = port; ; p++) {
      try {
        board = await startBoard({ ...(dir ? { dir } : {}), port: p });
        break;
      } catch (e) {
        if (values.port !== undefined || (e as NodeJS.ErrnoException).code !== 'EADDRINUSE' || p >= DEFAULT_PORT + 19) throw e;
      }
    }
    process.stdout.write(`Open Backlog board for ${board.backlogDir}\n${board.url}\n`);
    if (values.open) openBrowser(board.url, t => process.stderr.write(t));
    const stop = () => { void board.close().then(() => process.exit(0)); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }
} catch (e) {
  const err = e as NodeJS.ErrnoException;
  process.stderr.write(`open-backlog-board: ${err.code === 'EADDRINUSE' ? 'that port is taken; choose another with --port' : err.message}\n`);
  process.exitCode = 1;
}
