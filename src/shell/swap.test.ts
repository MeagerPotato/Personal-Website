// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { site } from '../config/site';
import { ABOUT, FISHAI, HOME, parsePage, showPage } from './page-fixtures';
import { focusHeading, markCurrentNav, swapBlocker, swapHead, swapMain } from './swap';

/** The whole document as a string: what "the same DOM" means in these tests. */
const snapshot = (): string => document.documentElement.outerHTML;

/** What a fresh load of `page` looks like, for comparison. */
function freshLoad(page: Parameters<typeof showPage>[0]): string {
  showPage(page);
  return snapshot();
}

function softNavigate(to: Parameters<typeof parsePage>[0], pathname: string): void {
  const next = parsePage(to);
  swapHead(document, next);
  swapMain(document, next);
  markCurrentNav(document, site.nav, pathname);
}

beforeEach(() => showPage(HOME));

describe('a soft navigation ends in the same DOM as a hard one', () => {
  it('home -> about', () => {
    softNavigate(ABOUT, '/about/');
    const soft = snapshot();
    expect(soft).toBe(freshLoad(ABOUT));
  });

  it('home -> a project with extra head nodes -> about -> home, every step', () => {
    softNavigate(FISHAI, '/projects/fishai/');
    const onProject = snapshot();
    softNavigate(ABOUT, '/about/');
    const onAbout = snapshot();
    softNavigate(HOME, '/');
    const onHome = snapshot();

    expect(onProject).toBe(freshLoad(FISHAI));
    expect(onAbout).toBe(freshLoad(ABOUT));
    expect(onHome).toBe(freshLoad(HOME));
  });
});

describe('swapHead', () => {
  it('keeps document order: per-page nodes land between the same shared nodes', () => {
    swapHead(document, parsePage(FISHAI));
    const order = [...document.head.children].map(
      (node) => node.getAttribute('property') ?? node.getAttribute('name') ?? node.tagName,
    );
    expect(order).toEqual([
      'META', // charset
      'TITLE',
      'description',
      'LINK', // canonical
      'og:type',
      'og:title',
      'og:image',
      'SCRIPT',
      'build',
      'LINK', // stylesheet
    ]);
    expect(document.title).toBe('fishai');
  });

  it('never moves or replaces a shared node: re-inserting the stylesheet would reload it', () => {
    const stylesheet = document.head.querySelector('link[rel="stylesheet"]');
    const charset = document.head.querySelector('meta[charset]');
    swapHead(document, parsePage(FISHAI));
    swapHead(document, parsePage(ABOUT));
    expect(document.head.querySelector('link[rel="stylesheet"]')).toBe(stylesheet);
    expect(document.head.querySelector('meta[charset]')).toBe(charset);
    expect(document.head.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(1);
  });

  it('removes per-page nodes the next page does not have', () => {
    swapHead(document, parsePage(FISHAI));
    swapHead(document, parsePage(ABOUT));
    expect(document.head.querySelector('[property="og:image"]')).toBeNull();
    expect(document.head.querySelector('script')).toBeNull();
  });
});

describe('swapMain', () => {
  it('replaces the children and keeps the element, its attributes, and the canvas', () => {
    const main = document.querySelector('main');
    const canvas = document.querySelector('canvas');
    swapMain(document, parsePage(ABOUT));
    expect(document.querySelector('main')).toBe(main);
    expect(main?.getAttribute('tabindex')).toBe('-1');
    expect(main?.querySelector('#story')?.textContent).toBe('Rockets.');
    expect(main?.querySelector('#to-about')).toBeNull();
    expect(document.querySelector('canvas')).toBe(canvas);
  });
});

describe('markCurrentNav', () => {
  const currentLinks = (): Array<[string | null, string | null]> =>
    [...document.querySelectorAll('.site-nav a[aria-current]')].map((link) => [
      link.getAttribute('href'),
      link.getAttribute('aria-current'),
    ]);

  it('marks the page, then the section, then nothing, exactly as the layout would', () => {
    markCurrentNav(document, site.nav, '/about/');
    expect(currentLinks()).toEqual([['/about/', 'page']]);
    markCurrentNav(document, site.nav, '/projects/fishai/');
    expect(currentLinks()).toEqual([['/projects/', 'true']]);
    markCurrentNav(document, site.nav, '/');
    expect(currentLinks()).toEqual([]);
  });
});

describe('swapBlocker', () => {
  it('lets an ordinary page through', () => {
    expect(swapBlocker(document, parsePage(ABOUT))).toBeNull();
  });

  it('blocks a page from a different deploy', () => {
    expect(swapBlocker(document, parsePage({ ...ABOUT, build: 'def456' }))).toBe('different build');
  });

  it('blocks plain-only pages: the 404 must never be swapped in', () => {
    expect(swapBlocker(document, parsePage({ ...ABOUT, plainOnly: true }))).toBe('plain-only page');
  });

  it('blocks a page whose shared <head> differs, and anything without a <main>', () => {
    const rogue = parsePage({ ...ABOUT, rogueHead: '<meta name="rogue" content="x">' });
    expect(swapBlocker(document, rogue)).toBe('different <head>');
    const bare = new DOMParser().parseFromString('<p>not one of ours</p>', 'text/html');
    expect(swapBlocker(document, bare)).toBe('no <main>');
  });
});

describe('focusHeading', () => {
  it('moves focus to the heading without changing the DOM', () => {
    const before = snapshot();
    focusHeading(document);
    expect(document.activeElement).toBe(document.querySelector('main h1'));
    expect(snapshot()).toBe(before);
  });
});
