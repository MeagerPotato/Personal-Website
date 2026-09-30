// public/_redirects: old URLs that must keep working. Cloudflare's static assets answer them with
// a real redirect before any page is looked up (the file itself is never served). Pure, like
// ./html.mjs, so tests/build-scripts.test.ts holds it; verify-dist checks the built copy (3b).
//
// Kept deliberately small: one exact path to one page, 301, one per line. Cloudflare also knows
// splats, placeholders, other status codes and other sites, and every one of them is a way for an
// old URL to land somewhere unexpected, so none is allowed here.

/** Where the build serves the file from: dist/_redirects (Astro copies public/ as it is). */
export const REDIRECTS = '/_redirects';

/**
 * The rules of a _redirects file, and the lines that are not one: `source destination [status]`
 * per line, `#` comments and blank lines skipped. Cloudflare ignores a line it cannot read, so
 * that line is reported here instead of quietly doing nothing. `status` is null when left out
 * (Cloudflare would then answer 302).
 */
export function parseRedirects(text) {
  const rules = [];
  const unreadable = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const parts = line.split(/\s+/);
    if (parts.length < 2 || parts.length > 3) {
      unreadable.push({ line: index + 1, text: line });
      return;
    }
    const [from, to, status] = parts;
    rules.push({
      line: index + 1,
      from,
      to,
      status: status === undefined ? null : Number(status),
    });
  });
  return { rules, unreadable };
}

/**
 * The problems with a built site's _redirects, as sentences a person can act on (none = fine).
 * `isPage(path)` says whether dist/ has a page at a site path (path/index.html); `links` is every
 * internal link the pages make, `{ page, target }`, target as a site path.
 */
export function redirectProblems(text, { isPage, links }) {
  const where = (rule) => `${REDIRECTS} line ${rule.line}`;
  const { rules, unreadable } = parseRedirects(text);
  const problems = unreadable.map(
    ({ line, text: content }) =>
      `${REDIRECTS} line ${line} is not "source destination 301": "${content}" (Cloudflare would ignore it)`,
  );
  const sources = new Map();
  for (const rule of rules) {
    if (!rule.from.startsWith('/') || /[*:]/.test(rule.from)) {
      problems.push(
        `${where(rule)}: the source "${rule.from}" must be one exact path of this site (no splats, no placeholders)`,
      );
    }
    if (sources.has(rule.from)) {
      problems.push(
        `${where(rule)}: "${rule.from}" is redirected twice (also line ${sources.get(rule.from)})`,
      );
    }
    sources.set(rule.from, rule.line);
    if (rule.status !== 301) {
      problems.push(
        `${where(rule)}: "${rule.from}" must say 301 (moved for good), not ${rule.status ?? 'nothing (302)'}`,
      );
    }
    if (isPage(rule.from)) {
      problems.push(
        `${where(rule)}: "${rule.from}" is a page of this build, so a redirect would hide it: remove one of the two`,
      );
    }
    if (
      !rule.to.startsWith('/') ||
      rule.to.startsWith('//') ||
      !rule.to.endsWith('/') ||
      !isPage(rule.to)
    ) {
      problems.push(
        `${where(rule)}: "${rule.from}" goes to "${rule.to}", which must be a page of this build, ending with "/"`,
      );
    }
  }
  for (const { page, target } of links) {
    const line = sources.get(target);
    if (line === undefined) continue;
    problems.push(
      `${page}: links to "${target}", which only redirects (${REDIRECTS} line ${line}): link its destination instead`,
    );
  }
  return problems;
}
