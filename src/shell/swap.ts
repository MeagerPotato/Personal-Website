// Turning the page that is showing into the page that was fetched, by replacing exactly the parts
// the swap contract allows (docs/PLAN.md §5.1): the children of <main>, the <head> nodes marked
// data-page-head, and the main nav's aria-current. Everything else, the canvas above all, is never
// touched. scripts/verify-dist.mjs guarantees at build time that nothing else differs.

import { navCurrent, type NavItem } from '../site/nav';

const PAGE_HEAD = 'data-page-head';

const isElement = (node: Node): node is Element => node.nodeType === 1;
const isPerPage = (node: Node): boolean => isElement(node) && node.hasAttribute(PAGE_HEAD);

/** Head elements that are not per-page, in order: ours, plus anything a browser extension added. */
const candidates = (doc: Document): Element[] =>
  [...doc.head.childNodes].filter(isElement).filter((node) => !isPerPage(node));

/**
 * The elements of the CURRENT head that are the fetched page's shared elements, matched in order
 * by their markup (the build guarantees shared nodes are byte-identical on every page). Null when
 * one is missing: a real difference.
 *
 * Whatever else sits in the current head is FOREIGN: a dark-mode extension's <style>, a password
 * manager's <meta>. A fresh load would carry it too, so it is never counted, moved or removed.
 * Without this, one extension would turn every soft navigation into a full page load.
 */
function matchShared(current: Document, next: Document): Element[] | null {
  const pool = candidates(current);
  const matched: Element[] = [];
  let from = 0;
  for (const wanted of candidates(next)) {
    const markup = wanted.outerHTML;
    let index = from;
    while (index < pool.length && pool[index]?.outerHTML !== markup) index += 1;
    const found = pool[index];
    if (!found) return null;
    matched.push(found);
    from = index + 1;
  }
  return matched;
}

/**
 * A <head> cut at its shared elements: runs[i] is everything that sits before shared[i] (the
 * per-page elements, and the whitespace between them), and the last run is whatever follows the
 * last shared element. Foreign elements belong to no run, so they stay where they are.
 */
function headRuns(doc: Document, shared: readonly Element[]): ChildNode[][] {
  const cuts = new Set<Node>(shared);
  const runs: ChildNode[][] = [[]];
  for (const node of [...doc.head.childNodes]) {
    if (cuts.has(node)) runs.push([]);
    else if (!isElement(node) || isPerPage(node)) runs[runs.length - 1]?.push(node);
  }
  return runs;
}

const buildOf = (doc: Document): string | null =>
  doc.querySelector('meta[name="build"]')?.getAttribute('content') ?? null;

/**
 * Why `next` cannot be swapped into `current`, or null if it can. Any reason means "do a normal
 * page load instead", which is always correct, only slower.
 */
export function swapBlocker(current: Document, next: Document): string | null {
  if (!next.querySelector('main') || !current.querySelector('main')) return 'no <main>';
  if (next.documentElement.hasAttribute('data-plain-only')) return 'plain-only page';
  // A deploy happened while this tab was open: the new HTML may expect new CSS and scripts.
  if (buildOf(current) !== buildOf(next)) return 'different build';
  if (!matchShared(current, next)) return 'different <head>';
  return null;
}

/**
 * Replace the per-page <head> nodes so that the result is node for node what a fresh load would
 * have built, whitespace included. Shared elements (the stylesheet above all) are never moved or
 * re-created: re-inserting a stylesheet would reload it. Only the runs BETWEEN them are replaced.
 */
export function swapHead(current: Document, next: Document): void {
  const shared = matchShared(current, next);
  if (!shared) return; // swapBlocker() said so already; never half-swap a head we do not know
  const here = headRuns(current, shared);
  const there = headRuns(next, candidates(next));
  there.forEach((run, index) => {
    for (const stale of here[index] ?? []) stale.remove();
    const fresh = run.map((node) => current.importNode(node, true));
    const before = shared[index];
    if (before) before.before(...fresh);
    else current.head.append(...fresh);
  });
}

/** Replace the children of <main>. The element itself, and so its attributes, stays. */
export function swapMain(current: Document, next: Document): void {
  const target = current.querySelector('main');
  const source = next.querySelector('main');
  if (!target || !source) return;
  target.replaceChildren(...[...source.childNodes].map((node) => current.importNode(node, true)));
}

/** Re-derive "you are here" with the same function the layout used at build time. */
export function markCurrentNav(doc: Document, items: readonly NavItem[], pathname: string): void {
  for (const link of doc.querySelectorAll<HTMLAnchorElement>('.site-nav a')) {
    const item = items.find((entry) => entry.href === link.getAttribute('href'));
    const value = item ? navCurrent(item, pathname) : undefined;
    if (value) link.setAttribute('aria-current', value);
    else link.removeAttribute('aria-current');
  }
}

/**
 * Move focus to the new page's heading, so keyboard and screen-reader users land on the content
 * that changed. Never called on the initial load: a fresh page must not steal focus.
 */
export function focusHeading(doc: Document): void {
  // The markup already carries tabindex="-1" (components/PageHeader.astro), so focusing changes
  // no attribute and the DOM stays identical to a fresh load of the same page.
  //
  // Not while the panel is closed (src/shell/panel.ts): its text is sliding out of sight, and
  // focus inside it would be stranded in an invisible place a moment later. The panel hands
  // focus to its own button instead.
  if (doc.documentElement.dataset.panel === 'closed') return;
  doc.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
}
