// Before any npm publish (by the Publish workflow, or by hand for the very first version): the
// package must be exactly what's committed, and the README's images must be this version's, since
// the npm page shows them from the published package (jsDelivr serves its files). npm run check
// then builds and tests it.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { readmeImages } from './readme-images.mjs';

const root = new URL('..', import.meta.url).pathname;
const { version } = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));
const problems = [];
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
if (dirty) problems.push(`commit these first, so what's published is what's in git:\n${dirty}`);
problems.push(...readmeImages(root, version));
if (problems.length) {
  console.error(`prepublish: not publishing ${version}.\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`prepublish: ${version} is committed and its README images are its own`);
