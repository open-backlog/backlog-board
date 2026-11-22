# backlog-board

The local board for [Open Backlog](https://openbacklog.org): a web board over a backlog of
Markdown files in git, published to npm as **`open-backlog-board`**. `ob serve` starts it for
the backlog you're in and opens your browser. You never build anything: the app ships built.

**Status: the board view (2.4.3).** Columns of cards you drag to move or reorder, with filters,
over the JSON API below. The item editor, plan view and Sync arrive in 2.4.4–2.4.6, and the npm
package in 2.4.7 (`private` until then).

## Try it

From this checkout, on any repository with a `backlog/` (a scratch copy is safest: every drag is
a real commit there):

```sh
npm install
npm start -- --dir ~/path/to/repo     # builds, then http://127.0.0.1:4310/
```

## The board

- **Columns:** todo, doing and done, each card with its ID, type, title, repos and assignee, in
  column order: cards with a `rank` first, lowest first, then by ID (the spec's order, from
  open-backlog). Done shows the last 30 days; "All done items" shows the rest.
- **Drag to another column** to move a card: the same commit as `ob move`. It lands in that
  column's order. The ← → buttons on a card do the same without a mouse.
- **Drag within a column** to reorder: only that card's `rank` changes, in one commit
  (`ob: edit 1.2.2 rank`). Cards without a rank come after ranked ones, so a card dropped among
  them goes just after the ranked cards instead: changing other cards' ranks to fit it would
  change files you didn't touch.
- **Filters:** epic, then its features, repo and type.
- A change the server refuses (such as a card whose file has your uncommitted edits) shows its
  message, and the cards go back to where they are on disk. Edits made in an editor appear at once.

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

## The API

Each route calls the same `open-backlog` function as the `ob` command, so it answers the same:

| Route | |
|---|---|
| `GET /api/items?status=&type=&parent=&repo=&assignee=&sprint=&all=1` | stories, bugs, spikes and tasks, as `ob list` (filters take comma lists) |
| `GET /api/items/:id` | one item, as `ob show --json` |
| `GET /api/board?parent=&repo=&type=&all=1` | the three columns in column order, the hidden done count, and the filter choices |
| `GET /api/tree?all=1` | the plan with progress, as `ob tree --json` |
| `GET /api/validate` | every problem, as `ob validate --json` |
| `GET /api/events` | server-sent events: `change`, with the paths, whenever a file in the backlog changes |
| `POST /api/items` `{ type, title, parent?, slug? }` | a new item, as `ob new` |
| `POST /api/items/:id/move` `{ status }` | as `ob move` |
| `PATCH /api/items/:id` `{ fields: { name: value } }` | change front-matter fields (`null` removes one) |
| `POST /api/items/:id/comments` `{ text, handle? }` | as `ob comment` |
| `POST /api/items/:id/rank` `{ after }` | reorder in its column, after that card (`null`: the top), by its own `rank` |

Every change is one commit of only the files it touched, with the CLI's message
(`ob: move 2.3.4 to doing`, `ob: edit 2.3.4 assignee`). Your other work is never included: files
you have staged, changed or added stay as they were, and an item whose own file has changes you
haven't committed is refused (409) until you commit or undo them. An edit that would break a rule
`ob validate` checks is refused with its message, and the file is put back. Changes run one at a
time.

Only the board's own page may make changes: a change must carry the board's `Origin` and be JSON,
so a web page elsewhere can't make one. Reading needs neither. The events come from watching the
backlog folder, so an edit saved in a text editor reaches the board within a second.

## Develop

Node 22 or later.

```sh
npm install
npm run dev          # http://127.0.0.1:4300/ against test/fixtures/t3-application
npm run check        # lint, build, test, smoke: what CI runs on every push
```

`npm run dev` runs the server on 127.0.0.1:4310 (restarted on every change) and the Angular dev
server on 127.0.0.1:4300, which reloads the app and passes `/api` to the server (as the board's
own origin, so changes made in development are accepted). To serve
another backlog: `npm run dev -- --dir ../my-repo/backlog`.

| Path | |
|---|---|
| `server/board.ts` | `startBoard()`: the server, its host and origin checks, and the app's files |
| `server/api.ts` | the API over `open-backlog`, and the events |
| `server/main.ts` | the `open-backlog-board` command |
| `app/` | the Angular app (`app/src`): the shell (`app.ts`), the board (`board.ts`), the events, its config and the dev proxy |
| `test/` | the server's tests (Vitest); the app's tests are `app/src/**/*.spec.ts` (`ng test`) |
| `test/fixtures/` | two of backlog-spec's example backlogs, copied by `script/sync-fixtures.sh` |
| `script/sync-art.sh` | copies backlog-art's tokens, fonts and icons into the app |
| `script/smoke.mjs` | packs the package, checks its files, installs it globally into a temporary folder, starts it and fetches the app and the API |

## License

MIT. The specification is CC BY 4.0.
