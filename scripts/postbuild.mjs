// Runs after `astro build`. Generates dist/_headers from config/headers.template, filling the CSP
// with the sha256 of every inline script that ACTUALLY shipped. Hashing the real output (instead
// of maintaining hashes by hand) means a changed mode script can never silently break the CSP.

import { readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { toPosix, walk } from './lib/fs.mjs';
import { cspHash, extractInlineScripts } from './lib/html.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = resolve(ROOT, 'dist');
const TEMPLATE = resolve(ROOT, 'config/headers.template');
const PLACEHOLDER = '__INLINE_HASHES__';

// The design calls for exactly ONE inline script (src/shell/mode.inline.js). A little headroom is
// allowed, but a growing number means something started inlining scripts per page, which would
// eventually blow Cloudflare's 2,000-characters-per-line limit for _headers.
const MAX_DISTINCT_INLINE_SCRIPTS = 6;
const MAX_HEADER_LINE = 2000;

const htmlFiles = (await walk(DIST)).filter((file) => file.endsWith('.html'));
if (htmlFiles.length === 0) {
  console.error('postbuild: no HTML files in dist/. Did `astro build` run?');
  process.exit(1);
}

/** hash -> first page it was seen on */
const seen = new Map();
for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  for (const code of extractInlineScripts(html)) {
    const hash = cspHash(code);
    if (!seen.has(hash)) seen.set(hash, toPosix(relative(DIST, file)));
  }
}

if (seen.size > MAX_DISTINCT_INLINE_SCRIPTS) {
  const list = [...seen].map(([hash, page]) => `${hash}  (first seen in ${page})`);
  console.error(
    `postbuild: ${seen.size} distinct inline scripts found; the budget is ${MAX_DISTINCT_INLINE_SCRIPTS}.\n` +
      `Something is inlining scripts per page. See docs/PLAN.md §5.1 ("thin Astro").\n  - ` +
      list.join('\n  - '),
  );
  process.exit(1);
}

const template = await readFile(TEMPLATE, 'utf8');
if (!template.includes(PLACEHOLDER)) {
  console.error(`postbuild: ${PLACEHOLDER} is missing from config/headers.template`);
  process.exit(1);
}

const headers = template
  .split('\n')
  .filter((line) => !line.startsWith('#'))
  .join('\n')
  .replace(PLACEHOLDER, [...seen.keys()].join(' '))
  .replace(/^\n+/, '');

const tooLong = headers.split('\n').filter((line) => line.length > MAX_HEADER_LINE);
if (tooLong.length > 0) {
  console.error(
    `postbuild: a _headers line exceeds Cloudflare's ${MAX_HEADER_LINE}-character limit ` +
      `(${tooLong[0].length} chars).`,
  );
  process.exit(1);
}

await writeFile(resolve(DIST, '_headers'), headers, 'utf8');
console.log(
  `postbuild: wrote dist/_headers with ${seen.size} inline-script hash(es) from ${htmlFiles.length} page(s)`,
);
