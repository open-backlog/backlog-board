#!/bin/sh
# Copy two of backlog-spec's example backlogs (the sibling repo) into test/fixtures/, replacing
# what is here: t1-minimal (the smallest) and t3-application (one app, three repos, most
# fields), which npm run dev serves. Run it after backlog-spec's examples change, then commit.
# Copies, not links, so tests and CI never need a backlog-spec checkout.
set -e
SPEC="$(cd "$(dirname "$0")/../../backlog-spec" && pwd)"
cd "$(dirname "$0")/.."
rm -rf test/fixtures
mkdir -p test/fixtures
for t in t1-minimal t3-application; do cp -R "$SPEC/examples/$t" "test/fixtures/$t"; done
echo "sync-fixtures: $(find test/fixtures -type f | wc -l | tr -d ' ') files from backlog-spec $(git -C "$SPEC" rev-parse --short HEAD)"
