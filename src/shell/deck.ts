// THE DECK, as pure functions. On a wide screen a page's cards stand in two columns round the body
// its page belongs to (src/styles/global.css, "the deck"): the head and the first sections down
// the left, the rest down the right, and at most one of them open. The stylesheet lays them out;
// this file knows the same arithmetic (which column a card is in, how many share it), what a
// wheel or a key means among cards, and what the cards leave free. No DOM here: the half that
// listens and writes is cards.ts.

import type { PanelBox, PanelInset } from './panel-inset';

/**
 * The same query as the stylesheet's deck: wide, and tall enough for two columns of cards. Change
 * both together (panel-inset.test.ts reads the stylesheet and holds them to each other).
 */
export const DECK = '(min-width: 80rem) and (min-height: 36rem)';

/**
 * How many section cards the stylesheet has a place for: one selector for each card that can be
 * open. src/site/cards.ts refuses a page with more (its own MAX_CARDS; deck.test.ts holds the two
 * and the stylesheet together).
 */
export const MAX_CARDS = 8;

/**
 * How many of a page's `boxes` (the head, then its sections) stand in the left column: the head
 * and at most three sections. Box i of M, counted from 1, is on the left if it is the head or
 * 2i <= M, so four boxes are four corners.
 */
export const leftCount = (boxes: number): number => Math.max(1, Math.floor(boxes / 2));

/** Which column box `index` stands in (0 is the head): -1 the left one, 1 the right one. */
export const sideOf = (index: number, boxes: number): -1 | 1 => (index < leftCount(boxes) ? -1 : 1);

/** How many other boxes share the column of box `index`: each keeps a title row beside an open card. */
export const matesOf = (index: number, boxes: number): number =>
  (sideOf(index, boxes) < 0 ? leftCount(boxes) : boxes - leftCount(boxes)) - 1;

/** The card that is open after going `by` cards on from `open` (0: none, the overview) of `count`. */
export const stepOpen = (open: number, by: number, count: number): number =>
  Math.min(count, Math.max(0, open + by));

/** What the wheel has been doing: `wheelStep` takes one and gives the next. */
export interface WheelState {
  /** When the last event came (ms): one further off than a gesture's gap begins a new gesture. */
  at: number;
  /** How far this gesture has turned towards a step, CSS px, signed. */
  sum: number;
  /** This gesture began with nothing left to scroll that way: it steps from card to card. */
  armed: boolean;
  /** This gesture has stepped already. */
  spent: boolean;
  /** When the last step was (ms). */
  stepAt: number;
}

export interface WheelInput {
  /** How far down the wheel turned, CSS px (up is negative). */
  dy: number;
  /** When (ms). */
  t: number;
  /** What this wheel would scroll (the open card; in the overview a head too tall for its column, under the pointer) can still move that way. */
  canScroll: boolean;
  /** The pointer is over it, so the browser scrolls it by itself. */
  native: boolean;
}

export interface WheelOutcome {
  state: WheelState;
  /** Go on to the next card (1), back to the one before (-1), or stay. */
  step: -1 | 0 | 1;
  /** Scroll what the wheel scrolls by this much: the pointer is elsewhere, so the browser will not. */
  scrollBy: number;
  /** The event is the cards': the browser must not act on it as well. */
  claim: boolean;
}

/** Before any wheel. */
export const WHEEL_REST: WheelState = {
  at: -Infinity,
  sum: 0,
  armed: false,
  spent: false,
  stepAt: -Infinity,
};

/** Events further apart than this are separate gestures. */
const GESTURE_MS = 250;
/** This much of a turn is a step... */
const STEP_PX = 80;
/** ...and no step follows another sooner than this. */
const STEP_MS = 400;
/** An event this large is a notch of a mouse wheel, not the tail of a trackpad's glide. */
const NOTCH_PX = 50;

/**
 * One wheel event among the cards. A gesture that begins with something left to scroll only
 * scrolls, however long it lasts: reading to the end of a card never throws the reader into the
 * next one. A gesture that begins at the end (or in the overview) steps once it has turned
 * STEP_PX, and from then on it is the cards' own (`claim`), so the tail of a glide never scrolls
 * the card it has just opened. One flick of a trackpad is one card, however long it glides; a
 * mouse wheel kept rolling goes on stepping, STEP_MS apart.
 *
 * Turning round before the gesture has stepped is a new start: at the end of a card, a little
 * too far down and then back up scrolls the card up, and does not step to the one before.
 */
export function wheelStep(s: WheelState, e: WheelInput): WheelOutcome {
  let { sum, armed, spent, stepAt } = s;
  const turned = sum !== 0 && Math.sign(e.dy) !== Math.sign(sum);
  if (e.t - s.at > GESTURE_MS) {
    armed = !e.canScroll;
    sum = 0;
    spent = false;
  } else if (turned) {
    sum = 0;
    if (!spent) armed = !e.canScroll;
  }
  if (!armed) {
    return {
      state: { at: e.t, sum: 0, armed, spent, stepAt },
      step: 0,
      scrollBy: e.native ? 0 : e.dy,
      claim: false,
    };
  }
  sum += e.dy;
  let step: -1 | 0 | 1 = 0;
  if (
    Math.abs(sum) >= STEP_PX &&
    e.t - stepAt >= STEP_MS &&
    (!spent || Math.abs(e.dy) >= NOTCH_PX)
  ) {
    step = sum > 0 ? 1 : -1;
    sum = 0;
    spent = true;
    stepAt = e.t;
  }
  return { state: { at: e.t, sum, armed, spent, stepAt }, step, scrollBy: 0, claim: true };
}

export interface KeyContext {
  /** The card that is open (0: none) of `count`. */
  open: number;
  count: number;
  shift: boolean;
  /** The key is being held down: it scrolls on, and never steps. */
  repeat: boolean;
  /** The focus is in the content. (Else it is on nothing: the arrows then fly the ship.) */
  inMain: boolean;
  /** How far the open card can still scroll down and up, and how much of it shows (CSS px). */
  below: number;
  above: number;
  page: number;
}

/** What a key does among the cards: which card is open afterwards, and how far the open one scrolls. */
export interface KeyOutcome {
  open: number;
  scrollBy: number;
}

/** A press of an arrow scrolls this far (CSS px), as a browser's own does. */
const ARROW_PX = 40;
/** Page Down and Space scroll this share of what shows, so that a line or two stays in sight. */
const PAGE_SHARE = 0.85;

/**
 * A key among the cards, or null for a key that is not theirs. The scroll keys scroll the open
 * card, and at its end a fresh press goes on to the next card (in the overview, to the first);
 * Home is the overview and End the last card. The arrows are the cards' only while the focus is
 * in the content: anywhere else they fly the ship.
 */
export function keyStep(key: string, c: KeyContext): KeyOutcome | null {
  if (key === 'Home' || key === 'End') {
    const to = key === 'Home' ? 0 : c.count;
    return c.shift || to === c.open ? null : { open: to, scrollBy: 0 };
  }
  let down: boolean;
  let reach: number;
  if (key === ' ') {
    down = !c.shift;
    reach = c.page * PAGE_SHARE;
  } else if (c.shift) {
    return null;
  } else if (key === 'PageDown' || key === 'PageUp') {
    down = key === 'PageDown';
    reach = c.page * PAGE_SHARE;
  } else if (c.inMain && (key === 'ArrowDown' || key === 'ArrowUp')) {
    down = key === 'ArrowDown';
    reach = ARROW_PX;
  } else {
    return null;
  }
  // Up from the overview is nowhere: the key stays whoever's it was.
  if (c.open === 0 && !down) return null;
  if (c.open > 0 && (down ? c.below : c.above) >= 1) {
    return { open: c.open, scrollBy: down ? reach : -reach };
  }
  return { open: c.repeat ? c.open : stepOpen(c.open, down ? 1 : -1, c.count), scrollBy: 0 };
}

/**
 * What the deck leaves free, for the camera and the names (panel-inset.ts): everything between
 * the two columns, less `gap` on each side. The left column ends where the head does, and the
 * right one begins where the last card does (`last`: null for a page with no section card, whose
 * right is then all free). Boxes are layout boxes inside `panel`, which a move in progress does
 * not change.
 */
export function deckInset(
  head: PanelBox,
  last: PanelBox | null,
  panel: PanelBox,
  viewport: { width: number },
  top = 0,
  gap = 24,
): PanelInset {
  return {
    top,
    right: last ? Math.max(0, viewport.width - panel.offsetLeft - last.offsetLeft + gap) : 0,
    bottom: 0,
    left: Math.max(0, panel.offsetLeft + head.offsetLeft + head.offsetWidth + gap),
    frameTop: 0,
  };
}

/**
 * Where a card's leader begins, in the window: the middle of the inner edge of its title row,
 * the edge towards the body. `row` is how tall that row is.
 */
export function anchorOf(
  card: PanelBox,
  panel: PanelBox,
  side: -1 | 1,
  row: number,
): { x: number; y: number } {
  return {
    x: panel.offsetLeft + card.offsetLeft + (side < 0 ? card.offsetWidth : 0),
    y: panel.offsetTop + card.offsetTop + row / 2,
  };
}
