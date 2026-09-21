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
