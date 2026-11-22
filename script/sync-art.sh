#!/bin/sh
# Copy the brand from backlog-art (the sibling repo) into the app: the design tokens and fonts
# into app/src/art/, the favicons and the board icon into app/public/. Run it after
# backlog-art changes, then commit. A copy, not a link, so the build never needs backlog-art.
set -e
ART="$(cd "$(dirname "$0")/../../backlog-art" && pwd)"
cd "$(dirname "$0")/.."
mkdir -p app/src/art/tokens app/src/art/fonts app/public
cp "$ART"/tokens/tokens.css app/src/art/tokens/
cp "$ART"/fonts/*.ttf "$ART"/fonts/OFL.txt app/src/art/fonts/
cp "$ART"/icons/favicon.svg "$ART"/icons/favicon.ico "$ART"/icons/favicon-16.png "$ART"/icons/favicon-32.png "$ART"/icons/apple-touch-icon.png "$ART"/icons/board-icon.png app/public/
echo "sync-art: from backlog-art $(git -C "$ART" rev-parse --short HEAD)"
