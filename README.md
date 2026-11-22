# open-backlog-board

The local board for [Open Backlog](https://openbacklog.org), where a backlog is Markdown files in
your git repository: one file per story, in a `todo`, `doing` or `done` folder. The board shows
those files as columns of cards you drag, a tree of the whole plan with its progress, and a Sync
button that shares your changes through your own git. It runs on your computer only, and every
change is a git commit you can read.

![The board: todo, doing and done columns of cards, with filters](https://cdn.jsdelivr.net/npm/open-backlog-board@0.1.0/screenshots/board.png)

## Start it

You need [Node.js](https://nodejs.org) 22 or later and git. In a repository that has a backlog
(a `backlog/` folder with `config.yml`):

```sh
npx open-backlog-board
```

or for any folder, without changing to it:

```sh
npx open-backlog-board ~/path/to/repo
```

Then open the address it prints, normally **http://127.0.0.1:4310/** (if that port is taken, it
uses the next free one). Stop it with Ctrl-C. To keep it installed:

```sh
npm install --global open-backlog-board
open-backlog-board ~/path/to/repo
```

No backlog yet? `npx open-backlog init` makes one (see
[open-backlog](https://www.npmjs.com/package/open-backlog), the `ob` command). Soon `ob serve`
will start the board and open your browser in one step.

Every drag and every save is a real commit in that repository, made with your git name, so try it
on a copy first if you like. Nothing leaves your computer until you click **Sync**.

```sh
open-backlog-board [<folder>] [--port <n>]   # default: here, port 4310 (or the next free one)
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

## An item

![An item open beside the board: where it sits, its fields, description and comments](https://cdn.jsdelivr.net/npm/open-backlog-board@0.1.0/screenshots/item.png)

Click a card's title to open it beside the board:

- **Where it sits** (capability › epic › feature, each one a link), its type, status and file.
- **Fields**, every one in the file, your own included. **Edit** changes them in a form: an
  emptied field is removed, **+ Field** adds one, `id` and `type` stay as they are. Only the
  fields you changed are saved, keeping their kind (a number stays a number, a list a list).
- **Description**, rendered from Markdown. **Edit** opens the Markdown; the comments below it
  are kept as they are.
- **Children**, with their status, for a feature, epic or capability, and its progress.
- **Comments**, and a box to add one: the same dated, signed line `ob comment` writes, signed with
  `git config ob.handle`.
- **History**: every commit that touched the file, with its date and author; each move between
  columns is marked (→ doing, → done).

Each save is one commit (`ob: edit 1.1.2 assignee, description`). A change `ob validate` would
report, such as a parent that doesn't exist, is refused with its message, which stays on screen,
and the file is left as it was.

**+ New** makes a story, bug, spike, task, feature or epic, as `ob new` does: you choose the type,
title and parent (a feature for story-level items, an epic for a feature; a bug or task can go
into this month's unplanned work), and it opens when it's made.

## The tree

![The tree: capabilities, epics and features, each with a progress bar](https://cdn.jsdelivr.net/npm/open-backlog-board@0.1.0/screenshots/tree.png)

**Tree** (at the top, or `/#tree`) shows the plan: capabilities, epics and features, nested, each
with a progress bar from its stories, bugs, spikes and tasks: done in green, doing beside it, and
"1 of 2 done (50%)", the same numbers as `ob tree`. A feature with nothing in it yet is "0 of 0
done". The plan's total is at the top; epic 0's monthly features (the unplanned work) sit beside
it with theirs. Click a feature or an epic to open the board filtered to it.

## Sync

![Sync, with the two commits it will send](https://cdn.jsdelivr.net/npm/open-backlog-board@0.1.0/screenshots/sync.png)

Every change on the board is a commit in your repository, and none of it leaves your computer
until you click **Sync** (top right). Beside it, "3 to share" counts your commits that aren't on
the remote branch yet; click it to see them. Sync sends every commit on your branch that isn't
shared, including ones you made outside the board.

**Sync** runs `git pull --rebase`, then `git push`, with your own git: your name, SSH key or
credential helper, hooks and settings. The board never asks for a password or a token. If git
would have to ask, Sync stops with a message: check that `git pull` and `git push` work in a
terminal. The board waits while Sync runs.

- **A conflict** (your change and a teammate's touch the same lines) stops Sync before anything
  is sent. git is left partway through the rebase, so you can see everything and nothing is
  resolved for you. The board lists the files and the commands: fix the marked parts, then
  `git add` and `git rebase --continue`, or `git rebase --abort` to go back. Until then the board
  makes no changes, and the item whose file has conflict markers is left off it until it can be
read again; **Check again** looks once you're done.
- **Uncommitted changes** to tracked files stop Sync, since a pull would refuse them: commit or
  stash them first. Untracked files are fine.
- **A branch with no remote branch yet:** share it once from a terminal
  (`git push -u origin <branch>`), then Sync.

## How it works

- `server/`: a small HTTP server on **127.0.0.1 only**, so nothing else on the network can reach
  it. It answers only requests addressed to `127.0.0.1` or `localhost` on its port, which stops a
  web page from pointing its own name at it. It serves the built app and a JSON API.
- `app/`: the Angular app, built into the package (`dist/app`), with backlog-art's colors, type
  and icons; light or dark follows your system.
- Every rule comes from [`open-backlog`](https://www.npmjs.com/package/open-backlog), the same
  core as the `ob` command: reading the files, IDs, validation and git. It's the board's only
  run-time dependency, and lint stops the server from importing a YAML or schema library or
  running git itself, so the board and the CLI can't disagree. The board depends on the same
  minor version of `open-backlog` it was tested with (`^0.2.0`: any 0.2.x, never 0.3), since
  while Open Backlog is 0.x a minor version is where its rules can change.

## The API

Every route is under `/api/v1/`, so a later, different API can sit
beside it. Each route calls the same `open-backlog` function as the `ob` command, so it answers the same:

| Route | |
|---|---|
| `GET /api/v1/items?status=&type=&parent=&repo=&assignee=&sprint=&all=1` | stories, bugs, spikes and tasks, as `ob list` (filters take comma lists) |
| `GET /api/v1/items/:id` | one item, as `ob show --json`, with its `description` |
| `GET /api/v1/board?parent=&repo=&type=&all=1` | the three columns in column order, the hidden done count, and the filter choices |
| `GET /api/v1/tree?all=1` | the plan with progress, as `ob tree --json` |
| `GET /api/v1/validate` | every problem, as `ob validate --json` |
| `GET /api/v1/events` | server-sent events: `change`, with the paths, whenever a file in the backlog changes |
| `POST /api/v1/items` `{ type, title, parent?, slug? }` | a new item, as `ob new` |
| `POST /api/v1/items/:id/move` `{ status }` | as `ob move` |
| `PATCH /api/v1/items/:id` `{ fields?: { name: value }, description? }` | change front-matter fields (`null` removes one) and the description (the body up to `## Comments`) |
| `POST /api/v1/items/:id/comments` `{ text, handle? }` | as `ob comment` |
| `POST /api/v1/items/:id/rank` `{ after }` | reorder in its column, after that card (`null`: the top), by its own `rank` |
| `GET /api/v1/sync` | branch, remote branch, commits not shared yet, uncommitted files, and any conflict in progress |
| `POST /api/v1/sync` | Sync: `git pull --rebase`, then `git push`; `{ received, sent, status }`, or the reason and any conflict (`{ kind, files, steps }`) |

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

From a checkout of this repository, with Node 22 or later:

```sh
npm install
npm start ~/path/to/repo   # build, then run it on that repository
npm run dev                # http://127.0.0.1:4300/ against test/fixtures/t3-application
npm run check              # lint, build, test, smoke: what CI runs on every push
```

`npm run dev` runs the server on 127.0.0.1:4310 (restarted on every change) and the Angular dev
server on 127.0.0.1:4300, which reloads the app and passes `/api` to the server (as the board's
own origin, so changes made in development are accepted). To serve
another backlog: `npm run dev ../my-repo`.

| Path | |
|---|---|
| `server/board.ts` | `startBoard()`: the server, its host and origin checks, and the app's files |
| `server/api.ts` | the API over `open-backlog`, and the events |
| `server/main.ts` | the `open-backlog-board` command |
| `app/` | the Angular app (`app/src`): the shell (`app.ts`), the board (`board.ts`), the item panel and new-item form, the events, its config and the dev proxy |
| `test/` | the server's tests (Vitest); the app's tests are `app/src/**/*.spec.ts` (`ng test`) |
| `test/fixtures/` | two of backlog-spec's example backlogs, copied by `script/sync-fixtures.sh` |
| `script/sync-art.sh` | copies backlog-art's tokens, fonts and icons into the app |
| `script/smoke.mjs` | packs the package, checks its files, installs it globally into a temporary folder, starts it and fetches the app and the API |
| `script/prepublish.mjs` | before any `npm publish`: refuses uncommitted changes and README images for another version |
| `screenshots/` | the README's images, shipped in the package so the npm page can show them |

### Releasing

Change `"version"` in `package.json` (and the version in the README's image links: `npm run
check` fails until they match), commit and push to `main`. The Publish workflow publishes that
version to npm when it isn't there yet, after the full check, and tags the commit `v<version>`.
A push that doesn't change the version publishes nothing.

## License

MIT. The specification is CC BY 4.0.
