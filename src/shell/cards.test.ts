// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deck } from '../universe/api';
import { showAnchor, startCards, type Cards } from './cards';
import { FISHAI, HOME, showPage, type TestPage } from './page-fixtures';

/** Every scroll into view from now on: which element, and how. */
function watchScrolls(): Array<{ element: unknown; how: unknown }> {
  const scrolls: Array<{ element: unknown; how: unknown }> = [];
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (
    this: Element,
    how?: boolean | ScrollIntoViewOptions,
  ) {
    scrolls.push({ element: this, how });
  });
  return scrolls;
}

afterEach(() => vi.restoreAllMocks());

describe('showAnchor', () => {
  beforeEach(() => showPage(FISHAI));

  it('brings the part that the fragment names to the top of what scrolls', () => {
    const scrolls = watchScrolls();
    showAnchor('the-bots');
    expect(scrolls).toEqual([
      { element: document.getElementById('the-bots'), how: { block: 'start' } },
    ]);
  });

  it('moves nothing for an id that names no place in the content', () => {
    const scrolls = watchScrolls();
    showAnchor(null);
    showAnchor('main');
    showAnchor('nowhere');
    expect(scrolls).toEqual([]);
  });

  it('leaves the focus on the link that was pressed, and writes nothing in the page', () => {
    watchScrolls();
    const link = document.querySelector<HTMLElement>('#the-bots > a');
    link?.focus();
    const before = document.body.innerHTML;

    showAnchor('the-bots');
    expect(document.activeElement).toBe(link);
    expect(document.body.innerHTML).toBe(before);
  });
});

const section = (id: string, title: string): string =>
  `<section data-card aria-labelledby="${id}"><h2 id="${id}"><a href="#${id}">${title}</a></h2>` +
  `<p id="${id}-text">About ${title}, with <a id="${id}-link" href="/elsewhere/">a link</a> ` +
  `and <button id="${id}-button" type="button">a button</button>.</p></section>`;

/**
 * A page of five boxes: the head and "one" stand in the left column, "two", "three" and "four"
 * in the right one (deck.ts, `sideOf`).
 */
const PAGE: TestPage = {
  title: 'about',
  current: '/about/',
  main:
    '<div data-card><nav class="crumbs"><a id="crumb" href="/projects/">Projects</a></nav>' +
    '<header class="page-header"><h1 tabindex="-1">About</h1><p id="lede">Me.</p></header></div>' +
    section('one', 'One') +
    section('two', 'Two') +
    section('three', 'Three') +
    section('four', 'Four'),
};

const root = document.documentElement;
const main = (): HTMLElement => document.getElementById('main') as HTMLElement;
const at = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const titleOf = (id: string): HTMLElement =>
  document.querySelector<HTMLElement>(`#${id} > a`) as HTMLElement;
const cardOf = (id: string): HTMLElement => at(id).parentElement as HTMLElement;

/** Whether the window is wide and tall enough for the deck, and a way to change its mind. */
function layout(deck: boolean): { set(deck: boolean): void } {
  const listeners = new Set<() => void>();
  const list = {
    matches: deck,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  vi.spyOn(window, 'matchMedia').mockReturnValue(list as unknown as MediaQueryList);
  return {
    set(next) {
      list.matches = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

/** What the router does with a fragment: replace it in the entry that is showing. */
function fakeRouter(): {
  busy: boolean;
  anchor: ReturnType<typeof vi.fn<(id: string | null) => void>>;
} {
  return {
    busy: false,
    anchor: vi.fn<(id: string | null) => void>((id) => {
      window.history.replaceState(
        history.state,
        '',
        id === null ? location.pathname + location.search : `#${id}`,
      );
    }),
  };
}

const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

const click = (target: Element, init: MouseEventInit = {}): MouseEvent => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  target.dispatchEvent(event);
  return event;
};

/** A turn of the wheel `dy` px down, at time `t` (ms). */
const roll = (dy: number, t: number, init: WheelEventInit = {}, target: EventTarget = window) => {
  const event = new WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true, ...init });
  // happy-dom's wheel has no modifier keys of its own: say so by hand.
  Object.defineProperties(event, {
    timeStamp: { value: t },
    ctrlKey: { value: init.ctrlKey === true },
    metaKey: { value: init.metaKey === true },
  });
  target.dispatchEvent(event);
  return event;
};

describe('the deck', () => {
  let cards: Cards | undefined;
  let router: ReturnType<typeof fakeRouter>;
  let announce: ReturnType<typeof vi.fn<(text: string) => void>>;
  let refreshInset: ReturnType<typeof vi.fn<() => void>>;
  let pristine = '';

  /** Start afresh (one at a time: whatever was started before is disposed first). */
  function start(options: { deck?: boolean; hash?: string; panel?: boolean } = {}) {
    cards?.dispose();
    const media = layout(options.deck ?? true);
    window.history.replaceState(null, '', options.hash ?? '/');
    cards = startCards({
      router,
      panelOpen: () => options.panel ?? true,
      bodyOf: (pathname) => (pathname === '/' ? 'page/about' : null),
      announce,
      refreshInset,
    });
    return media;
  }

  const state = (): [string | undefined, string | undefined, string] => [
    root.dataset.cardOpen,
    root.dataset.cardSide,
    root.style.getPropertyValue('--deck-mates'),
  ];

  beforeEach(() => {
    showPage(PAGE);
    pristine = main().innerHTML;
    router = fakeRouter();
    announce = vi.fn<(text: string) => void>();
    refreshInset = vi.fn<() => void>();
  });

  afterEach(() => {
    // Whatever happened, nothing was written inside <main>: every state is on <html>.
    expect(main().innerHTML).toBe(pristine);
    cards?.dispose();
    cards = undefined;
    window.history.replaceState(null, '', '/');
    delete root.dataset.map;
  });

  describe('what the URL says', () => {
    it('is the overview with no fragment: nothing on <html>', () => {
      start();
      expect(state()).toEqual([undefined, undefined, '']);
    });

    it('opens the card that the fragment names, and says which column it stands in', () => {
      start({ hash: '#three' });
      // The third section, in the right column, which it shares with two others.
      expect(state()).toEqual(['3', 'right', '2']);

      start({ hash: '#one' });
      // The first one stands under the head.
      expect(state()).toEqual(['1', 'left', '1']);
    });

    it('opens the card that holds whatever the fragment names', () => {
      start({ hash: '#two-text' });
      expect(state()).toEqual(['2', 'right', '2']);
    });

    it('is the overview for a fragment that names the head, the page, or nothing', () => {
      for (const hash of ['#lede', '#main', '#nowhere', '#']) {
        start({ hash });
        expect(state(), hash).toEqual([undefined, undefined, '']);
      }
    });

    it('writes it in every layout: the stylesheet decides who reads it', () => {
      start({ deck: false, hash: '#three' });
      expect(state()).toEqual(['3', 'right', '2']);
    });

    it('asks for the free part of the view to be measured again, every time', () => {
      start();
      expect(refreshInset).toHaveBeenCalledTimes(1);
      click(titleOf('two'));
      expect(refreshInset).toHaveBeenCalledTimes(2);
    });

    it('takes its values off <html> when it is disposed', () => {
      start({ hash: '#three' });
      cards?.dispose();
      expect(state()).toEqual([undefined, undefined, '']);
      // And nothing listens any more.
      click(titleOf('two'));
      press('PageDown');
      roll(120, 0);
      expect(router.anchor).not.toHaveBeenCalled();
    });
  });

  describe('a click', () => {
    it('on a title opens its card through the router, and nothing follows the link', () => {
      start();
      const event = click(titleOf('two'));
      expect(event.defaultPrevented).toBe(true);
      expect(router.anchor).toHaveBeenCalledExactlyOnceWith('two');
      expect(location.hash).toBe('#two');
      expect(state()).toEqual(['2', 'right', '2']);
    });

    it('on the open card’s own title closes it', () => {
      start({ hash: '#two' });
      const event = click(titleOf('two'));
      expect(event.defaultPrevented).toBe(true);
      expect(router.anchor).toHaveBeenCalledExactlyOnceWith(null);
      expect(location.hash).toBe('');
      expect(state()).toEqual([undefined, undefined, '']);
    });

    it('on another card’s title goes straight to that card', () => {
      start({ hash: '#two' });
      click(titleOf('four'));
      expect(router.anchor).toHaveBeenCalledExactlyOnceWith('four');
      expect(state()).toEqual(['4', 'right', '2']);
    });

    it('on a title leaves the focus on it, opening and closing, and tells nobody', () => {
      start();
      // The keyboard's Enter is a click on the link that has the focus.
      titleOf('two').focus();
      click(titleOf('two'));
      expect(document.activeElement).toBe(titleOf('two'));
      click(titleOf('two'));
      expect(router.anchor).toHaveBeenLastCalledWith(null);
      // Not sent back to the page's heading: the title still shows, and the next Tab goes on.
      expect(document.activeElement).toBe(titleOf('two'));
      expect(announce).not.toHaveBeenCalled();
    });

    it('anywhere in a short card opens it, and the keyboard carries on from its title', () => {
      start();
      // A press inside <main> leaves the focus on <main> itself (it can take it: tabindex).
      main().focus();
      click(at('three-text'));
      expect(router.anchor).toHaveBeenCalledExactlyOnceWith('three');
      expect(document.activeElement).toBe(titleOf('three'));
      // The card itself, beside its text.
      click(cardOf('one'));
      expect(router.anchor).toHaveBeenLastCalledWith('one');
      expect(document.activeElement).toBe(titleOf('one'));
      expect(announce).not.toHaveBeenCalled();
    });

    it('on the head, while a card is open, shows every card again', () => {
      start({ hash: '#two' });
      click(at('lede'));
      expect(router.anchor).toHaveBeenCalledExactlyOnceWith(null);
      expect(state()).toEqual([undefined, undefined, '']);
    });

    it('on the head of the overview is nothing', () => {
      start();
      click(at('lede'));
      expect(router.anchor).not.toHaveBeenCalled();
    });

    it('on a link or a button in a card is that link’s or that button’s', () => {
      start();
      for (const id of ['three-link', 'three-button', 'crumb']) {
        const event = click(at(id));
        expect(event.defaultPrevented, id).toBe(false);
      }
      expect(router.anchor).not.toHaveBeenCalled();
    });

    it('inside the open card is nothing', () => {
      start({ hash: '#two' });
      click(at('two-text'));
      expect(router.anchor).not.toHaveBeenCalled();
    });

    it('that ends a selection opens nothing', () => {
      start();
      vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false } as Selection);
      click(at('three-text'));
      expect(router.anchor).not.toHaveBeenCalled();
    });

    it('with a modifier, or another button, is the browser’s', () => {
      start();
      for (const init of [
        { ctrlKey: true },
        { metaKey: true },
        { shiftKey: true },
        { button: 1 },
      ]) {
        const event = click(titleOf('two'), init);
        expect(event.defaultPrevented).toBe(false);
      }
      expect(router.anchor).not.toHaveBeenCalled();
    });

    it('is left to the router where the page is one column', () => {
      start({ deck: false });
      const event = click(titleOf('two'));
      expect(event.defaultPrevented).toBe(false);
      click(at('three-text'));
      expect(router.anchor).not.toHaveBeenCalled();
    });
  });

  describe('the focus', () => {
    it('opens a short card when the keyboard lands on something in it, and shows the thing', () => {
      start();
      const scrolls = watchScrolls();
      at('three-link').focus();
      expect(router.anchor).toHaveBeenCalledExactlyOnceWith('three');
      expect(state()).toEqual(['3', 'right', '2']);
      // The focus stays where the keyboard put it, and nobody is told anything.
      expect(document.activeElement).toBe(at('three-link'));
      expect(scrolls).toEqual([{ element: at('three-link'), how: { block: 'nearest' } }]);
      expect(announce).not.toHaveBeenCalled();
    });

    it('goes from one card’s inside to another’s', () => {
      start({ hash: '#two' });
      watchScrolls();
      at('four-button').focus();
      expect(router.anchor).toHaveBeenCalledExactlyOnceWith('four');
    });

    it('on a title changes nothing: a title shows in every state', () => {
      start();
      titleOf('three').focus();
      start({ hash: '#two' });
      titleOf('four').focus();
      expect(router.anchor).not.toHaveBeenCalled();
    });

    it('inside the head’s chip brings the overview back; on its heading it changes nothing', () => {
      start({ hash: '#two' });
      watchScrolls();
      document.querySelector<HTMLElement>('main h1')?.focus();
      expect(router.anchor).not.toHaveBeenCalled();
      at('crumb').focus();
      expect(router.anchor).toHaveBeenCalledExactlyOnceWith(null);
      expect(state()).toEqual([undefined, undefined, '']);
    });

    it('inside the open card, or the head of the overview, changes nothing', () => {
      start({ hash: '#two' });
      at('two-link').focus();
      start();
      at('crumb').focus();
      expect(router.anchor).not.toHaveBeenCalled();
    });

    it('that a pointer moved is the click’s to answer', () => {
      start();
      document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      at('three-button').focus();
      expect(router.anchor).not.toHaveBeenCalled();
      // A key since then: the keyboard again.
      press('Tab');
      at('four-button').focus();
      expect(router.anchor).toHaveBeenCalledExactlyOnceWith('four');
    });

    it('is nobody’s where the page is one column', () => {
      start({ deck: false });
      at('three-link').focus();
      expect(router.anchor).not.toHaveBeenCalled();
    });
  });

  describe('a key', () => {
    it('steps from the overview into the first card and tells whoever is not in the content', () => {
      start();
      const event = press('PageDown');
      expect(event.defaultPrevented).toBe(true);
      expect(router.anchor).toHaveBeenCalledExactlyOnceWith('one');
      expect(announce).toHaveBeenCalledExactlyOnceWith('One, section 1 of 4');
      // The focus was on nothing, and stays there.
      expect(document.activeElement).toBe(document.body);
    });

    it('moves the focus to the new card’s title instead, when it was in the content', () => {
      start();
      titleOf('one').focus();
      press(' ', {}, titleOf('one'));
      expect(router.anchor).toHaveBeenCalledExactlyOnceWith('one');
      press('PageDown', {}, titleOf('one'));
      expect(router.anchor).toHaveBeenLastCalledWith('two');
      expect(document.activeElement).toBe(titleOf('two'));
      // Focus moves or the announcer speaks, never both.
      expect(announce).not.toHaveBeenCalled();
    });

    it('goes back to the overview from the first card, with the focus on the page’s heading', () => {
      start({ hash: '#one' });
      titleOf('one').focus();
      press('PageUp', {}, titleOf('one'));
      expect(router.anchor).toHaveBeenCalledExactlyOnceWith(null);
      expect(document.activeElement).toBe(document.querySelector('main h1'));

      // The same from a visitor whose focus is on nothing: told, and the focus left alone.
      window.history.replaceState(null, '', '#one');
      cards?.sync();
      (document.activeElement as HTMLElement | null)?.blur();
      press('Home');
      expect(document.activeElement).toBe(document.body);
      expect(announce).toHaveBeenCalledExactlyOnceWith('All sections');
    });

    it('scrolls the open card while it has more to show, and steps at its end', () => {
      start({ hash: '#two' });
      const card = cardOf('two');
      let scrollTop = 0;
      Object.defineProperties(card, {
        scrollHeight: { value: 900, configurable: true },
        clientHeight: { value: 300, configurable: true },
        scrollTop: { get: () => scrollTop, set: (value: number) => (scrollTop = value) },
      });
      const scrollBy = vi.fn<(how: ScrollToOptions) => void>();
      card.scrollBy = scrollBy as unknown as typeof card.scrollBy;

      expect(press('PageDown').defaultPrevented).toBe(true);
      expect(scrollBy).toHaveBeenLastCalledWith({ top: 255, behavior: 'smooth' });
      // Held down it scrolls at once, each time.
      press('PageDown', { repeat: true });
      expect(scrollBy).toHaveBeenLastCalledWith({ top: 255, behavior: 'instant' });
      expect(router.anchor).not.toHaveBeenCalled();

      // At the end: held down it stays, pressed afresh it goes on to the next card.
      scrollTop = 600;
      press('PageDown', { repeat: true });
      expect(router.anchor).not.toHaveBeenCalled();
      press('PageDown');
      expect(scrollBy).toHaveBeenCalledTimes(2);
      expect(router.anchor).toHaveBeenCalledExactlyOnceWith('three');
      // The card that closed is put back at its top.
      expect(scrollTop).toBe(0);
    });

    it('scrolls without easing for a visitor who asked for less motion', () => {
      root.dataset.motion = 'reduced';
      start({ hash: '#two' });
      const card = cardOf('two');
      Object.defineProperties(card, {
        scrollHeight: { value: 900, configurable: true },
        clientHeight: { value: 300, configurable: true },
      });
      const scrollBy = vi.fn<(how: ScrollToOptions) => void>();
      card.scrollBy = scrollBy as unknown as typeof card.scrollBy;
      press('PageDown');
      expect(scrollBy).toHaveBeenLastCalledWith({ top: 255, behavior: 'instant' });
      delete root.dataset.motion;
    });

    it('leaves the arrows to the ship unless the focus is in the content', () => {
      start();
      expect(press('ArrowDown').defaultPrevented).toBe(false);
      expect(router.anchor).not.toHaveBeenCalled();
      titleOf('one').focus();
      expect(press('ArrowDown', {}, titleOf('one')).defaultPrevented).toBe(true);
      expect(router.anchor).toHaveBeenCalledExactlyOnceWith('one');
    });

    it('is somebody else’s on a button, in a field, with a modifier, or with the focus elsewhere', () => {
      start();
      // Space presses the button it is on.
      at('one-button').focus();
      cards?.sync();
      router.anchor.mockClear();
      expect(press(' ', {}, at('one-button')).defaultPrevented).toBe(false);
      expect(press('PageDown', { ctrlKey: true }).defaultPrevented).toBe(false);
      expect(press('End', { altKey: true }).defaultPrevented).toBe(false);
      // The focus is in the top bar: its keys are its own.
      const wordmark = document.querySelector<HTMLElement>('.wordmark');
      wordmark?.focus();
      expect(press('PageDown', {}, wordmark ?? document.body).defaultPrevented).toBe(false);
      expect(router.anchor).not.toHaveBeenCalled();
    });

    it('belongs to the star map while that is open', () => {
      start();
      root.dataset.map = 'open';
      expect(press('PageDown').defaultPrevented).toBe(false);
      expect(roll(120, 0).defaultPrevented).toBe(false);
      expect(router.anchor).not.toHaveBeenCalled();
    });

    it('goes to the last card on End and back to all of them on Home', () => {
      start();
      press('End');
      expect(router.anchor).toHaveBeenLastCalledWith('four');
      press('Home');
      expect(router.anchor).toHaveBeenLastCalledWith(null);
      expect(announce.mock.calls).toEqual([['Four, section 4 of 4'], ['All sections']]);
    });
  });

  describe('the wheel', () => {
    it('steps from the overview into the first card, and keeps the browser out of it', () => {
      start();
      const event = roll(120, 1000);
      expect(event.defaultPrevented).toBe(true);
      expect(router.anchor).toHaveBeenCalledExactlyOnceWith('one');
      expect(announce).toHaveBeenCalledExactlyOnceWith('One, section 1 of 4');
    });

    it('goes on from card to card with a wheel kept rolling, and back', () => {
      start();
      roll(120, 0);
      roll(120, 100);
      roll(120, 200);
      expect(router.anchor).toHaveBeenCalledTimes(1);
      roll(120, 400);
      expect(router.anchor).toHaveBeenLastCalledWith('two');
      roll(-120, 800);
      expect(router.anchor).toHaveBeenLastCalledWith('one');
      roll(-120, 1200);
      expect(router.anchor).toHaveBeenLastCalledWith(null);
      // Up from the overview is nowhere.
      roll(-120, 1600);
      expect(router.anchor).toHaveBeenCalledTimes(4);
    });

    it('stops at the last card', () => {
      start({ hash: '#four' });
      expect(roll(120, 0).defaultPrevented).toBe(true);
      expect(router.anchor).not.toHaveBeenCalled();
    });

    it('scrolls the open card from anywhere on the page, and steps only in a new gesture', () => {
      start({ hash: '#two' });
      const card = cardOf('two');
      let scrollTop = 0;
      Object.defineProperties(card, {
        scrollHeight: { value: 500, configurable: true },
        clientHeight: { value: 300, configurable: true },
        scrollTop: { get: () => scrollTop, set: (value: number) => (scrollTop = value) },
      });
      // Over the sky: the browser scrolls nothing there, so the card is scrolled for it.
      expect(roll(120, 0).defaultPrevented).toBe(false);
      expect(scrollTop).toBe(120);
      // Over the card itself the browser does it.
      roll(120, 100, {}, at('two-text'));
      expect(scrollTop).toBe(120);
      // The card arrives at its end in the same gesture: no step, however far it turns.
      scrollTop = 200;
      roll(120, 200);
      roll(120, 300);
      expect(router.anchor).not.toHaveBeenCalled();
      // A pause, then the wheel again.
      roll(120, 700);
      expect(router.anchor).toHaveBeenCalledExactlyOnceWith('three');
    });

    it('counts lines and pages as the engine’s own wheel does', () => {
      start();
      // Three lines: 99 px.
      roll(3, 0, { deltaMode: 1 });
      expect(router.anchor).toHaveBeenCalledExactlyOnceWith('one');
    });

    it('is not the cards’ with Ctrl (the browser’s zoom), or sideways', () => {
      start();
      expect(roll(120, 0, { ctrlKey: true }).defaultPrevented).toBe(false);
      expect(roll(40, 300, { deltaX: 200 }).defaultPrevented).toBe(false);
      expect(router.anchor).not.toHaveBeenCalled();
    });

    it('is the panel’s own where the page is one column', () => {
      const media = start({ deck: false });
      expect(roll(120, 0).defaultPrevented).toBe(false);
      expect(router.anchor).not.toHaveBeenCalled();
      // The window grows into the deck: now it is the cards'.
      media.set(true);
      expect(roll(120, 1000).defaultPrevented).toBe(true);
      expect(router.anchor).toHaveBeenCalledExactlyOnceWith('one');
      // And back again.
      media.set(false);
      expect(roll(120, 2000).defaultPrevented).toBe(false);
      expect(router.anchor).toHaveBeenCalledTimes(1);
    });
  });

  describe('Escape', () => {
    it('closes the open card and says it took the key; with none open it did not', () => {
      start({ hash: '#two' });
      expect(cards?.escape()).toBe(true);
      expect(router.anchor).toHaveBeenCalledExactlyOnceWith(null);
      expect(state()).toEqual([undefined, undefined, '']);
      expect(cards?.escape()).toBe(false);
      expect(router.anchor).toHaveBeenCalledTimes(1);
    });

    it('is the page’s where the page is one column, open card or not', () => {
      start({ deck: false, hash: '#two' });
      expect(cards?.escape()).toBe(false);
      expect(router.anchor).not.toHaveBeenCalled();
    });
  });

  describe('the router', () => {
    it('is asked for nothing while the address bar is ahead of the page', () => {
      start();
      router.busy = true;
      click(titleOf('two'));
      press('PageDown');
      roll(120, 0);
      expect(router.anchor).not.toHaveBeenCalled();
      expect(state()).toEqual([undefined, undefined, '']);
    });

    it('says the fragment changed (a link in the text, Back): the card opens, the place shows', () => {
      start();
      const scrolls = watchScrolls();
      window.history.replaceState(null, '', '#three-text');
      cards?.show('three-text');
      expect(state()).toEqual(['3', 'right', '2']);
      expect(scrolls).toEqual([{ element: at('three-text'), how: { block: 'nearest' } }]);
      expect(announce).toHaveBeenCalledExactlyOnceWith('Three, section 3 of 4');
      // It is the router's fragment already: nothing is asked of it again.
      expect(router.anchor).not.toHaveBeenCalled();
    });

    it('opens a card by its own title without scrolling anything', () => {
      start();
      const scrolls = watchScrolls();
      window.history.replaceState(null, '', '#two');
      cards?.show('two');
      expect(state()).toEqual(['2', 'right', '2']);
      expect(scrolls).toEqual([]);
    });

    it('scrolls the panel to the place where the page is one column', () => {
      start({ deck: false });
      const scrolls = watchScrolls();
      window.history.replaceState(null, '', '#three');
      cards?.show('three');
      expect(scrolls).toEqual([{ element: at('three'), how: { block: 'start' } }]);
      expect(announce).not.toHaveBeenCalled();
    });

    it('shows the new page’s cards after a navigation', () => {
      start({ hash: '#two' });
      // The router's swap: other content, and a URL with no fragment.
      main().innerHTML = HOME.main;
      window.history.replaceState(null, '', '/');
      cards?.sync({ cut: true });
      expect(state()).toEqual([undefined, undefined, '']);
      // No cards, no deck: the wheel is the map's again.
      expect(roll(120, 0).defaultPrevented).toBe(false);
      main().innerHTML = pristine;
    });
  });

  describe('the engine', () => {
    const stage = { left: 24, top: 76, width: 1232, height: 656 };
    function place(
      element: Element,
      box: { left: number; top: number; width: number; height: number },
    ) {
      Object.defineProperties(element, {
        offsetLeft: { value: box.left, configurable: true },
        offsetTop: { value: box.top, configurable: true },
        offsetWidth: { value: box.width, configurable: true },
        offsetHeight: { value: box.height, configurable: true },
      });
    }
    function layOut(): void {
      place(document.querySelector('.panel') as Element, stage);
      place(cardOf('one'), { left: 0, top: 200, width: 307, height: 160 });
      place(cardOf('two'), { left: 925, top: 0, width: 307, height: 160 });
      place(cardOf('three'), { left: 925, top: 248, width: 307, height: 160 });
      place(cardOf('four'), { left: 925, top: 496, width: 307, height: 160 });
      for (const id of ['one', 'two', 'three', 'four']) {
        place(at(id), { left: 0, top: 0, width: 307, height: 42 });
      }
    }

    it('hears where every card’s leader begins, which card is open, and whose page it is', () => {
      layOut();
      start();
      const setDeck = vi.fn<(deck: Deck | null, options?: { cut?: boolean }) => void>();
      cards?.attach({ setDeck });
      expect(setDeck).toHaveBeenCalledExactlyOnceWith(
        {
          body: 'page/about',
          open: null,
          cards: [
            // The left column's card: from its right edge. The right column's: from their left.
            { key: 'one', side: -1, x: 331, y: 297 },
            { key: 'two', side: 1, x: 949, y: 97 },
            { key: 'three', side: 1, x: 949, y: 345 },
            { key: 'four', side: 1, x: 949, y: 593 },
          ],
        },
        { cut: true },
      );

      click(titleOf('three'));
      expect(setDeck).toHaveBeenCalledTimes(2);
      expect(setDeck.mock.lastCall?.[0]).toMatchObject({ open: 'three' });
      expect(setDeck.mock.lastCall?.[1]).toEqual({ cut: false });
    });

    it('hears nothing twice', () => {
      layOut();
      start();
      const setDeck = vi.fn<(deck: Deck | null, options?: { cut?: boolean }) => void>();
      cards?.attach({ setDeck });
      cards?.sync();
      window.dispatchEvent(new Event('resize'));
      expect(setDeck).toHaveBeenCalledTimes(1);
      // The cards moved (the window was resized): news.
      place(cardOf('four'), { left: 925, top: 480, width: 307, height: 160 });
      window.dispatchEvent(new Event('resize'));
      expect(setDeck).toHaveBeenCalledTimes(2);
    });

    it('hears that there is no deck: another layout, no cards, the content put away', () => {
      const media = start({ hash: '#two' });
      const setDeck = vi.fn<(deck: Deck | null, options?: { cut?: boolean }) => void>();
      cards?.attach({ setDeck });
      expect(setDeck.mock.lastCall?.[0]).toMatchObject({ open: 'two' });
      media.set(false);
      expect(setDeck.mock.lastCall?.[0]).toBeNull();
      // The fragment is still the reading position, whatever the layout.
      expect(state()).toEqual(['2', 'right', '2']);
      media.set(true);
      expect(setDeck.mock.lastCall?.[0]).toMatchObject({ open: 'two' });

      start({ panel: false });
      const closed = vi.fn<(deck: Deck | null, options?: { cut?: boolean }) => void>();
      cards?.attach({ setDeck: closed });
      expect(closed).toHaveBeenCalledExactlyOnceWith(null, { cut: true });
    });

    it('is told a new page’s deck at once (a cut), and a rebuilt engine everything again', () => {
      start();
      const setDeck = vi.fn<(deck: Deck | null, options?: { cut?: boolean }) => void>();
      cards?.attach({ setDeck });
      window.history.replaceState(null, '', '#four');
      cards?.sync({ cut: true });
      expect(setDeck.mock.lastCall).toEqual([
        expect.objectContaining({ open: 'four' }),
        { cut: true },
      ]);
      const next = vi.fn<(deck: Deck | null, options?: { cut?: boolean }) => void>();
      cards?.attach({ setDeck: next });
      expect(next).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ open: 'four' }), {
        cut: true,
      });
      // The engine is gone (plain mode): nobody to tell.
      cards?.attach(null);
      click(titleOf('two'));
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  it('is nothing at all on a page without the panel', () => {
    document.body.innerHTML = '<main id="main"><h1>404</h1></main>';
    pristine = main().innerHTML;
    start();
    expect(cards?.escape()).toBe(false);
    cards?.sync();
    cards?.attach(null);
    expect(state()).toEqual([undefined, undefined, '']);
  });
});
