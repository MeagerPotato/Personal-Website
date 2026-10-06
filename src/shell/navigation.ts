// The router's decisions, as pure functions: which clicks it may take over, which responses it may
// trust, and what it remembers. No DOM writes and no history here, so every rule is unit-tested.
// The part that acts on these decisions is router.ts. Spec: docs/PLAN.md §5.3.

/** The parts of a click the rules look at (a MouseEvent satisfies this). */
export interface ClickLike {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

/** The parts of a link the rules look at (an HTMLAnchorElement satisfies this). */
export interface AnchorLike {
  href: string;
  target: string;
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
  closest(selector: string): unknown;
}

/** Pages end with "/". Anything with a file extension (a PDF, an image, /universe.json) is a file. */
const FILE_PATH = /\.[a-z0-9]{1,8}$/i;

/** Where the browser is, as far as the rules look (a Location satisfies this). */
export interface Here {
  origin: string;
  pathname: string;
  search: string;
}

/**
 * Where a click on this link leads, if it is the router's to take at all: a plain left click on
 * a link to a page of this site. Null whenever the browser would do something the router
 * cannot: open a new tab (modifier keys, middle click, target), download, leave the site, or
 * fetch a file.
 */
function ownUrl(event: ClickLike, anchor: AnchorLike, origin: string): URL | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;

  if (!anchor.hasAttribute('href') || anchor.hasAttribute('download')) return null;
  if (anchor.target !== '' && anchor.target !== '_self') return null;
  if (anchor.closest('[data-router-ignore]')) return null;
  if ((anchor.getAttribute('rel') ?? '').split(/\s+/).includes('external')) return null;

  if (!URL.canParse(anchor.href)) return null;
  const url = new URL(anchor.href);
  if (url.origin !== origin) return null;
  if (FILE_PATH.test(url.pathname)) return null;
  return url;
}

/** A link to a part of the page that is showing: the same page, and a fragment. */
const isSamePageFragment = (url: URL, here: Here): boolean =>
  url.pathname === here.pathname && url.search === here.search && url.hash !== '';

/**
 * Should the router take this click to ANOTHER page (or to this one afresh) instead of the
 * browser? Returns the destination if so.
 *
 * A link to a part of the page that is already showing is not a navigation: samePageAnchor().
 */
export function interceptableUrl(event: ClickLike, anchor: AnchorLike, current: Here): URL | null {
  const url = ownUrl(event, anchor, current.origin);
  return url && !isSamePageFragment(url, current) ? url : null;
}

/**
 * The id a click asks for, when it is a plain click on a link to a part of the page that is
 * showing (`#rockets` on the About page). The page stays: only its fragment changes, and the
 * fragment is a reading position, which the router replaces instead of pushing (router.ts,
 * `anchor`). Null for every other click.
 */
export function samePageAnchor(event: ClickLike, anchor: AnchorLike, here: Here): string | null {
  const url = ownUrl(event, anchor, here.origin);
  return url && isSamePageFragment(url, here) ? fragmentId(url.hash) : null;
}

/** The id a URL's fragment names ("#rockets" is "rockets"), or null when it has none. */
export function fragmentId(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw === '') return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    // Not a valid escape sequence ("%zz"): an id may be spelt that way too.
    return raw;
  }
}

/**
 * The place in the page's content that an id names, if it names one: an element INSIDE <main>.
 * Only the content is read, so only a place in it is a reading position. Whatever else a
 * fragment can name is not one, and stays the browser's business: <main> itself ("Skip to
 * content" jumps there, and the browser moves the focus with it), or nothing at all.
 */
export function readingTarget(
  doc: Pick<Document, 'getElementById'>,
  id: string | null,
): HTMLElement | null {
  if (id === null) return null;
  const main = doc.getElementById('main');
  const target = doc.getElementById(id);
  return main && target && target !== main && main.contains(target) ? target : null;
}

/**
 * A response the router may swap in: 2xx, HTML, and not redirected. A page load follows a
 * redirect and shows its target under the target's own URL; a swap would show it under the URL
 * that was asked for, so a redirect of any kind (to another site, or to another page of this
 * one, as `_redirects` does) is left to a page load.
 */
export function isSwappableResponse(
  response: {
    ok: boolean;
    redirected: boolean;
    url: string;
    headers: { get(name: string): string | null };
  },
  origin: string,
): boolean {
  if (!response.ok || response.redirected) return false;
  if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) {
    return false;
  }
  // `url` is empty for a synthetic Response, which cannot have come from anywhere else.
  return response.url === '' || new URL(response.url).origin === origin;
}

/** The identity of a page for "is this already showing?": path and query, never the hash. */
export const pageKey = (url: { pathname: string; search: string }): string =>
  url.pathname + url.search;

/**
 * A tiny least-recently-used cache with a time limit, for prefetched pages. Values are whatever
 * the caller stores (the router stores promises, so a click during a prefetch joins it).
 */
export class ExpiringCache<Value> {
  private readonly entries = new Map<string, { value: Value; expires: number }>();

  constructor(
    private readonly capacity: number,
    private readonly ttlMs: number,
    private readonly now: () => number,
  ) {}

  get(key: string): Value | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expires <= this.now()) return undefined;
    this.entries.set(key, entry); // Re-inserting moves it to the "recent" end.
    return entry.value;
  }

  set(key: string, value: Value): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expires: this.now() + this.ttlMs });
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }
}

/** Prefetching spends the visitor's data on a guess: not on Save-Data, not on a 2G connection. */
export function mayPrefetch(connection?: { saveData?: boolean; effectiveType?: string }): boolean {
  if (!connection) return true;
  if (connection.saveData) return false;
  return !/(^|-)2g$/.test(connection.effectiveType ?? '');
}
