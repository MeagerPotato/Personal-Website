// Last step of `npm run verify`. Asserts properties of the BUILT site, so the same checks would
// validate any replacement for the page shell (docs/PLAN.md §5.1, "exit insurance").
//
//   1. dist/_headers exists and its CSP placeholder was filled
//   2. nothing dev-only leaked into production: the /lab page, the live tuning panel (lil-gui)
//   3. every internal link and asset reference resolves, and page links end with "/"; every
//      page names a link-preview image (og:image) that is absolute, on this site, and exists
//   4. PLAIN-MODE PURITY: no page can reach three.js through static imports. The engine must
//      only ever be reachable through a dynamic import(), which plain mode never executes.
//   5. WEIGHT BUDGETS: what plain mode costs per page, and what the lazy engine costs in total.
//   6. NO PLACEHOLDER COPY: "TODO(copy)" may sit in drafts and in source, never in what ships.
//   7. SWAP CONTRACT: outside <main> and [data-page-head], every page is byte-identical (the
//      nav's aria-current aside), and has exactly one <h1>. The router (Phase 2) swaps only
//      those parts, so this is what makes a soft navigation end in the same DOM as a hard one.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { posix, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { toPosix, walk } from './lib/fs.mjs';
import {
  canonicalUrl,
  extractEagerScripts,
  extractStaticImports,
  extractUrls,
  firstDifference,
  isPlainOnly,
  metaContent,
  pageSkeleton,
  toSitePath,
} from './lib/html.mjs';

const DIST = resolve(import.meta.dirname, '..', 'dist');
// three.js keeps "THREE.<Class>: ..." strings in its warnings, which survive minification.
const ENGINE_MARKER = /THREE\.[A-Z]\w+/;

// Tripwires, not targets, in gzip -9 bytes (a stable stand-in for what Cloudflare sends).
// Raise one deliberately, in a PR that says why.
const BUDGET = {
  /** HTML + CSS + every script a page loads WITHOUT a dynamic import: the cost of plain mode. */
  plainPage: 30 * 1024,
  /** All JavaScript reachable only through import(). Split per chunk when PostFX lands (Phase 1). */
  lazyScripts: 180 * 1024,
};

const errors = [];
const files = await walk(DIST);
if (files.length === 0) {
  console.error('verify-dist: dist/ is empty. Run `npm run build` first.');
  process.exit(1);
}
const sitePathOf = (file) => `/${toPosix(relative(DIST, file))}`;
const sitePaths = new Set(files.map(sitePathOf));
const htmlFiles = files.filter((file) => file.endsWith('.html'));

const gzipCache = new Map();
async function gzipSize(sitePath) {
  if (!gzipCache.has(sitePath)) {
    const bytes = await readFile(resolve(DIST, `.${sitePath}`));
    gzipCache.set(sitePath, gzipSync(bytes, { level: 9 }).length);
  }
  return gzipCache.get(sitePath);
}
const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

// 1 --- headers ---------------------------------------------------------------------------
if (!sitePaths.has('/_headers')) {
  errors.push('dist/_headers is missing (postbuild did not run)');
} else {
  const headers = await readFile(resolve(DIST, '_headers'), 'utf8');
  if (headers.includes('__INLINE_HASHES__'))
    errors.push('dist/_headers still has the CSP placeholder');
  if (!/script-src[^;]*'sha256-/.test(headers)) {
    errors.push('dist/_headers CSP has no inline-script hash: the mode script would be blocked');
  }
}

// 2 --- dev-only things ---------------------------------------------------------------------
if (existsSync(resolve(DIST, 'lab'))) errors.push('dist/lab exists: the dev-only /lab page leaked');

// The tuning panel and the lab are imported behind `import.meta.env.DEV`, which a production
// build removes. lil-gui names its CSS classes after itself and the lab names its scene
// 'universe-lab'; both strings survive minification.
for (const file of files.filter((name) => name.endsWith('.js') || name.endsWith('.css'))) {
  const text = await readFile(file, 'utf8');
  if (text.includes('lil-gui')) {
    errors.push(`${sitePathOf(file)} contains lil-gui: the dev-only tuning panel leaked`);
  }
  if (text.includes('universe-lab') || text.includes('lab-host')) {
    errors.push(`${sitePathOf(file)} contains the dev-only lab`);
  }
}

// 3 --- links ---------------------------------------------------------------------------------
const pagePathOf = (file) => sitePathOf(file).replace(/(^|\/)index\.html$/, '$1');

const pages = [];
let linkCount = 0;
for (const file of htmlFiles) {
  const pagePath = pagePathOf(file);
  const html = await readFile(file, 'utf8');
  const stylesheets = new Set();
  pages.push({ file, pagePath, html, stylesheets });

  for (const url of extractUrls(html)) {
    const target = toSitePath(url, pagePath);
    if (target === null) continue;
    linkCount += 1;

    const isFile = sitePaths.has(target);
    const isPage = sitePaths.has(posix.join(target, 'index.html'));
    if (isFile) {
      if (target.endsWith('.css')) stylesheets.add(target);
      continue;
    }
    if (isPage && target.endsWith('/')) continue;
    if (isPage) {
      errors.push(`${pagePath}: link "${url}" needs a trailing slash (it would 307 on Cloudflare)`);
    } else {
      errors.push(`${pagePath}: broken reference "${url}"`);
    }
  }
}

// Link previews are fetched by crawlers from another origin, so the URL must be absolute, and it
// must point at a file this build actually produced.
for (const page of pages) {
  const image = metaContent(page.html, 'og:image');
  const canonical = canonicalUrl(page.html);
  if (!image || !canonical) {
    errors.push(`${page.pagePath}: needs both <link rel="canonical"> and og:image`);
    continue;
  }
  if (!URL.canParse(image) || new URL(image).origin !== new URL(canonical).origin) {
    errors.push(`${page.pagePath}: og:image "${image}" must be an absolute URL on this site`);
  } else if (!sitePaths.has(decodeURIComponent(new URL(image).pathname))) {
    errors.push(`${page.pagePath}: og:image "${image}" does not exist in dist/`);
  }
}

// 4 --- plain-mode purity -------------------------------------------------------------------
const scriptSource = new Map();
for (const sitePath of sitePaths) {
  if (sitePath.endsWith('.js'))
    scriptSource.set(sitePath, await readFile(resolve(DIST, `.${sitePath}`), 'utf8'));
}
const engineChunks = [...scriptSource].filter(([, js]) => ENGINE_MARKER.test(js)).map(([p]) => p);

/** Chunks reachable from `entry` through STATIC imports only, each mapped to its importer. */
function staticClosure(entry) {
  const importers = new Map([[entry, null]]);
  const queue = [entry];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const specifier of extractStaticImports(scriptSource.get(current) ?? '')) {
      const next = toSitePath(specifier, current);
      if (next && scriptSource.has(next) && !importers.has(next)) {
        importers.set(next, current);
        queue.push(next);
      }
    }
  }
  return importers;
}

const eagerScripts = new Set();
for (const page of pages) {
  page.scripts = new Set();
  for (const url of extractEagerScripts(page.html)) {
    const entry = toSitePath(url, page.pagePath);
    if (!entry || !scriptSource.has(entry)) continue;

    const importers = staticClosure(entry);
    for (const chunk of importers.keys()) {
      page.scripts.add(chunk);
      eagerScripts.add(chunk);
    }
    for (const chunk of engineChunks.filter((path) => importers.has(path))) {
      const trail = [];
      for (let step = chunk; step; step = importers.get(step)) trail.unshift(step);
      errors.push(
        `${page.pagePath}: three.js is reachable WITHOUT a dynamic import via ` +
          `${trail.join(' -> ')}. Plain mode would download the engine.`,
      );
    }
  }
}

// 5 --- weight budgets ------------------------------------------------------------------------
let heaviest = { pagePath: '', weight: 0 };
for (const page of pages) {
  let weight = await gzipSize(sitePathOf(page.file));
  for (const asset of [...page.stylesheets, ...page.scripts]) weight += await gzipSize(asset);
  if (weight > heaviest.weight) heaviest = { pagePath: page.pagePath, weight };
  if (weight > BUDGET.plainPage) {
    errors.push(
      `${page.pagePath}: plain mode weighs ${kib(weight)} gzipped (HTML + CSS + eager JS); ` +
        `the budget is ${kib(BUDGET.plainPage)}`,
    );
  }
}

let lazyWeight = 0;
for (const sitePath of scriptSource.keys()) {
  if (!eagerScripts.has(sitePath)) lazyWeight += await gzipSize(sitePath);
}
if (lazyWeight > BUDGET.lazyScripts) {
  errors.push(
    `lazy JavaScript (the engine) weighs ${kib(lazyWeight)} gzipped; ` +
      `the budget is ${kib(BUDGET.lazyScripts)}`,
  );
}

// 6 --- no placeholder copy -------------------------------------------------------------------
const PLACEHOLDER = 'TODO(copy)';
for (const file of files.filter((path) => /\.(html|json|xml|txt)$/.test(path))) {
  if ((await readFile(file, 'utf8')).includes(PLACEHOLDER)) {
    errors.push(
      `${sitePathOf(file)}: contains "${PLACEHOLDER}". Write the copy, or mark it a draft.`,
    );
  }
}

// 7 --- swap contract ---------------------------------------------------------------------------
const swappable = pages.filter((page) => !isPlainOnly(page.html));
let reference = null;
// Shortest path first, so the home page is the reference everything else is compared with.
for (const page of [...swappable].sort((a, b) => a.pagePath.length - b.pagePath.length)) {
  const headings = page.html.match(/<h1[\s>]/gi)?.length ?? 0;
  if (headings !== 1) {
    errors.push(`${page.pagePath}: has ${headings} <h1> elements; the router focuses THE heading`);
  }

  let skeleton;
  try {
    skeleton = pageSkeleton(page.html);
  } catch (error) {
    errors.push(`${page.pagePath}: ${error.message}`);
    continue;
  }
  if (reference === null) {
    reference = { pagePath: page.pagePath, skeleton };
    continue;
  }
  const difference = firstDifference(reference.skeleton, skeleton);
  if (difference) {
    errors.push(
      [
        `${page.pagePath}: differs from ${reference.pagePath} outside <main> and ` +
          `[data-page-head], at character ${difference.index}`,
        `${reference.pagePath} has ${difference.expected}`,
        `${page.pagePath} has ${difference.actual}`,
        'Per-page markup belongs inside <main>; per-page <head> nodes need data-page-head.',
      ].join('\n      '),
    );
  }
}

// --- report ------------------------------------------------------------------------------------
if (errors.length > 0) {
  console.error(`verify-dist: ${errors.length} problem(s)\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}
console.log(
  `verify-dist: OK. ${htmlFiles.length} page(s), ${linkCount} internal reference(s), ` +
    `${engineChunks.length} engine chunk(s), none statically reachable from any page; ` +
    `${swappable.length} page(s) share one skeleton.\n` +
    `  plain mode: heaviest page ${heaviest.pagePath} = ${kib(heaviest.weight)} ` +
    `of ${kib(BUDGET.plainPage)}; lazy JS = ${kib(lazyWeight)} of ${kib(BUDGET.lazyScripts)} (gzip)`,
);
if (engineChunks.length === 0) {
  console.warn('verify-dist: note: no chunk contains three.js, so the purity check was vacuous.');
}
