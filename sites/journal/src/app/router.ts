/**
 * A small router over the History API: the app has a dozen screens and needs nothing more than
 * "which path is showing" and "go to that one". Real URLs, so Back works and a screen can be
 * bookmarked; the Worker serves index.html for all of them (wrangler.jsonc, SPA fallback). A new
 * screen's title takes the focus (@allenkh/design/focus).
 */
import { focusNextTitle } from '@allenkh/design/focus';
import { useSyncExternalStore, type MouseEvent } from 'react';

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

addEventListener('popstate', () => {
  focusNextTitle();
  notify();
});

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const currentPath = (): string => location.pathname;

/**
 * Which screen instance is showing: normally the path, so every page starts fresh; but a draft
 * that has just been saved (a new event getting its id) keeps its screen, and with it the
 * focus and whatever is half-typed.
 */
const currentScreen = (): string => {
  const state: unknown = history.state;
  const kept =
    typeof state === 'object' && state !== null ? (state as { screen?: unknown }).screen : null;
  return typeof kept === 'string' ? kept : location.pathname;
};

/** The path showing now; re-renders when it changes. */
export function usePath(): string {
  return useSyncExternalStore(subscribe, currentPath);
}

export function useScreenKey(): string {
  return useSyncExternalStore(subscribe, currentScreen);
}

export function navigate(
  path: string,
  options: { replace?: boolean; keepScreen?: boolean } = {},
): void {
  if (path === location.pathname + location.search) return;
  const state = options.keepScreen ? { screen: currentScreen() } : null;
  if (options.replace) history.replaceState(state, '', path);
  else history.pushState(state, '', path);
  if (!options.keepScreen) {
    scrollTo({ top: 0 });
    focusNextTitle();
  }
  notify();
}

/** For <a href> links: a plain click navigates in place; modified clicks behave as usual. */
export function follow(event: MouseEvent<HTMLAnchorElement>): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  const href = event.currentTarget.getAttribute('href');
  if (!href?.startsWith('/')) return;
  event.preventDefault();
  navigate(href);
}

export type Route =
  | { name: 'today' }
  | { name: 'day'; date: string }
  | { name: 'calendar'; month: string | null }
  | { name: 'month'; month: string }
  | { name: 'timeline' }
  | { name: 'event'; id: string | null }
  | { name: 'stats' }
  | { name: 'people' }
  | { name: 'person'; id: string | null }
  | { name: 'places' }
  | { name: 'place'; id: string | null }
  | { name: 'search' }
  | { name: 'settings'; section: string | null }
  | { name: 'missing' };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

/** Path → screen. Unknown paths are 'missing' (a friendly page, not a crash). */
export function parseRoute(path: string): Route {
  const [first = '', second, ...rest] = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (rest.length > 0) return { name: 'missing' };
  switch (first) {
    case '':
      return { name: 'today' };
    case 'day':
      return second && DATE.test(second) ? { name: 'day', date: second } : { name: 'missing' };
    case 'calendar':
      if (second === undefined) return { name: 'calendar', month: null };
      return MONTH.test(second) ? { name: 'calendar', month: second } : { name: 'missing' };
    case 'month':
      return second && MONTH.test(second) ? { name: 'month', month: second } : { name: 'missing' };
    case 'timeline':
      return second === undefined ? { name: 'timeline' } : { name: 'missing' };
    case 'event':
      return { name: 'event', id: second === 'new' || !second ? null : second };
    case 'stats':
      return { name: 'stats' };
    case 'people':
      return { name: 'people' };
    case 'person':
      return { name: 'person', id: second === 'new' || !second ? null : second };
    case 'places':
      return { name: 'places' };
    case 'place':
      return { name: 'place', id: second === 'new' || !second ? null : second };
    case 'search':
      return { name: 'search' };
    case 'settings':
      return { name: 'settings', section: second ?? null };
    default:
      return { name: 'missing' };
  }
}

export const paths = {
  today: () => '/',
  day: (date: string) => `/day/${date}`,
  calendar: (month?: string) => (month ? `/calendar/${month}` : '/calendar'),
  month: (month: string) => `/month/${month}`,
  timeline: () => '/timeline',
  event: (id: string | null) => `/event/${id ?? 'new'}`,
  stats: () => '/stats',
  people: () => '/people',
  person: (id: string | null) => `/person/${id ?? 'new'}`,
  places: () => '/places',
  place: (id: string | null) => `/place/${id ?? 'new'}`,
  search: () => '/search',
  settings: (section?: string) => (section ? `/settings/${section}` : '/settings'),
};
