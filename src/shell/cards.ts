// The cards of the page that is showing (src/components/Card.astro), as universe mode handles
// them. A page's fragment says which part of it the visitor is at (`/about/#rockets`): the
// router keeps the fragment (router.ts, `anchor` and `onAnchor`), and this file shows the part.
//
// Where a page is one column that scrolls (the side panel, the phone's sheet) showing a part is
// scrolling to it. On a wide screen the page is a DECK (deck.ts, and "the deck" in
// src/styles/global.css): its cards stand round the body, short, and the fragment names the one
// that is OPEN, in full; no fragment is the overview. So which card is open is in the URL and
// nowhere else. Every change of card is one move: router.anchor(), then sync(), which reads the
// URL again and writes what follows from it on <html>, where the stylesheet does the showing:
//   data-card-open   the open card's place among the page's cards, from 1 (absent: none)
//   data-card-side   "left" | "right": the column it stands in
//   --deck-mates     how many other cards share that column (each keeps a title row)
// Nothing is ever written inside <main>. A change of card the visitor makes is also SEEN: the
// layout changes at once and the cards are carried to their new places (`carry`), by animations,
// which write nothing either. A first load, a navigation and a resize are not carried.
//
// And the place the fragment names is IN SIGHT, whoever put it in the URL: a link (`show`), the
// page's own arrival (`arrive`: a browser does not follow a fragment again on a reload), or the
// deck the window has just grown too small for (`relay`).

import type { Deck, Universe } from '../universe/api';
import { anchorOf, DECK, keyStep, matesOf, sideOf, stepOpen, WHEEL_REST, wheelStep } from './deck';
import { fragmentId, readingTarget } from './navigation';
import type { Router } from './router';

/**
 * The router's `onAnchor` listener where a page is one column: bring the part of the page that
 * `id` names to the top of what scrolls. Nothing moves for an id that names no place in the
 * content (none at all, or <main> itself: navigation.ts, `readingTarget`).
 *
 * The scroll is the scroller's own kind (the panel jumps, as it does for a fragment the browser
 * follows itself), and the focus stays where it is: on the link that was pressed, which for a
 * card's title is inside the part it names.
 */
export function showAnchor(id: string | null, doc: Document = document): void {
  readingTarget(doc, id)?.scrollIntoView({ block: 'start' });
}

export interface CardsOptions {
  /** `busy`: the address bar is ahead of the page (Back is waiting for it), and no card may change. */
  router: Pick<Router, 'anchor' | 'busy'>;
  /** Is the page's content up? (Not on the home page with its welcome text put away.) */
  panelOpen(): boolean;
  /** The body a page is shown from (an id of /universe.json), or null: none, or not known yet. */
  bodyOf(pathname: string): string | null;
  /** Say it to a screen reader (the page's one live region). */
  announce(text: string): void;
  /** The cards have moved: what they leave free of the view must be measured again. */
  refreshInset(): void;
}

export interface Cards {
  /**
   * Show what the URL says, as the window is now. Call it after every navigation (`cut`: the
   * engine hears of the new page's cards at once, with nothing to ease from).
   */
  sync(options?: { cut?: boolean }): void;
  /** The router's `onAnchor`: the page stays, and its fragment now names `id`. */
  show(id: string | null): void;
  /** Escape was pressed: close the open card, if there is one to close. True if it took the key. */
  escape(): boolean;
  /** The engine is up (or, null, gone): tell it the deck from now on. */
  attach(universe: Pick<Universe, 'setDeck'> | null): void;
  dispose(): void;
}

/** Lines and pages of a wheel in CSS px, as the engine's own wheel counts them (ui/StarMap.ts). */
const WHEEL_UNIT_PX = [1, 33, 400];
/**
 * How long the cards take from place to place, and how they ease: the stylesheet's
 * `--motion-base` and `--motion-ease-out` (design/tokens.ts; cards.test.ts holds these to them,
 * and the engine's leaders wait as long: universe/ui/Leaders.ts).
 */
const JOURNEY = { duration: 240, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' };
/** Where a key press is somebody else's: it types, or it presses the thing it is on. */
const FIELD = 'input, textarea, select, [contenteditable]';
const PRESSED = `button, summary, ${FIELD}`;

export function startCards(options: CardsOptions, doc: Document = document): Cards {
  const view = doc.defaultView;
  const main = doc.getElementById('main');
  const panel = doc.querySelector<HTMLElement>('.panel');
  if (view && main && panel) return watchCards(options, doc, view, main, panel);
  // A page with no panel (the 404): nothing to lay out, and a fragment is still a place.
  return {
    sync: () => undefined,
    show: (id) => showAnchor(id, doc),
    escape: () => false,
    attach: () => undefined,
    dispose: () => undefined,
  };
}

function watchCards(
  options: CardsOptions,
  doc: Document,
  view: Window,
  main: HTMLElement,
  panel: HTMLElement,
): Cards {
  const root = doc.documentElement;
  /** The panel's bar: Close is in it, at the right end of the head (`carry`). */
  const bar = panel.querySelector<HTMLElement>(':scope > .panel-bar');
  const media = view.matchMedia(DECK);
  const listeners = new AbortController();
  /**
   * The head moves the whole left column when it grows (the typeface arriving), and the open
   * card its own column: measure again. Those two only, and only when they are other elements
   * than before: watching anew reports anew, which would never end.
   */
  const sizes = new ResizeObserver(() => relay());
  let watched: ReadonlyArray<HTMLElement | undefined> = [];
  let universe: Pick<Universe, 'setDeck'> | null = null;
  /** As sync() last found them: the layout, and the open card's place (0: none). */
  let deck = false;
  let open = 0;
  /** What the engine last heard. */
  let told = '';
  let wheel = WHEEL_REST;
  /** The focus last moved because of a pointer, not a key: a click says what it wants itself. */
  let byPointer = false;
  /** The cards that are on their way from place to place (`carry`). */
  let journeys: Animation[] = [];
  /** The space under what the open card holds, in px (its padding), as sync() last found it. */
  let foot = 0;

  /** The page's cards, the head first. None on the home page. */
  const cardsOf = (): HTMLElement[] =>
    [...main.children].filter((child): child is HTMLElement => child.hasAttribute('data-card'));
  const titleOf = (card: HTMLElement | undefined): HTMLElement | null =>
    card?.querySelector<HTMLElement>(':scope > h2 > a') ?? null;
  const keyOf = (card: HTMLElement | undefined): string | null =>
    card?.querySelector(':scope > h2')?.id || null;

  function sync({ cut = false } = {}): void {
    const cards = cardsOf();
    const target = placeOf();
    // A fragment that names the head, or nothing in the content, is the overview.
    open = target
      ? Math.max(
          0,
          cards.findIndex((card) => card.contains(target)),
        )
      : 0;
    const was = deck;
    deck = media.matches && cards.length > 0 && options.panelOpen();
    if (open > 0) {
      root.dataset.cardOpen = String(open);
      root.dataset.cardSide = sideOf(open, cards.length) < 0 ? 'left' : 'right';
      root.style.setProperty('--deck-mates', String(matesOf(open, cards.length)));
    } else {
      forget();
    }
    // Only while there is a deck, and not passive: a gesture that steps from card to card must
    // keep the browser from scrolling with it as well. (A wheel nobody claims costs a panel that
    // scrolls nothing; one that might be claimed makes every scroll wait to be asked.)
    if (deck && !was) view.addEventListener('wheel', onWheel, { passive: false });
    else if (was && !deck) view.removeEventListener('wheel', onWheel);
    const watch = deck ? [cards[0], open > 0 ? cards[open] : undefined] : [];
    if (watch[0] !== watched[0] || watch[1] !== watched[1]) {
      sizes.disconnect();
      for (const card of watch) if (card) sizes.observe(card);
      watched = watch;
    }
    options.refreshInset();
    tell(cards, cut);
    more(true);
  }

  function forget(): void {
    delete root.dataset.cardOpen;
    delete root.dataset.cardSide;
    delete root.dataset.cardMore;
    root.style.removeProperty('--deck-mates');
  }

  /**
   * The open card holds more under its cut than shows: the stylesheet fades its last lines, as
   * it does a stub's (`data-card-more`), until the last of what the card holds is in sight. The
   * space under that is not more to read: the card's own padding, read when the layout is
   * (`again`) and not at every scroll. A pixel or more counts, as for the wheel and the keys: a
   * card's height is a fraction of a px, and its scroll is whole.
   */
  function more(again = false): void {
    const card = watched[1];
    if (again) foot = card ? Number.parseFloat(view.getComputedStyle(card).paddingBottom) || 0 : 0;
    const below = card ? card.scrollHeight - card.clientHeight - card.scrollTop - foot : 0;
    root.toggleAttribute('data-card-more', below >= 1);
  }

  /** The place the fragment names, or null: none, or none in the content. */
  const placeOf = (): HTMLElement | null => readingTarget(doc, fragmentId(view.location.hash));

  /**
   * In the deck, bring a place INSIDE the open card into sight: the card scrolls to it. Its own
   * title is where the card begins, and needs nothing.
   */
  function reveal(target: HTMLElement | null): void {
    if (open > 0 && target && target !== cardsOf()[open]?.firstElementChild) {
      target.scrollIntoView({ block: 'nearest' });
    }
  }

  /**
   * The page has just arrived at its URL (a load, a reload), and the fragment names a place:
   * be there. A browser follows a fragment by itself the first time, but not on a reload of an
   * entry whose scroll is restored by hand, as every entry of the router's is (router.ts), and
   * it never opened a card. In one column that is a scroll to the place, unless something has
   * scrolled already: then the browser was there first, or the reader has moved on.
   */
  function arrive(): void {
    const target = placeOf();
    if (deck) reveal(target);
    else if (target && main.scrollTop === 0 && view.scrollY === 0) {
      target.scrollIntoView({ block: 'start' });
    }
  }

  /**
   * The window changed (its size, which layout it has, the size of a card): lay the page out
   * again. A deck that has become one column has scrolled nowhere yet: the card that was open
   * is the reader's place in it. (A column that stays a column keeps its place: the reader may
   * have read on from the fragment, which nothing but a link ever changes there.)
   */
  function relay(): void {
    const was = deck;
    sync();
    if (was && !deck) placeOf()?.scrollIntoView({ block: 'start' });
  }

  /** The deck as the engine needs it: where each card's leader begins, and which card is open. */
  function tell(cards: readonly HTMLElement[], cut: boolean): void {
    if (!universe) return;
    const next: Deck | null = deck
      ? {
          body: options.bodyOf(view.location.pathname),
          open: keyOf(cards[open > 0 ? open : -1]),
          cards: cards.slice(1).map((card, index) => {
            const side = sideOf(index + 1, cards.length);
            const row = (card.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0;
            return { key: keyOf(card) ?? '', side, ...anchorOf(card, panel, side, row) };
          }),
        }
      : null;
    const key = JSON.stringify(next);
    if (key === told) return;
    told = key;
    universe.setDeck(next, { cut });
  }

  /**
   * After a change of card the focus moves or the announcer speaks, never both. A keyboard that
   * was in the content carries on from the title of the card that opened; back among all of
   * them, from the title of the card it has just left (`from`), which shows in every state,
   * wears the focus ring, and opens that card again. Anyone else is told where they are: and so
   * is a keyboard that stands on that title already, since nothing moves that would say it.
   */
  function land(within: boolean, from: number): void {
    const cards = cardsOf();
    const title = titleOf(cards[open > 0 ? open : from]);
    if (within && title && title !== doc.activeElement) {
      title.focus({ preventScroll: true });
      return;
    }
    options.announce(
      open > 0
        ? `${(title?.textContent ?? '').trim()}, section ${open} of ${cards.length - 1}`
        : 'All sections',
    );
  }

  /**
   * Make a change of card, and CARRY the cards to where it puts them. The layout changes at
   * once, so that whatever is measured in the same task is final (the free part of the view,
   * where the leaders begin); then every card whose box moved sets out from where it was, its
   * title where its title was, and a card that grew unrolls from the size it had: the one that
   * opens, and the short ones when all of them come back. (Held by its top left corner and cut
   * back at its right and its bottom: in the right column, whose cards keep the window's edge,
   * that slides a card toward the body while it widens, its words going with it.) An animation
   * is no attribute: nothing is written in the page. None for a visitor who asked for less
   * motion, and none unless there was a deck before the change and still is.
   *
   * Close goes with the head. It stands at the right end of the head's first row and is no part
   * of the head: it is in the panel's bar, which the stylesheet makes as wide as the head's
   * column, so it is at its new place at once. Where the head unrolls sideways (its column
   * widens for a card that opens in it), that place is out on the sky until the head's edge
   * reaches it: so the bar sets out as far back as the head is cut, and Close rides the edge.
   * (The head itself never moves: it is the first box of its column.)
   */
  function carry(cards: readonly HTMLElement[], change: () => void): void {
    const moving = deck && root.dataset.motion !== 'reduced';
    // Where each card IS, a journey it may be on included: it sets out again from there.
    const from = moving ? cards.map((card) => card.getBoundingClientRect()) : [];
    change();
    if (!moving || !deck) return;
    for (const journey of journeys) journey.cancel();
    journeys = cards.flatMap((card, index) => {
      const was = from[index];
      if (!was) return [];
      const now = card.getBoundingClientRect();
      const dx = was.left - now.left;
      const dy = was.top - now.top;
      const wider = Math.max(0, now.width - was.width);
      const taller = Math.max(0, now.height - was.height);
      const frames: PropertyIndexedKeyframes = {};
      if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) {
        frames.translate = [`${dx}px ${dy}px`, '0px 0px'];
      }
      if (wider >= 0.5 || taller >= 0.5) {
        frames.clipPath = [`inset(0px ${wider}px ${taller}px 0px)`, 'inset(0px)'];
      }
      const set = frames.translate || frames.clipPath ? [card.animate(frames, JOURNEY)] : [];
      if (index === 0 && wider >= 0.5 && bar) {
        set.push(bar.animate({ translate: [`${-wider}px 0px`, '0px 0px'] }, JOURNEY));
      }
      return set;
    });
    // A journey that is over is let go of: it holds its card and, after a navigation, the whole
    // page that card was in.
    for (const journey of journeys) {
      journey.onfinish = () => {
        journeys = journeys.filter((other) => other !== journey);
      };
    }
  }

  /** Open card `to` (0: none). `stay`: the focus is where it belongs already. */
  function go(to: number, stay = false): void {
    if (to === open || options.router.busy) return;
    const cards = cardsOf();
    const within = main.contains(doc.activeElement);
    // A card opens at its top: the one that closes is put back there while it can still scroll.
    const from = open;
    const closing = from > 0 ? cards[from] : undefined;
    if (closing) closing.scrollTop = 0;
    carry(cards, () => {
      options.router.anchor(keyOf(cards[to > 0 ? to : -1]));
      sync();
    });
    if (!stay) land(within, from);
  }

  const onClick = (event: MouseEvent): void => {
    if (!deck || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const at = event.target instanceof Element ? event.target : null;
    const cards = cardsOf();
    const index = cards.findIndex((card) => card.contains(at));
    if (index < 0) return;
    // A title opens its card, and closes it again: before the router hears of a link at all.
    // The focus stays on the title that was pressed, which shows in every state.
    if (index > 0 && titleOf(cards[index])?.contains(at)) {
      event.preventDefault();
      go(index === open ? 0 : index, true);
      return;
    }
    // Anywhere else in a card that is not open is a press of the card (the head: back to all of
    // them), unless it is a press of something in it, or the end of a selection.
    if (index === open || at?.closest(`a, label, ${PRESSED}`)) return;
    if (view.getSelection()?.isCollapsed === false) return;
    go(index);
  };

  /** The focus never rests on something clipped: a key that lands in a short card opens it. */
  const onFocusIn = (event: FocusEvent): void => {
    if (!deck || byPointer) return;
    const at = event.target instanceof HTMLElement ? event.target : null;
    const cards = cardsOf();
    const index = cards.findIndex((card) => card.contains(at));
    // The open card shows all of itself, a title shows in every state, and so does the head
    // while none is open (its <h1> always).
    if (!at || index < 0 || index === open) return;
    if (index > 0 ? at === titleOf(cards[index]) : at.matches('h1')) return;
    go(index, true);
    at.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    byPointer = false;
    if (!deck || event.defaultPrevented || root.dataset.map !== undefined) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const focus = doc.activeElement;
    const inMain = main.contains(focus);
    if (!inMain && focus !== null && focus !== doc.body) return;
    const at = event.target instanceof Element ? event.target : null;
    if (at?.closest(event.key === ' ' ? PRESSED : FIELD)) return;

    const cards = cardsOf();
    const card = open > 0 ? cards[open] : undefined;
    const outcome = keyStep(event.key, {
      open,
      count: cards.length - 1,
      shift: event.shiftKey,
      repeat: event.repeat,
      inMain,
      below: card ? card.scrollHeight - card.clientHeight - card.scrollTop : 0,
      above: card?.scrollTop ?? 0,
      page: card?.clientHeight ?? 0,
    });
    if (!outcome) return;
    event.preventDefault();
    if (outcome.scrollBy !== 0) {
      const smooth = !event.repeat && root.dataset.motion !== 'reduced';
      card?.scrollBy({ top: outcome.scrollBy, behavior: smooth ? 'smooth' : 'instant' });
    }
    go(outcome.open);
  };

  function onWheel(event: WheelEvent): void {
    // Over the open map the wheel is the map's; with Ctrl it zooms the page; sideways it is nobody's.
    if (root.dataset.map !== undefined || event.ctrlKey || event.metaKey) return;
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    const dy = event.deltaY * (WHEEL_UNIT_PX[event.deltaMode] ?? 1);
    if (dy === 0) return;
    const at = event.target instanceof Node ? event.target : null;
    const cards = cardsOf();
    // What this wheel scrolls: the open card, wherever the pointer is; with none open, a head
    // too tall for its column, if the pointer is on it.
    const scroller = open > 0 ? cards[open] : cards[0]?.contains(at) ? cards[0] : undefined;
    const room = !scroller
      ? 0
      : dy > 0
        ? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
        : scroller.scrollTop;
    const outcome = wheelStep(wheel, {
      dy,
      t: event.timeStamp,
      canScroll: room >= 1,
      native: scroller?.contains(at) ?? false,
    });
    wheel = outcome.state;
    if (outcome.claim) event.preventDefault();
    if (outcome.scrollBy !== 0 && scroller) scroller.scrollTop += outcome.scrollBy;
    if (outcome.step !== 0) go(stepOpen(open, outcome.step, cards.length - 1));
  }

  /** The open card scrolled. (A scroll does not bubble: it is heard on its way down.) */
  const onScroll = (event: Event): void => {
    if (event.target === watched[1]) more();
  };

  const { signal } = listeners;
  main.addEventListener('click', onClick, { signal });
  main.addEventListener('focusin', onFocusIn, { signal });
  main.addEventListener('scroll', onScroll, { signal, capture: true, passive: true });
  doc.addEventListener('keydown', onKeyDown, { signal });
  doc.addEventListener('pointerdown', () => (byPointer = true), { signal, passive: true });
  view.addEventListener('resize', relay, { signal });
  media.addEventListener('change', relay, { signal });
  sync({ cut: true });
  arrive();

  return {
    sync,
    show(id) {
      const was = open;
      carry(cardsOf(), () => sync());
      if (!deck) return showAnchor(id, doc);
      reveal(readingTarget(doc, id));
      if (open !== was) land(main.contains(doc.activeElement), was);
    },
    escape() {
      if (!deck || open === 0) return false;
      go(0);
      return true;
    },
    attach(next) {
      universe = next;
      told = '';
      tell(cardsOf(), true);
    },
    dispose() {
      listeners.abort();
      view.removeEventListener('wheel', onWheel);
      sizes.disconnect();
      for (const journey of journeys) journey.cancel();
      journeys = [];
      universe = null;
      forget();
    },
  };
}
