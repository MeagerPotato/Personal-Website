// The micro-router (docs/PLAN.md §5.3). In universe mode a link must not reload the page, because
// a reload throws away the WebGL canvas and everything the engine has built. So the router fetches
// the next page, swaps in the parts that differ (swap.ts), and records the visit in history.
//
// THE INVARIANT: a soft navigation is only an optimisation of a hard one. Both must end in the same
// DOM, and whenever anything at all looks wrong (a failed fetch, a non-HTML answer, a new deploy,
// a page the contract does not cover) the router lets the browser load the page normally.
//
// This is the ONLY file allowed to write history (eslint.config.js). The engine never touches it:
// the ship and the route follow each other through follow.ts, which asks this file.
//
// THE FRAGMENT is a reading position, not a page: which part of the page that is showing the
// visitor is at (`/about/#rockets`). So it never gets a history entry of its own. A link to a
// part of this page, and anyone who calls anchor(), REPLACES the fragment in the entry that is
// showing, and Back and Close go on meaning "leave this page".
//
// Plain mode never loads this module: there, links are just links.

import type { NavItem } from '../site/nav';
import {
  ExpiringCache,
  fragmentId,
  interceptableUrl,
  isSwappableResponse,
  mayPrefetch,
  pageKey,
  readingTarget,
  samePageAnchor,
  type ClickLike,
} from './navigation';
import { focusHeading, markCurrentNav, swapBlocker, swapHead, swapMain } from './swap';

export type NavigationKind = 'push' | 'replace' | 'pop';

export interface RouterOptions {
  navItems: readonly NavItem[];
  /**
   * On every committed navigation, once the new page is in the DOM and before focus moves to
   * its heading. The panel opens or closes here, and the ship sets out for what the URL names.
   */
  onNavigate?: (navigation: { url: URL; kind: NavigationKind }) => void;
  /**
   * The page that is showing stays, and its fragment is now another: a link to a part of this
   * page was pressed, Back or Forward moved between two of its fragments, or a fragment was
   * typed into the address bar. `id` is what the fragment names now, null for none. Not told
   * after anchor() (its caller knows), nor when a navigation arrives at a fragment (onNavigate
   * says that).
   */
  onAnchor?: (id: string | null) => void;
  /** Injected in tests: the network, and the two ways of giving up on a soft navigation. */
  fetch?: typeof fetch;
  hardLoad?: (href: string) => void;
  reload?: () => void;
}

export interface Router {
  /**
   * A navigation has begun and its page is not on screen yet: the network is being waited for.
   * After Back or Forward the URL is ALREADY the new one while this is true, so for that long the
   * address bar and the page disagree, and nobody should act on either alone (shell/follow.ts).
   */
  readonly busy: boolean;
  /** Go to a same-site page without reloading. Resolves once the page shows (or a reload began). */
  navigate(href: string, options?: { replace?: boolean }): Promise<void>;
  /** Fetch a page the visitor is likely to open next. */
  prefetch(href: string): void;
  /**
   * Leave the page that is showing for `homeHref` (the open sky), the way closing a card does.
   * If the visitor came here FROM that page, by a push of ours, this is Back, so that opening and
   * closing a page leaves no trail. From anywhere else it is a new step: Back must never be a
   * surprise, and neither must Close (it closes; it does not open the page before this one).
   */
  leave(homeHref: string): void;
  /**
   * Make `id` the fragment of the page that is showing (null: none). It is replaced in the
   * entry that is showing, which keeps its state: no entry is added, so Back and Close still
   * leave the page. Nobody is told: the caller knows.
   */
  anchor(id: string | null): void;
  /**
   * Forget a navigation that is still waiting for the network: its page will not be shown. (The
   * ship docked and asked for a page, then left again before the page arrived.)
   */
  cancel(): void;
  dispose(): void;
}

interface EntryState {
  /** Identifies a history entry, so its scroll position can be restored when it is revisited. */
  routerKey: string;
  /**
   * How many of our own pushes lie behind this entry. Above zero, the entry before it is a page
   * of this site that the router itself left, so history.back() is a safe way to "close".
   */
  routerDepth: number;
  /** Path of the page this entry was pushed from: what history.back() would show. */
  routerFrom?: string;
}

const PREFETCH_CAPACITY = 6;
const PREFETCH_TTL_MS = 30_000;
/** A pointer merely crossing a link is not intent; resting on it for this long is. */
const HOVER_INTENT_MS = 80;
const SCROLL_STORE = 'router:scroll';
const PLAIN_CLICK: ClickLike = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
};

export function startRouter(options: RouterOptions): Router {
  const fetchPage = options.fetch ?? fetch.bind(globalThis);
  const hardLoad = options.hardLoad ?? ((href: string) => location.assign(href));
  const reload = options.reload ?? (() => location.reload());

  const pages = new ExpiringCache<Promise<string>>(PREFETCH_CAPACITY, PREFETCH_TTL_MS, () =>
    performance.now(),
  );
  const scrollByEntry = new Map<string, number>(readScrollStore());
  const listeners = new AbortController();

  let navigationId = 0;
  let inFlight: AbortController | undefined;
  /** True from begin() until that navigation has shown its page, given up, or been cancelled. */
  let waiting = false;
  let showing = pageKey(location);
  /**
   * The fragment that onAnchor's listener last heard of, or that anchor() wrote: one change is
   * told once. (Back between two fragments of a page is a popstate AND a hashchange, and so is
   * a fragment typed into the address bar, in every browser that follows the standard.)
   */
  let toldHash = location.hash;
  let keyCounter = 0;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;

  const currentDepth = (): number => (history.state as EntryState | null)?.routerDepth ?? 0;
  const cameFrom = (): string | undefined => (history.state as EntryState | null)?.routerFrom;
  const newState = (depth: number, from: string | undefined): EntryState => ({
    routerKey: `${Date.now().toString(36)}-${(keyCounter += 1)}`,
    routerDepth: depth,
    ...(from === undefined ? {} : { routerFrom: from }),
  });
  /** The key of the history entry the browser is on, tagging the entry first if it has none. */
  function entryKey(): string {
    const existing = (history.state as EntryState | null)?.routerKey;
    if (existing) return existing;
    const state = newState(0, undefined);
    history.replaceState(state, '');
    return state.routerKey;
  }

  // In universe mode the panel (<main>) scrolls and the document does not; if the layout ever
  // falls back, it is the other way round. Reading and writing both keeps the router right
  // whichever one is the scroller: the other is always at 0 and cannot move.
  const panel = (): HTMLElement | null => document.getElementById('main');
  const scrollTop = (): number => window.scrollY + (panel()?.scrollTop ?? 0);
  function scrollTo(top: number): void {
    // "instant" on purpose: the stylesheet asks for smooth scrolling, and gliding through a page
    // that has just been replaced would be motion without meaning.
    panel()?.scrollTo({ top, left: 0, behavior: 'instant' });
    window.scrollTo({ top, left: 0, behavior: 'instant' });
  }

  // The entry whose content is on screen. On popstate the browser has ALREADY moved to another
  // entry, so this is the only way to know whose scroll position is being left behind.
  let currentKey = entryKey();
  // The browser would restore a scroll position before the old content is back.
  history.scrollRestoration = 'manual';

  function load(url: URL, signal?: AbortSignal): Promise<string> {
    const key = pageKey(url);
    const cached = pages.get(key);
    if (cached) return cached;

    const request = fetchPage(url.href, {
      headers: { Accept: 'text/html' },
      credentials: 'same-origin',
      ...(signal ? { signal } : {}),
    }).then((response) => {
      if (!isSwappableResponse(response, location.origin)) {
        throw new Error(`not a swappable page (HTTP ${response.status})`);
      }
      return response.text();
    });
    pages.set(key, request);
    // A failed or aborted request must not poison the cache for the next attempt.
    request.catch(() => pages.delete(key));
    return request;
  }

  /** Parse a fetched page. Null means: not swappable, load it the normal way. */
  function parse(html: string, url: URL): Document | null {
    const next = new DOMParser().parseFromString(html, 'text/html');
    const blocker = swapBlocker(document, next);
    if (!blocker) return next;
    console.info(`[router] full page load for ${url.pathname}: ${blocker}`);
    return null;
  }

  /** Commit order, part two (§5.3): swap -> scroll -> focus. History was written just before. */
  function show(next: Document, url: URL, kind: NavigationKind, scrollY?: number): void {
    swapHead(document, next);
    swapMain(document, next);
    markCurrentNav(document, options.navItems, url.pathname);
    showing = pageKey(url);
    // Arriving at a fragment is part of the navigation, which onNavigate tells.
    toldHash = url.hash;

    const id = fragmentId(url.hash);
    const target = id === null ? null : document.getElementById(id);
    if (scrollY !== undefined) scrollTo(scrollY);
    else if (target) target.scrollIntoView({ behavior: 'instant' });
    else scrollTo(0);

    // Listeners first: the panel may have to OPEN for this page, and a heading inside a hidden
    // panel cannot take focus.
    options.onNavigate?.({ url, kind });
    focusHeading(document);
  }

  /** Start a navigation: it supersedes whichever one was still waiting for the network. */
  function begin(): { id: number; signal: AbortSignal } {
    inFlight?.abort();
    inFlight = new AbortController();
    waiting = true;
    scrollByEntry.set(currentKey, scrollTop());
    return { id: (navigationId += 1), signal: inFlight.signal };
  }

  function cancel(): void {
    // Whatever was waiting for the network is now an OLDER navigation: its answer is dropped.
    inFlight?.abort();
    inFlight = undefined;
    navigationId += 1;
    waiting = false;
  }

  async function navigate(href: string, { replace = false } = {}): Promise<void> {
    const url = new URL(href, location.href);
    // Another site is never fetched (the CSP forbids it anyway) and never swapped in: it is
    // simply where the browser goes.
    if (url.origin !== location.origin) {
      cancel();
      return hardLoad(url.href);
    }
    const { id, signal } = begin();

    let next: Document | null;
    try {
      next = parse(await load(url, signal), url);
    } catch {
      // If a newer navigation superseded this one, that one owns the outcome.
      if (id === navigationId) {
        waiting = false;
        hardLoad(url.href);
      }
      return;
    }
    // Latest navigation wins: a slow answer to an older click is dropped.
    if (id !== navigationId) return;
    waiting = false;
    if (!next) return hardLoad(url.href);

    // Like the browser, a link to the URL that is already showing replaces its entry: clicking
    // "About" on the About page must not make Back a no-op.
    const kind: NavigationKind = replace || url.href === location.href ? 'replace' : 'push';
    // A replaced entry still has the same entry behind it; a pushed one has this page behind it.
    const state = newState(
      currentDepth() + (kind === 'push' ? 1 : 0),
      kind === 'push' ? location.pathname : cameFrom(),
    );
    if (kind === 'replace') history.replaceState(state, '', url.href);
    else history.pushState(state, '', url.href);
    currentKey = state.routerKey;
    show(next, url, kind);
  }

  async function onPopState(): Promise<void> {
    const url = new URL(location.href);
    const { id, signal } = begin();
    currentKey = entryKey();
    // Back or Forward between two fragments of the page that is showing (or a fragment the
    // browser changed by itself, which is a popstate too): the page stays, the reader moves.
    if (pageKey(url) === showing) {
      waiting = false;
      tellAnchor();
      return;
    }

    try {
      const next = parse(await load(url, signal), url);
      if (id !== navigationId) return;
      waiting = false;
      if (!next) return reload();
      show(next, url, 'pop', scrollByEntry.get(currentKey) ?? 0);
    } catch {
      // The URL has already changed, so a reload shows the right page.
      if (id === navigationId) {
        waiting = false;
        reload();
      }
    }
  }

  function prefetch(href: string): void {
    const { connection } = navigator as Navigator & {
      connection?: Parameters<typeof mayPrefetch>[0];
    };
    if (!mayPrefetch(connection)) return;
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return;
    if (pageKey(url) !== showing) void load(url).catch(() => undefined);
  }

  /** Tell the listener what the fragment names now, unless it has heard already (toldHash). */
  function tellAnchor(): void {
    if (location.hash === toldHash) return;
    toldHash = location.hash;
    options.onAnchor?.(fragmentId(location.hash));
  }

  function anchor(id: string | null): void {
    const url = new URL(location.href);
    url.hash = id ?? '';
    // The entry's own state goes back in: it keeps its key (its scroll position) and its depth
    // (which is how leave() knows whether Back is the open sky).
    if (url.href !== location.href) history.replaceState(history.state, '', url.href);
    toldHash = location.hash;
  }

  /** The link a click, a pointer or the focus is on, if it is on one. */
  function linkOf(event: Event): HTMLAnchorElement | null {
    const target = event.target;
    return target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null;
  }

  /** Where a plain left click on the link under `event` would take the router, if anywhere. */
  function destination(event: Event, click: ClickLike): URL | null {
    const link = linkOf(event);
    return link ? interceptableUrl(click, link, location) : null;
  }

  /** A plain click on a link to `id`, a part of the page the address bar names. */
  function followAnchor(event: Event, id: string): void {
    // Not a place in the content ("Skip to content", an id that names nothing): the browser's.
    if (!readingTarget(document, id)) return;
    event.preventDefault();
    // After Back or Forward the address bar is ahead of the page (`busy`). The link is in the
    // page on its way out, and its fragment must not land in the entry of the page on its way in.
    if (pageKey(location) !== showing) return;
    anchor(id);
    // Told even when the fragment was this one already: the reader may have scrolled away.
    options.onAnchor?.(id);
  }

  const { signal } = listeners;

  document.addEventListener(
    'click',
    (event) => {
      const link = linkOf(event);
      if (!link) return;
      const id = samePageAnchor(event, link, location);
      if (id !== null) return followAnchor(event, id);
      const url = interceptableUrl(event, link, location);
      if (!url) return;
      event.preventDefault();
      void navigate(url.href);
    },
    { signal },
  );

  // Prefetch on intent: a resting mouse pointer, a finger going down, or keyboard focus.
  document.addEventListener(
    'pointerover',
    (event) => {
      clearTimeout(hoverTimer);
      const url = destination(event, PLAIN_CLICK);
      if (!url) return;
      if (event.pointerType === 'mouse') {
        hoverTimer = setTimeout(() => prefetch(url.href), HOVER_INTENT_MS);
      } else {
        prefetch(url.href);
      }
    },
    { signal, passive: true },
  );
  document.addEventListener(
    'focusin',
    (event) => {
      const url = destination(event, PLAIN_CLICK);
      if (url) prefetch(url.href);
    },
    { signal },
  );

  window.addEventListener('popstate', () => void onPopState(), { signal });
  // A fragment the browser changed by itself, in a browser that makes no popstate of it. Not
  // while the address bar is ahead of the page: that fragment belongs to the page on its way in.
  window.addEventListener(
    'hashchange',
    () => {
      if (pageKey(location) === showing) tellAnchor();
    },
    { signal },
  );

  // Scroll positions survive a reload, and a trip to another site and back, in sessionStorage.
  window.addEventListener(
    'pagehide',
    () => {
      scrollByEntry.set(currentKey, scrollTop());
      writeScrollStore(scrollByEntry);
    },
    { signal },
  );

  // A page restored from the back/forward cache does not re-run the mode script, so a visitor who
  // chose plain mode on a later page would come back to a universe page. Re-check, and reload.
  window.addEventListener(
    'pageshow',
    (event) => {
      if (!event.persisted) return;
      if (readSessionMode() === 'plain') reload();
      else showing = pageKey(location);
    },
    { signal },
  );

  return {
    get busy() {
      return waiting;
    },
    navigate,
    prefetch,
    leave(homeHref) {
      const home = new URL(homeHref, location.href);
      if (currentDepth() > 0 && cameFrom() === home.pathname) history.back();
      else void navigate(homeHref);
    },
    anchor,
    cancel,
    dispose() {
      listeners.abort();
      inFlight?.abort();
      clearTimeout(hoverTimer);
      history.scrollRestoration = 'auto';
    },
  };
}

function readSessionMode(): string | null {
  try {
    return sessionStorage.getItem('mode');
  } catch {
    return null;
  }
}

function readScrollStore(): Array<[string, number]> {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(SCROLL_STORE) ?? '[]');
    if (!Array.isArray(stored)) return [];
    return stored.filter(
      (pair): pair is [string, number] =>
        Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'number',
    );
  } catch {
    return [];
  }
}

function writeScrollStore(positions: Map<string, number>): void {
  try {
    // The newest fifty entries are plenty, and keep the store from growing for ever.
    sessionStorage.setItem(SCROLL_STORE, JSON.stringify([...positions].slice(-50)));
  } catch {
    /* storage blocked: scroll positions simply do not survive a reload */
  }
}
