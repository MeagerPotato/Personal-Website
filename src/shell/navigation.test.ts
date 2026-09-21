import { describe, expect, it } from 'vitest';
import {
  ExpiringCache,
  interceptableUrl,
  isSwappableResponse,
  mayPrefetch,
  pageKey,
  type AnchorLike,
  type ClickLike,
} from './navigation';

const ORIGIN = 'https://allenkh.com';
const HERE = { origin: ORIGIN, pathname: '/projects/', search: '' };

const click = (overrides: Partial<ClickLike> = {}): ClickLike => ({
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
  ...overrides,
});

function anchor(
  href: string,
  attributes: Record<string, string> = {},
  insideIgnored = false,
): AnchorLike {
  const all: Record<string, string> = { href, ...attributes };
  return {
    href: new URL(href, `${ORIGIN}${HERE.pathname}`).href,
    target: all.target ?? '',
    hasAttribute: (name) => name in all,
    getAttribute: (name) => all[name] ?? null,
    closest: (selector) =>
      selector === '[data-router-ignore]' && (insideIgnored || 'data-router-ignore' in all)
        ? {}
        : null,
  };
}

describe('interceptableUrl', () => {
  it('takes over an ordinary left click on a same-site page link', () => {
    expect(interceptableUrl(click(), anchor('/about/'), HERE)?.pathname).toBe('/about/');
    expect(interceptableUrl(click(), anchor('fishai/'), HERE)?.pathname).toBe('/projects/fishai/');
    expect(interceptableUrl(click(), anchor('/about/', { target: '_self' }), HERE)).not.toBeNull();
  });

  it('leaves every "open it somewhere else" gesture to the browser', () => {
    for (const gesture of [
      { button: 1 },
      { button: 2 },
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { defaultPrevented: true },
    ]) {
      expect(interceptableUrl(click(gesture), anchor('/about/'), HERE)).toBeNull();
    }
    expect(interceptableUrl(click(), anchor('/about/', { target: '_blank' }), HERE)).toBeNull();
  });

  it('leaves downloads, opted-out links and rel=external alone', () => {
    expect(interceptableUrl(click(), anchor('/about/', { download: '' }), HERE)).toBeNull();
    expect(
      interceptableUrl(click(), anchor('?plain', { 'data-router-ignore': '' }), HERE),
    ).toBeNull();
    expect(interceptableUrl(click(), anchor('/about/', {}, true), HERE)).toBeNull();
    expect(
      interceptableUrl(click(), anchor('/about/', { rel: 'noopener external' }), HERE),
    ).toBeNull();
  });

  it('leaves other sites and other schemes alone, subdomains included', () => {
    for (const href of [
      'https://github.com/MeagerPotato',
      'https://days2meet.allenkh.com/',
      'http://allenkh.com/about/',
      'mailto:someone@example.com',
    ]) {
      expect(interceptableUrl(click(), anchor(href), HERE)).toBeNull();
    }
  });

  it('leaves files alone: a PDF, an image, the universe manifest', () => {
    for (const href of ['/resume.pdf', '/og/default.png', '/universe.json']) {
      expect(interceptableUrl(click(), anchor(href), HERE)).toBeNull();
    }
  });

  it('lets the browser scroll to an anchor on the page that is showing', () => {
    expect(interceptableUrl(click(), anchor('#the-bots'), HERE)).toBeNull();
    expect(interceptableUrl(click(), anchor('/projects/#the-bots'), HERE)).toBeNull();
  });

  it('does take a link to an anchor on ANOTHER page, and a link to the page itself', () => {
    expect(interceptableUrl(click(), anchor('/projects/fishai/#the-bots'), HERE)?.hash).toBe(
      '#the-bots',
    );
    expect(interceptableUrl(click(), anchor('/projects/'), HERE)?.pathname).toBe('/projects/');
  });

  it('ignores an <a> without href', () => {
    const bare = { ...anchor('/about/'), hasAttribute: () => false };
    expect(interceptableUrl(click(), bare, HERE)).toBeNull();
  });
});

describe('isSwappableResponse', () => {
  const response = (ok: boolean, type: string | null, url = `${ORIGIN}/about/`) => ({
    ok,
    url,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? type : null) },
  });

  it('accepts a successful HTML answer from this site', () => {
    expect(isSwappableResponse(response(true, 'text/html; charset=utf-8'), ORIGIN)).toBe(true);
    expect(isSwappableResponse(response(true, 'TEXT/HTML', ''), ORIGIN)).toBe(true);
  });

  it('rejects errors (the 404 page must arrive by a real page load), non-HTML and no type', () => {
    expect(isSwappableResponse(response(false, 'text/html'), ORIGIN)).toBe(false);
    expect(isSwappableResponse(response(true, 'application/json'), ORIGIN)).toBe(false);
    expect(isSwappableResponse(response(true, null), ORIGIN)).toBe(false);
  });

  it('rejects an answer that was redirected off the site', () => {
    expect(
      isSwappableResponse(response(true, 'text/html', 'https://elsewhere.example/'), ORIGIN),
    ).toBe(false);
  });
});

describe('pageKey', () => {
  it('is the path and the query, never the hash', () => {
    expect(pageKey(new URL('https://x.test/a/?q=1#top'))).toBe('/a/?q=1');
  });
});

describe('ExpiringCache', () => {
  it('forgets the least recently USED entry, not the oldest one', () => {
    const cache = new ExpiringCache<number>(2, 1000, () => 0);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1); // "a" is now the most recent
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });

  it('expires entries after their time to live', () => {
    let now = 0;
    const cache = new ExpiringCache<string>(4, 1000, () => now);
    cache.set('a', 'fresh');
    now = 999;
    expect(cache.get('a')).toBe('fresh');
    now = 1000;
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('replaces and deletes', () => {
    const cache = new ExpiringCache<number>(2, 1000, () => 0);
    cache.set('a', 1);
    cache.set('a', 2);
    expect(cache.size).toBe(1);
    expect(cache.get('a')).toBe(2);
    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
  });
});

describe('mayPrefetch', () => {
  it('spends data only when the visitor has not asked to save it', () => {
    expect(mayPrefetch(undefined)).toBe(true);
    expect(mayPrefetch({ saveData: false, effectiveType: '4g' })).toBe(true);
    expect(mayPrefetch({ saveData: true, effectiveType: '4g' })).toBe(false);
    expect(mayPrefetch({ effectiveType: '2g' })).toBe(false);
    expect(mayPrefetch({ effectiveType: 'slow-2g' })).toBe(false);
  });
});
