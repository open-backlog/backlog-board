# Contributing

The board is meant to stay small: a view over the backlog files, with every rule coming from
`open-backlog`. So most of the work is deciding what not to add.

1. **Open an issue** from its template: **bug** (something the board does wrong) or **idea**
   (anything else). A change to the rules of the format belongs in the
   [specification](https://github.com/open-backlog/backlog-spec) instead.
2. **Open a pull request** that links the issue and makes that one change. `npm run check`
   (lint, build, tests and the smoke test) must pass, as it does in CI.

The author (@brandon-castagna) approves every pull request. A change is accepted when it keeps
the board simple, leaves every rule to `open-backlog`, and makes each action one git commit that
reads like a careful hand edit.

Contributions are licensed under [MIT](LICENSE), like the code. The Open Backlog name and logo
are not part of that license.

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
