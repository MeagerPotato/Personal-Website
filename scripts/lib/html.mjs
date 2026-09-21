// Pure helpers shared by postbuild.mjs and verify-dist.mjs. No I/O here, so they are unit-tested
// in tests/build-scripts.test.ts. Regex-based on purpose: the input is our own generated HTML,
// and staying dependency-free keeps the build scripts trivially portable to another shell.

import { createHash } from 'node:crypto';

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

// Script types the browser executes or otherwise subjects to CSP script-src.
const EXECUTABLE_TYPES = new Set([
  '',
  'module',
  'importmap',
  'speculationrules',
  'text/javascript',
  'application/javascript',
]);

/** Parse an attribute string like ` type="module" src=/x.js defer` into a plain object. */
export function parseAttributes(source) {
  const attrs = {};
  for (const match of source.matchAll(ATTR_RE)) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attrs;
}

/**
 * Inline scripts that CSP cares about: no `src`, an executable type, and a non-empty body.
 * Data blocks (application/ld+json, application/json, ...) are skipped: CSP ignores them.
 * Returns the body EXACTLY as written, because the CSP hash covers every byte.
 */
export function extractInlineScripts(html) {
  const scripts = [];
  for (const match of html.matchAll(SCRIPT_RE)) {
    const attrs = parseAttributes(match[1]);
    if ('src' in attrs) continue;
    const type = (attrs.type ?? '').trim().toLowerCase();
    if (!EXECUTABLE_TYPES.has(type)) continue;
    if (match[2].trim() === '') continue;
    scripts.push(match[2]);
  }
  return scripts;
}

/** CSP source expression for an inline script body, e.g. 'sha256-AbCd...='. */
export function cspHash(code) {
  return `'sha256-${createHash('sha256').update(code, 'utf8').digest('base64')}'`;
}

const URL_ATTR_RE = /\s(?:href|src|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
const SRCSET_RE = /\ssrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/** Every URL a page references through href/src/poster/srcset, in document order. */
export function extractUrls(html) {
  const urls = [];
  for (const match of html.matchAll(URL_ATTR_RE)) {
    urls.push(match[1] ?? match[2] ?? match[3]);
  }
  for (const match of html.matchAll(SRCSET_RE)) {
    for (const candidate of (match[1] ?? match[2]).split(',')) {
      const url = candidate.trim().split(/\s+/)[0];
      if (url) urls.push(url);
    }
  }
  return urls;
}

/** JS files a page loads eagerly: <script src> and <link rel="modulepreload">. */
export function extractEagerScripts(html) {
  const urls = [];
  for (const match of html.matchAll(SCRIPT_RE)) {
    const attrs = parseAttributes(match[1]);
    if (attrs.src) urls.push(attrs.src);
  }
  for (const match of html.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = parseAttributes(match[1]);
    if ((attrs.rel ?? '').toLowerCase().split(/\s+/).includes('modulepreload') && attrs.href) {
      urls.push(attrs.href);
    }
  }
  return urls;
}

const STATIC_IMPORT_RE = /\bimport\s*(?:[\w*${}\s,]+?\s*from\s*)?["']([^"']+)["']/g;
const REEXPORT_RE = /\bexport\s*[\w*${}\s,]*?\s*from\s*["']([^"']+)["']/g;

/**
 * Specifiers a built chunk imports STATICALLY. Dynamic `import("...")` is excluded on purpose:
 * that is exactly the seam plain mode relies on (the engine is only ever reached dynamically).
 */
export function extractStaticImports(js) {
  const specifiers = new Set();
  for (const match of js.matchAll(STATIC_IMPORT_RE)) specifiers.add(match[1]);
  for (const match of js.matchAll(REEXPORT_RE)) specifiers.add(match[1]);
  return [...specifiers];
}

/**
 * Classify a URL found on a page. Returns null for anything we do not check (external,
 * mailto:, data:, pure query/hash links), else the site-absolute pathname it points to.
 */
export function toSitePath(url, pagePath) {
  if (!url || url.startsWith('#') || url.startsWith('?')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return null;
  const resolved = new URL(url, `https://site.invalid${pagePath}`);
  return decodeURIComponent(resolved.pathname);
}

// --- the swap contract (docs/PLAN.md §5.1) ---------------------------------------------------------

const MAIN_OPEN_RE = /<main\b[^>]*>/gi;
const MAIN_CLOSE = '</main>';
const PAGE_HEAD_PAIRED_RE =
  /<(title|script|style)\b[^>]*\sdata-page-head\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const PAGE_HEAD_VOID_RE = /<(?:meta|link)\b[^>]*\sdata-page-head\b[^>]*>/gi;
const ARIA_CURRENT_RE = /\saria-current\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+)/gi;

/** Pages that never boot the engine (the 404). The router never swaps one in, so they are exempt. */
export function isPlainOnly(html) {
  return /<html\b[^>]*\sdata-plain-only\b/i.test(html);
}

/**
 * A page with everything the router swaps taken out: the children of <main>, every
 * [data-page-head] node, and the nav's aria-current attributes. What is left must be
 * byte-identical on every page, or a soft navigation and a hard one would end in different DOMs.
 */
export function pageSkeleton(html) {
  const opens = [...html.matchAll(MAIN_OPEN_RE)];
  const close = html.lastIndexOf(MAIN_CLOSE);
  if (opens.length !== 1 || close < 0 || html.indexOf(MAIN_CLOSE) !== close) {
    throw new Error('expected exactly one <main> element');
  }
  const bodyStart = opens[0].index + opens[0][0].length;
  // <main> is emptied FIRST, so nothing a page says inside it can look like a head node.
  return (html.slice(0, bodyStart) + html.slice(close))
    .replace(PAGE_HEAD_PAIRED_RE, '')
    .replace(PAGE_HEAD_VOID_RE, '')
    .replace(ARIA_CURRENT_RE, '');
}

/** Where two strings first differ, with a little context: an error message a person can act on. */
export function firstDifference(expected, actual, context = 70) {
  if (expected === actual) return null;
  let index = 0;
  while (index < expected.length && index < actual.length && expected[index] === actual[index]) {
    index += 1;
  }
  const from = Math.max(0, index - context);
  const excerpt = (text) => JSON.stringify(text.slice(from, index + context));
  return { index, expected: excerpt(expected), actual: excerpt(actual) };
}
