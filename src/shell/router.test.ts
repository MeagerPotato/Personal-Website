// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { site } from '../config/site';
import { ABOUT, FISHAI, HOME, pageHtml, showPage, type TestPage } from './page-fixtures';
import { startRouter, type Router, type RouterOptions } from './router';

const ORIGIN = 'https://allenkh.com';

/** A tiny site for the fake network: path -> page, or a canned Response. */
type Site = Record<string, TestPage | (() => Response)>;

const SITE: Site = {
  '/': HOME,
  '/about/': ABOUT,
  '/projects/fishai/': FISHAI,
};

const htmlResponse = (page: TestPage): Response =>
  new Response(pageHtml(page), { headers: { 'content-type': 'text/html; charset=utf-8' } });

interface Harness {
  router: Router;
  fetched: string[];
  hardLoads: string[];
  reloads: number;
  navigations: Array<{ path: string; kind: string }>;
  /** Hold responses back until released, to stage races. */
  gate(path: string): () => void;
}

function start(site_: Site = SITE, extra: Partial<RouterOptions> = {}): Harness {
  const gates = new Map<string, Promise<void>>();
  const harness: Harness = {
    router: undefined as unknown as Router,
    fetched: [],
    hardLoads: [],
    reloads: 0,
    navigations: [],
    gate(path) {
      let release = (): void => undefined;
      gates.set(path, new Promise<void>((resolve) => (release = resolve)));
      return release;
    },
  };

  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    harness.fetched.push(url.pathname);
    await gates.get(url.pathname);
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const entry = site_[url.pathname];
    if (!entry) return new Response('not found', { status: 404 });
    return typeof entry === 'function' ? entry() : htmlResponse(entry);
  }) as typeof fetch;

  harness.router = startRouter({
    navItems: site.nav,
    fetch: fakeFetch,
    hardLoad: (href) => harness.hardLoads.push(new URL(href).pathname),
    reload: () => (harness.reloads += 1),
    onNavigate: ({ url, kind }) => harness.navigations.push({ path: url.pathname, kind }),
    ...extra,
  });
  return harness;
}

const heading = (): string | null | undefined => document.querySelector('main h1')?.textContent;
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

function click(selector: string, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  document.querySelector(selector)?.dispatchEvent(event);
  return event;
}

let harness: Harness | undefined;

beforeEach(() => {
  // Every test starts on the home page, in a history entry that says so. (Test setup only: in
  // the app, router.ts is the one file that may write history, and the lint rule holds it to it.)
  window.history.replaceState(null, '', `${ORIGIN}/`);
  showPage(HOME);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  harness?.router.dispose();
  harness = undefined;
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('a click on a same-site link', () => {
  it('shows the next page without a page load, and keeps the canvas', async () => {
    harness = start();
    const canvas = document.querySelector('canvas');

    const event = click('#to-about');
    await flush();

    expect(event.defaultPrevented).toBe(true);
    expect(location.pathname).toBe('/about/');
    expect(heading()).toBe('About');
    expect(document.title).toBe('about');
    expect(document.querySelector('canvas')).toBe(canvas);
    expect(harness.hardLoads).toEqual([]);
    expect(harness.navigations).toEqual([{ path: '/about/', kind: 'push' }]);
  });

  it('then scrolls to the top, moves focus to the heading, and marks the nav', async () => {
    harness = start();
    click('#to-about');
    await flush();

    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, left: 0, behavior: 'instant' });
    expect(document.activeElement).toBe(document.querySelector('main h1'));
    expect(document.querySelector('.site-nav a[aria-current]')?.getAttribute('href')).toBe(
      '/about/',
    );
  });

  it('leaves modified clicks and opted-out links to the browser', async () => {
    harness = start();
    expect(click('#to-about', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(click('#to-about', { button: 1 }).defaultPrevented).toBe(false);
    expect(click('footer a[data-router-ignore]').defaultPrevented).toBe(false);
    await flush();
    expect(harness.fetched).toEqual([]);
    expect(location.pathname).toBe('/');
  });

  it('never steals focus on the initial load', () => {
    harness = start();
    expect(document.activeElement).toBe(document.body);
  });
});

describe('when anything looks wrong, the browser loads the page normally', () => {
  it('a 404: the real 404 page must arrive by a real page load', async () => {
    harness = start();
    await harness.router.navigate('/nope/');
    expect(harness.hardLoads).toEqual(['/nope/']);
    expect(heading()).toBe('Home');
    expect(location.pathname).toBe('/');
  });

  it('a network error', async () => {
    harness = start({
      '/about/': () => {
        throw new TypeError('network down');
      },
    });
    await harness.router.navigate('/about/');
    expect(harness.hardLoads).toEqual(['/about/']);
  });

  it('an answer that is not HTML', async () => {
    harness = start({
      '/about/': () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
    });
    await harness.router.navigate('/about/');
    expect(harness.hardLoads).toEqual(['/about/']);
  });

  it('a page from a newer deploy, and a plain-only page', async () => {
    harness = start({
      '/about/': { ...ABOUT, build: 'a-newer-deploy' },
      '/lost/': { ...ABOUT, plainOnly: true },
    });
    await harness.router.navigate('/about/');
    await harness.router.navigate('/lost/');
    expect(harness.hardLoads).toEqual(['/about/', '/lost/']);
    expect(heading()).toBe('Home');
    expect(location.pathname).toBe('/');
  });
});

describe('history', () => {
  it('pushes one entry per navigation and replaces for a link to the page itself', async () => {
    harness = start();
    const before = history.length;
    await harness.router.navigate('/about/');
    await harness.router.navigate('/about/');
    await harness.router.navigate('/projects/fishai/', { replace: true });

    expect(history.length).toBe(before + 1);
    expect(harness.navigations.map((entry) => entry.kind)).toEqual(['push', 'replace', 'replace']);
    expect(location.pathname).toBe('/projects/fishai/');
  });

  it('collapses rapid clicks into ONE entry: the latest navigation wins', async () => {
    harness = start();
    const before = history.length;
    const releaseAbout = harness.gate('/about/');

    const slow = harness.router.navigate('/about/');
    const fast = harness.router.navigate('/projects/fishai/');
    await fast;
    releaseAbout();
    await slow;
    await flush();

    expect(heading()).toBe('FishAI');
    expect(location.pathname).toBe('/projects/fishai/');
    expect(history.length).toBe(before + 1);
    expect(harness.hardLoads).toEqual([]);
    expect(harness.navigations).toEqual([{ path: '/projects/fishai/', kind: 'push' }]);
  });

  it('on Back, shows the earlier page again and restores where it was scrolled to', async () => {
    harness = start();
    Object.defineProperty(window, 'scrollY', { value: 640, configurable: true });
    await harness.router.navigate('/about/');
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });

    history.back();
    await flush();

    expect(location.pathname).toBe('/');
    expect(heading()).toBe('Home');
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 640, left: 0, behavior: 'instant' });
    expect(harness.navigations.at(-1)).toEqual({ path: '/', kind: 'pop' });
    expect(document.querySelector('.site-nav a[aria-current]')).toBeNull();
  });

  it('on Back to a page it cannot swap in, reloads: the URL is already right', async () => {
    const pages: Site = { ...SITE };
    harness = start(pages);
    await harness.router.navigate('/about/');
    pages['/'] = () => new Response('gone', { status: 500 });

    history.back();
    await flush();
    await flush();

    // The home page was never fetched in this session (it arrived by a real page load), so Back
    // goes to the network, gets the 500, and gives up the soft way.
    expect(harness.reloads).toBe(1);
    expect(harness.hardLoads).toEqual([]);
  });
});

describe('prefetch', () => {
  it('fetches once, and the click that follows reuses it', async () => {
    harness = start();
    harness.router.prefetch('/about/');
    harness.router.prefetch('/about/');
    await flush();
    await harness.router.navigate('/about/');

    expect(harness.fetched).toEqual(['/about/']);
    expect(heading()).toBe('About');
  });

  it('does not fetch the page that is already showing', async () => {
    harness = start();
    harness.router.prefetch('/');
    await flush();
    expect(harness.fetched).toEqual([]);
  });

  it('a failed prefetch is forgotten, so the click tries again', async () => {
    const pages: Site = { '/about/': () => new Response('busy', { status: 503 }) };
    harness = start(pages);
    harness.router.prefetch('/about/');
    await flush();
    pages['/about/'] = ABOUT;
    await harness.router.navigate('/about/');

    expect(harness.fetched).toEqual(['/about/', '/about/']);
    expect(heading()).toBe('About');
    expect(harness.hardLoads).toEqual([]);
  });

  it('starts on keyboard focus of a link', async () => {
    harness = start();
    document
      .querySelector('#to-about')
      ?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await flush();
    expect(harness.fetched).toEqual(['/about/']);
  });
});

describe('dispose', () => {
  it('hands links back to the browser', async () => {
    harness = start();
    harness.router.dispose();
    expect(click('#to-about').defaultPrevented).toBe(false);
    await flush();
    expect(harness.fetched).toEqual([]);
    expect(history.scrollRestoration).toBe('auto');
  });
});
