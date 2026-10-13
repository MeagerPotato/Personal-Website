// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokens } from '../universe/design/tokens';
import { DECK } from './deck';
import {
  barReach,
  footReach,
  HUD_ROW_REM,
  mirrorInset,
  NARROW,
  panelInset,
  watchPanelInset,
  type PanelInset,
} from './panel-inset';

const desktop = { width: 1280, height: 800 };
const phone = { width: 390, height: 844 };
/** The column on the right of a desktop window, and the sheet at the bottom of a phone. */
const column = { offsetLeft: 784, offsetTop: 76, offsetWidth: 480, offsetHeight: 708 };
const sheet = { offsetLeft: 0, offsetTop: 354, offsetWidth: 390, offsetHeight: 490 };

describe('panel inset', () => {
  it('covers the right of a wide window, from the left edge of the panel', () => {
    expect(panelInset(column, true, false, desktop)).toEqual({
      top: 0,
      right: 496,
      bottom: 0,
      left: 0,
      frameTop: 0,
    });
  });

  it('covers the bottom of a narrow window, from the top edge of the sheet', () => {
    expect(panelInset(sheet, true, true, phone)).toEqual({
      top: 0,
      right: 0,
      bottom: 490,
      left: 0,
      frameTop: 0,
    });
  });

  it('covers nothing on the left: a panel is on the right, a sheet at the bottom', () => {
    for (const open of [true, false]) {
      expect(panelInset(column, open, false, desktop, 64, 120).left).toBe(0);
      expect(panelInset(sheet, open, true, phone, 105, 161).left).toBe(0);
    }
  });

  it('covers nothing when the panel is closed, or is not laid out at all (plain mode)', () => {
    expect(panelInset(column, false, false, desktop)).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      frameTop: 0,
    });
    expect(
      panelInset(
        { offsetLeft: 0, offsetTop: 0, offsetWidth: 0, offsetHeight: 0 },
        true,
        false,
        desktop,
      ),
    ).toEqual({ top: 0, right: 0, bottom: 0, left: 0, frameTop: 0 });
  });

  it('passes on how far down the top bar reaches, panel or no panel', () => {
    expect(panelInset(sheet, true, true, phone, 105)).toEqual({
      top: 105,
      right: 0,
      bottom: 490,
      left: 0,
      frameTop: 0,
    });
    expect(panelInset(sheet, false, true, phone, 105)).toEqual({
      top: 105,
      right: 0,
      bottom: 0,
      left: 0,
      frameTop: 0,
    });
  });

  it('leaves the solid top of a phone out of the frame, only while the sheet is up', () => {
    // The bar reaches 105 px down, and the row of the Map button ends 56 px below that.
    expect(panelInset(sheet, true, true, phone, 105, 161)).toEqual({
      top: 105,
      right: 0,
      bottom: 490,
      left: 0,
      frameTop: 161,
    });
    expect(panelInset(sheet, false, true, phone, 105, 161).frameTop).toBe(0);
    // A side panel: the bar is a few chips over the sky, which the camera may use.
    expect(panelInset(column, true, false, desktop, 64, 120).frameTop).toBe(0);
  });

  it('knows the row under the bar as the stylesheet draws it', () => {
    // The Map button hangs --space-3 under the bar's links and is 44 px tall: if either changes
    // in global.css, the camera's frame on a phone would drift. Change them together.
    const css = readFileSync(path.resolve('src/styles/global.css'), 'utf8');
    const mapButton = /\n {2}\.map-toggle \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(mapButton).toContain('top: calc(var(--panel-inset-top, 4rem) + var(--space-3));');
    expect(mapButton).toContain('min-height: 2.75rem;');
    expect(HUD_ROW_REM).toBe(Number.parseFloat(tokens.space[3]) + 2.75);
  });

  it('asks the same questions of the window as the stylesheet does', () => {
    // Which layout the content is in decides what is measured: a query that drifted from the
    // stylesheet's would frame the body for a layout that is not on the screen.
    const css = readFileSync(path.resolve('src/styles/global.css'), 'utf8');
    expect(css).toContain(`\n  @media ${NARROW} {`);
    expect(css).toContain(`\n  @media ${DECK} {`);
    // Once each: a second block under the same query would be a second place to change.
    expect(css.split(`@media ${DECK} {`)).toHaveLength(2);
  });

  it('measures the top bar by what can be pressed in it, not by its padding', () => {
    const control = (width: number, bottom: number) => ({
      getBoundingClientRect: () => ({ width, bottom }),
    });
    // The wordmark, a button that is not displayed on this page, and the links on a second row.
    expect(barReach([control(80, 57), control(0, 0), control(60, 104.6), control(70, 104.6)])).toBe(
      105,
    );
    expect(barReach([])).toBe(0);
  });

  it('measures the corner the footer takes by what shows in it', () => {
    const control = (width: number, top: number, right: number) => ({
      getBoundingClientRect: () => ({ width, top, right }),
    });
    // "Plain version", and the way into the universe, which is not displayed in universe mode.
    expect(footReach([control(145, 744.4, 169.2), control(0, 0, 0)])).toEqual({
      right: 169,
      top: 744,
    });
    expect(footReach([control(0, 0, 0)])).toBeUndefined();
    expect(footReach([])).toBeUndefined();
  });

  it('never goes negative for a panel that is off the screen', () => {
    const away = { offsetLeft: 2000, offsetTop: 2000, offsetWidth: 480, offsetHeight: 700 };
    expect(panelInset(away, true, false, desktop)).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      frameTop: 0,
    });
    expect(panelInset(away, true, true, phone)).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      frameTop: 0,
    });
  });
});

describe('the inset, for the stylesheet', () => {
  it('goes on the root as custom properties, and comes off again', () => {
    const root = document.createElement('div');
    mirrorInset(root, { top: 64, right: 496, bottom: 0, left: 0, frameTop: 0 });
    expect(root.style.getPropertyValue('--panel-inset-top')).toBe('64px');
    expect(root.style.getPropertyValue('--panel-inset-right')).toBe('496px');
    expect(root.style.getPropertyValue('--panel-inset-bottom')).toBe('0px');
    expect(root.style.getPropertyValue('--panel-inset-left')).toBe('0px');
    // Something on the left as well: the fourth side, like the others.
    mirrorInset(root, { top: 64, right: 372, bottom: 0, left: 420, frameTop: 0 });
    expect(root.style.getPropertyValue('--panel-inset-right')).toBe('372px');
    expect(root.style.getPropertyValue('--panel-inset-left')).toBe('420px');
    mirrorInset(root, null);
    expect(root.style.getPropertyValue('--panel-inset-top')).toBe('');
    expect(root.style.getPropertyValue('--panel-inset-right')).toBe('');
    expect(root.style.getPropertyValue('--panel-inset-bottom')).toBe('');
    expect(root.style.getPropertyValue('--panel-inset-left')).toBe('');
  });

  it('is what puts the dock prompt in the middle of what is left, in the stylesheet', () => {
    // The engine's layer ends where a side panel begins, so half of it is the middle of what
    // the panel leaves; whatever stands on the left moves that middle half as far the other way.
    const css = readFileSync(path.resolve('src/styles/global.css'), 'utf8');
    const overlay = /\n {2}html\[data-mode='universe'\] #universe-overlay \{([^}]*)\}/.exec(css);
    expect(overlay?.[1]).toContain(
      'inset: 0 var(--panel-inset-right, 0) var(--panel-inset-bottom, 0) 0;',
    );
    const prompt = /\n {2}\.dock-prompt \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(prompt).toContain('left: calc(50% + var(--panel-inset-left, 0px) / 2);');
    expect(prompt).toContain('translate: var(--prompt-x) 0;');
  });
});

describe('watching the panel', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    delete document.documentElement.dataset.panel;
    vi.restoreAllMocks();
  });

  /** Let the observers deliver. */
  const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

  function layOut(): void {
    document.body.innerHTML = '<main class="panel"></main>';
    const panel = document.querySelector('.panel');
    for (const [key, value] of Object.entries(column)) {
      Object.defineProperty(panel, key, { value, configurable: true });
    }
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  }

  it('reports at once, then only what changed, and stops when told to', async () => {
    layOut();
    document.documentElement.dataset.panel = 'open';
    const seen: [PanelInset, boolean][] = [];
    const watch = watchPanelInset((inset, first) => seen.push([inset, first]));
    expect(seen).toEqual([[{ top: 0, right: 496, bottom: 0, left: 0, frameTop: 0 }, true]]);

    document.documentElement.dataset.panel = 'closed';
    await settle();
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual([{ top: 0, right: 0, bottom: 0, left: 0, frameTop: 0 }, false]);

    // A resize that changes nothing is not news.
    window.dispatchEvent(new Event('resize'));
    await settle();
    expect(seen).toHaveLength(2);

    watch.stop();
    document.documentElement.dataset.panel = 'open';
    await settle();
    expect(seen).toHaveLength(2);
  });

  it('has nothing to watch on a page without a panel', () => {
    const onChange = vi.fn();
    const watch = watchPanelInset(onChange);
    watch.refresh();
    watch.stop();
    expect(onChange).not.toHaveBeenCalled();
  });

  /** The deck at 1280 x 800: the stage, a head, and two sections in the right column. */
  const stage = { offsetLeft: 24, offsetTop: 76, offsetWidth: 1232, offsetHeight: 656 };
  function place(element: Element | null, box: Partial<typeof stage>): void {
    for (const [key, value] of Object.entries(box)) {
      Object.defineProperty(element, key, { value, configurable: true });
    }
  }
  function layOutDeck(sections = 2): HTMLElement[] {
    document.body.innerHTML =
      '<div class="panel"><div class="panel-bar"></div><main><div data-card></div>' +
      '<section data-card></section>'.repeat(sections) +
      '</main></div>';
    place(document.querySelector('.panel'), stage);
    const cards = [...document.querySelectorAll<HTMLElement>('[data-card]')];
    place(cards[0] ?? null, { offsetLeft: 0, offsetWidth: 307 });
    for (const card of cards.slice(1)) place(card, { offsetLeft: 925, offsetWidth: 307 });
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    return cards;
  }
  /** The window answers the stylesheet's queries: the deck's, or the side panel's. */
  function wide(deck: boolean): void {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) => ({ matches: deck && query === DECK }) as MediaQueryList,
    );
  }

  it('measures a deck of cards: what the two columns leave free between them', () => {
    layOutDeck();
    wide(true);
    document.documentElement.dataset.panel = 'open';
    const seen: [PanelInset, boolean][] = [];
    const watch = watchPanelInset((inset, first) => seen.push([inset, first]));
    // 24 px clear of the head's right edge, and of the last card's left edge.
    expect(seen).toEqual([[{ top: 0, right: 355, bottom: 0, left: 355, frameTop: 0 }, true]]);
    watch.stop();
  });

  it('measures again when asked: an open card widens its column, and the panel stays as it was', () => {
    const cards = layOutDeck();
    wide(true);
    document.documentElement.dataset.panel = 'open';
    const seen: [PanelInset, boolean][] = [];
    const watch = watchPanelInset((inset, first) => seen.push([inset, first]));

    // The last card opens: the right column is 480 px wide.
    for (const card of cards.slice(1)) place(card, { offsetLeft: 752, offsetWidth: 480 });
    watch.refresh();
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual([{ top: 0, right: 528, bottom: 0, left: 355, frameTop: 0 }, false]);

    // Asked again with nothing moved: not news.
    watch.refresh();
    expect(seen).toHaveLength(2);

    watch.stop();
    place(cards[0] ?? null, { offsetWidth: 480 });
    watch.refresh();
    expect(seen).toHaveLength(2);
  });

  it('leaves the whole right free for a deck with no section card', () => {
    layOutDeck(0);
    wide(true);
    document.documentElement.dataset.panel = 'open';
    const onChange = vi.fn();
    watchPanelInset(onChange).stop();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(
      { top: 0, right: 0, bottom: 0, left: 355, frameTop: 0 },
      true,
    );
  });

  it('is the panel’s own inset for the same cards in a window too small for a deck', () => {
    layOutDeck();
    place(document.querySelector('.panel'), column);
    wide(false);
    document.documentElement.dataset.panel = 'open';
    const onChange = vi.fn();
    watchPanelInset(onChange).stop();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(
      { top: 0, right: 496, bottom: 0, left: 0, frameTop: 0 },
      true,
    );
  });

  it('is the panel’s own inset on a wide window for a page without cards (the home page)', () => {
    layOut();
    wide(true);
    document.documentElement.dataset.panel = 'open';
    const onChange = vi.fn();
    watchPanelInset(onChange).stop();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(
      { top: 0, right: 496, bottom: 0, left: 0, frameTop: 0 },
      true,
    );
  });
});
