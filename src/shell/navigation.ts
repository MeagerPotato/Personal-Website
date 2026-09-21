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

/**
 * Should the router handle this click instead of the browser? Returns the destination if so.
 *
 * The answer is "no" whenever the browser would do something the router cannot: open a new tab
 * (modifier keys, middle click, target), download, leave the site, fetch a file, or jump to an
 * anchor on the page that is already showing.
 */
export function interceptableUrl(
  event: ClickLike,
  anchor: AnchorLike,
  current: { origin: string; pathname: string; search: string },
): URL | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;

  if (!anchor.hasAttribute('href') || anchor.hasAttribute('download')) return null;
  if (anchor.target !== '' && anchor.target !== '_self') return null;
  if (anchor.closest('[data-router-ignore]')) return null;
  if ((anchor.getAttribute('rel') ?? '').split(/\s+/).includes('external')) return null;

  if (!URL.canParse(anchor.href)) return null;
  const url = new URL(anchor.href);
  if (url.origin !== current.origin) return null;
  if (FILE_PATH.test(url.pathname)) return null;

  const samePage = url.pathname === current.pathname && url.search === current.search;
  if (samePage && url.hash !== '') return null;

  return url;
}

/** A response the router may swap in: 2xx, HTML, and still on this site after any redirect. */
export function isSwappableResponse(
  response: { ok: boolean; url: string; headers: { get(name: string): string | null } },
  origin: string,
): boolean {
  if (!response.ok) return false;
  if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) {
    return false;
  }
  // `url` is empty for a synthetic Response, which cannot have been redirected anywhere.
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
