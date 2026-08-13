/**
 * Rewrites __BASE_URL__ in the static PWA files that Vite copies verbatim.
 *
 * Vite applies `base` to index.html and asset URLs, but files in
 * client/public/ are passed through untouched. sw.js and manifest.json both
 * contain absolute paths, so on GitHub Pages (base /pretracheal-monitor/)
 * they would point at the domain root: the PWA would install with the wrong
 * start_url and icons, and the service worker would precache URLs that 404.
 *
 * This used to be patched by hand directly on the gh-pages branch, which meant
 * every deploy risked silently reverting it.
 */

import fs from 'node:fs';
import path from 'node:path';

const base = process.env.GITHUB_PAGES === 'true' ? '/pretracheal-monitor/' : '/';
const outDir = path.resolve(import.meta.dirname, '..', 'dist', 'public');
const targets = ['sw.js', 'manifest.json'];

let patched = 0;
for (const name of targets) {
  const file = path.join(outDir, name);
  if (!fs.existsSync(file)) {
    console.error(`apply-base: expected ${name} in ${outDir}`);
    process.exit(1);
  }
  const original = fs.readFileSync(file, 'utf8');
  if (!original.includes('__BASE_URL__')) {
    console.error(`apply-base: no __BASE_URL__ placeholder in ${name}`);
    process.exit(1);
  }
  fs.writeFileSync(file, original.replaceAll('__BASE_URL__', base));
  patched += 1;
}

console.log(`apply-base: rewrote ${patched} file(s) with base ${base}`);
