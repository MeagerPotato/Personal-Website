// Turning the page that is showing into the page that was fetched, by replacing exactly the parts
// the swap contract allows (docs/PLAN.md §5.1): the children of <main>, the <head> nodes marked
// data-page-head, and the main nav's aria-current. Everything else, the canvas above all, is never
// touched. scripts/verify-dist.mjs guarantees at build time that nothing else differs.

import { navCurrent, type NavItem } from '../site/nav';

const PAGE_HEAD = 'data-page-head';

const isShared = (node: Node): node is Element =>
  node.nodeType === 1 && !(node as Element).hasAttribute(PAGE_HEAD);

const staticHeadNodes = (doc: Document): Element[] => [...doc.head.childNodes].filter(isShared);

/**
 * The <head> cut at its shared elements: runs[i] is everything that sits before shared[i] (the
 * per-page elements, and the whitespace between them), and the last run is whatever follows the
 * last shared element.
 */
function headRuns(doc: Document): { shared: Element[]; runs: ChildNode[][] } {
  const shared: Element[] = [];
  const runs: ChildNode[][] = [[]];
  for (const node of [...doc.head.childNodes]) {
    if (isShared(node)) {
      shared.push(node);
      runs.push([]);
    } else {
      runs[runs.length - 1]?.push(node);
    }
  }
  return { shared, runs };
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
  if (staticHeadNodes(current).length !== staticHeadNodes(next).length) return 'different <head>';
  return null;
}

/**
 * Replace the per-page <head> nodes so that the result is node for node what a fresh load would
 * have built, whitespace included. Shared elements (the stylesheet above all) are never moved or
 * re-created: re-inserting a stylesheet would reload it. Only the runs BETWEEN them are replaced.
 */
export function swapHead(current: Document, next: Document): void {
  const here = headRuns(current);
  const there = headRuns(next);
  there.runs.forEach((run, index) => {
    for (const stale of here.runs[index] ?? []) stale.remove();
    const fresh = run.map((node) => current.importNode(node, true));
    const before = here.shared[index];
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
  doc.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
}
