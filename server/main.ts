#!/usr/bin/env node
// open-backlog-board [--dir <folder>] [--port <n>]: the board for the backlog found from --dir (or
// here), on 127.0.0.1. ob serve (2.4.8) starts it and opens the browser.
import { parseArgs } from 'node:util';

import { DEFAULT_PORT, startBoard } from './board.js';

try {
  const { values } = parseArgs({ options: { dir: { type: 'string' }, port: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) {
    process.stdout.write(`Usage: open-backlog-board [--dir <folder>] [--port <n>]\n\nThe board for the backlog in <folder> or a parent (default: here), at http://127.0.0.1:${DEFAULT_PORT}/.\nIt listens on this computer only. Stop it with Ctrl-C.\n`);
  } else {
    const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`--port ${values.port} is not a port number`);
    const board = await startBoard({ ...(values.dir ? { dir: values.dir } : {}), port });
    process.stdout.write(`Open Backlog board for ${board.backlogDir}\n${board.url}\n`);
    const stop = () => { void board.close().then(() => process.exit(0)); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }
} catch (e) {
  const err = e as NodeJS.ErrnoException;
  process.stderr.write(`open-backlog-board: ${err.code === 'EADDRINUSE' ? 'that port is taken; choose another with --port' : err.message}\n`);
  process.exitCode = 1;
}
