/**
 * The studio's addresses, all under /studio/ (one Astro page serves them; this reads the rest).
 * History belongs to the studio alone: the reader's pages have no script at all. A new screen's
 * title takes the focus (@allenkh/design/focus).
 */
import { focusNextTitle } from '@allenkh/design/focus';
import { useEffect, useSyncExternalStore, type MouseEvent } from 'react';

export type Route =
  | { name: 'posts' }
  | { name: 'post'; id: string }
  | { name: 'comments' }
  | { name: 'subscribers' }
  | { name: 'organize' }
  | { name: 'settings' }
  | { name: 'missing' };

export function parseRoute(pathname: string): Route {
  const parts = pathname
    .replace(/^\/studio\/?/, '')
    .split('/')
    .filter(Boolean);
  const [first, second] = parts;
  if (!first) return { name: 'posts' };
  if (first === 'posts' && second && /^p_[A-Za-z0-9_-]{8,40}$/.test(second))
    return { name: 'post', id: second };
  if (
    parts.length === 1 &&
    (first === 'comments' ||
      first === 'subscribers' ||
      first === 'organize' ||
      first === 'settings')
  ) {
    return { name: first };
  }
  return { name: 'missing' };
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case 'posts':
    case 'missing':
      return '/studio/';
    case 'post':
      return `/studio/posts/${route.id}/`;
    default:
      return `/studio/${route.name}/`;
  }
}

const listeners = new Set<() => void>();
// Registered before any screen listens, so it runs before the screen changes.
addEventListener('popstate', focusNextTitle);
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
};

/** Goes to an address in the studio without reloading the page. */
export function navigate(to: string, { replace = false } = {}): void {
  if (to === location.pathname + location.search) return;
  if (replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  focusNextTitle();
  for (const listener of listeners) listener();
  window.scrollTo(0, 0);
}

/** For <a href> links inside the studio: a plain click navigates in place; others as usual. */
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
  if (!href?.startsWith('/studio/') || event.currentTarget.target) return;
  event.preventDefault();
  navigate(href);
}

export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, () => location.pathname);
  return parseRoute(pathname);
}

/** The page's <title>, per screen. */
export function useTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · Studio`;
  }, [title]);
}
