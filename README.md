# backlog-board

The local board for [Open Backlog](https://openbacklog.org): a web board over a backlog of
Markdown files in git, published to npm as **`open-backlog-board`**. `ob serve` starts it for
the backlog you're in and opens your browser. You never build anything: the app ships built.

**Status: scaffold (2.4.1).** The server answers on this computer only and shows which backlog
it serves; the columns, item editor, plan view and Sync arrive in 2.4.2–2.4.6, and the npm
package in 2.4.7 (`private` until then).

## How it works

- `server/`: a small HTTP server on **127.0.0.1 only**, so nothing else on the network can reach
  it. It answers only requests addressed to `127.0.0.1` or `localhost` on its port, which stops a
  web page from pointing its own name at it. It serves the built app and a JSON API.
- `app/`: the Angular app, built into the package (`dist/app`), with backlog-art's colors, type
  and icons; light or dark follows your system.
- Every rule comes from [`open-backlog`](https://www.npmjs.com/package/open-backlog), the same
  core as the `ob` command: reading the files, IDs, validation and git. It's the board's only
  run-time dependency, and lint stops the server from importing a YAML or schema library or
  running git itself, so the board and the CLI can't disagree.

```sh
open-backlog-board [--dir <folder>] [--port <n>]   # default: here, port 4310
```

## Develop

Node 22 or later.

```sh
npm install
npm run dev          # http://127.0.0.1:4300/ against test/fixtures/t3-application
npm run check        # lint, build, test, smoke: what CI runs on every push
```

`npm run dev` runs the server on 127.0.0.1:4310 (restarted on every change) and the Angular dev
server on 127.0.0.1:4300, which reloads the app and passes `/api` to the server. To serve
another backlog: `npm run dev -- --dir ../my-repo/backlog`.

| Path | |
|---|---|
| `server/board.ts` | `startBoard()`: the server, its host check, the app's files and the API |
| `server/main.ts` | the `open-backlog-board` command |
| `app/` | the Angular app (`app/src`), its config and the dev proxy |
| `test/` | the server's tests (Vitest); the app's tests are `app/src/**/*.spec.ts` (`ng test`) |
| `test/fixtures/` | two of backlog-spec's example backlogs, copied by `script/sync-fixtures.sh` |
| `script/sync-art.sh` | copies backlog-art's tokens, fonts and icons into the app |
| `script/smoke.mjs` | packs the package, checks its files, installs it globally into a temporary folder, starts it and fetches the app and the API |

## License

MIT. The specification is CC BY 4.0.
