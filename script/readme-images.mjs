// The README's images (2.4.7): the npm page shows them from the published package on jsDelivr,
// so each must be https://cdn.jsdelivr.net/npm/open-backlog-board@<this version>/screenshots/<name>.png
// and the file must be in the package. Used by smoke.mjs and prepublish.mjs.
import { readFileSync } from 'node:fs';

/** Every README image is this version's screenshots/<name>.png on jsDelivr, and the file exists. */
export function readmeImages(root, v) {
  const readme = readFileSync(`${root}README.md`, 'utf8');
  const urls = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1]);
  const out = [];
  if (!urls.length) out.push('the README has no screenshots');
  for (const u of urls) {
    const m = /^https:\/\/cdn\.jsdelivr\.net\/npm\/open-backlog-board@([^/]+)\/(screenshots\/[a-z-]+\.png)$/.exec(u);
    if (!m) out.push(`README image ${u} isn't https://cdn.jsdelivr.net/npm/open-backlog-board@${v}/screenshots/<name>.png`);
    else if (m[1] !== v) out.push(`README image ${u} is for ${m[1]}; this is ${v}`);
    else {
      try { readFileSync(`${root}${m[2]}`); } catch { out.push(`README image ${m[2]} isn't in the repository`); }
    }
  }
  return out;
}
