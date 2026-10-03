import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_CARDS as PAGE_HAS_ROOM_FOR } from '../site/cards';
import { tokens } from '../universe/design/tokens';
import {
  anchorOf,
  deckInset,
  keyStep,
  leftCount,
  matesOf,
  MAX_CARDS,
  sideOf,
  stepOpen,
  WHEEL_REST,
  wheelStep,
  type KeyContext,
  type WheelInput,
  type WheelOutcome,
  type WheelState,
} from './deck';

const css = readFileSync(path.resolve('src/styles/global.css'), 'utf8');

describe('which column a card stands in', () => {
  it('puts the head on the left, and box i of M beside it while 2i <= M', () => {
    // Four boxes are four corners; the left column never holds more than the head and three.
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(leftCount)).toEqual([1, 1, 1, 2, 2, 3, 3, 4, 4]);
    for (let boxes = 1; boxes <= MAX_CARDS + 1; boxes += 1) {
      for (let index = 0; index < boxes; index += 1) {
        const place = index + 1;
        expect(sideOf(index, boxes), `box ${place} of ${boxes}`).toBe(
          place === 1 || 2 * place <= boxes ? -1 : 1,
        );
      }
    }
  });

  it('counts the cards that share a column: each keeps a title row beside an open one', () => {
    // About: the head and three sections on the left, five on the right.
    expect(matesOf(1, 9)).toBe(3);
    expect(matesOf(6, 9)).toBe(4);
    // Contact: the head alone on the left, its one section alone on the right.
    expect(matesOf(1, 2)).toBe(0);
    for (let boxes = 2; boxes <= MAX_CARDS + 1; boxes += 1) {
      const left = matesOf(0, boxes) + 1;
      const right = matesOf(boxes - 1, boxes) + 1;
      expect(left + right).toBe(boxes);
    }
  });

  it('is the column the stylesheet puts it in', () => {
    // The selectors of the left column, as the deck's block lists them.
    const rule =
      /((?:\n {4}html\[data-mode='universe'\] main > \[data-card\]:nth-child\(\d\)[^\n]*)+) \{\n {6}order: 0;/.exec(
        css,
      );
    const selectors = [
      ...(rule?.[1] ?? '').matchAll(/:nth-child\((\d)\)(?::nth-last-child\(n \+ (\d)\))?/g),
    ];
    expect(selectors).toHaveLength(4);
    for (let boxes = 1; boxes <= MAX_CARDS + 1; boxes += 1) {
      for (let place = 1; place <= boxes; place += 1) {
        const left = selectors.some(
          ([, nth, fromEnd]) =>
            Number(nth) === place &&
            (fromEnd === undefined || boxes - place + 1 >= Number(fromEnd)),
        );
        expect(left, `box ${place} of ${boxes}`).toBe(sideOf(place - 1, boxes) < 0);
      }
    }
  });

  it('agrees with the stylesheet on how many sections stand under the head', () => {
    // `--nl` caps the head so that each of them keeps a title row.
    const rules = [
      ...css.matchAll(
        /html\[data-mode='universe'\] \.panel:has\(> main > :nth-child\((\d)\)\) \{\s*--nl: (\d);/g,
      ),
    ];
    expect(rules).toHaveLength(3);
    for (let boxes = 1; boxes <= MAX_CARDS + 1; boxes += 1) {
      const under = rules.reduce(
        (most, [, nth, count]) => (boxes >= Number(nth) ? Math.max(most, Number(count)) : most),
        0,
      );
      expect(under, `${boxes} boxes`).toBe(leftCount(boxes) - 1);
    }
  });

  it('has a place in the stylesheet for every card a page may have, and for no more', () => {
    expect(MAX_CARDS).toBe(PAGE_HAS_ROOM_FOR);
    const open = (card: number): string =>
      `html[data-mode='universe'][data-card-open='${card}'] main > [data-card]:nth-child(${card + 1})`;
    for (let card = 1; card <= MAX_CARDS; card += 1) expect(css).toContain(open(card));
    expect(css).not.toContain(`[data-card-open='${MAX_CARDS + 1}']`);
    expect(css).not.toContain(`[data-card-open='0']`);
  });

  it('keeps the three declarations the layout stands on', () => {
    const block = css.slice(css.indexOf('THE DECK.'));
    // A card taller than its column would wrap into a third one...
    expect(block).toMatch(/flex: 1 1 var\(--chip-h\);\n {6}min-height: var\(--chip-h\);/);
    // ...as would a column that is full to the last fraction of a pixel...
    expect(block).toContain(
      'max-height: calc(100% - var(--nl) * (var(--chip-h) + var(--deck-gap)) - 1px);',
    );
    expect(block).toContain(
      'max-height: calc(100% - var(--deck-mates, 0) * (var(--chip-h) + var(--deck-gap)) - 1px);',
    );
    // ...and nothing may scroll a stub, not even the focus.
    expect(block).toMatch(/LOAD-BEARING: clip, not hidden\.[^\n]*\*\/\n {6}overflow: clip;/);
  });

  it('makes a stub with no room for a line of its text its title alone', () => {
    const block = css.slice(css.indexOf('THE DECK.'));
    // A stub's title row: its height is a switch, between the row's own and the whole card's.
    const rule =
      /\n {4}html\[data-mode='universe'\]:not\(\[data-card-open\]\) main > \[data-card\]:not\(:first-child\) > h2\[id\] \{\n {6}height: clamp\(var\(--title-h\), calc\(\(([\d.]+)rem - 100%\) \* (\d+)\), calc\(100% \+ var\(--space-3\)\)\);\n {4}\}/.exec(
        block,
      );
    expect(rule).not.toBeNull();
    const limit = Number(rule?.[1]) * 16;
    const steep = Number(rule?.[2]);
    // What the declaration reads: a title row (a chip less its two hairlines), and the space
    // under a stub's text, which is the card's bottom padding.
    const chip = Number(/--chip-h: ([\d.]+)rem;/.exec(block)?.[1]) * 16;
    expect(block).toContain('--title-h: calc(var(--chip-h) - 2px);');
    expect(block).toContain('padding: 0 var(--space-4) var(--space-3);');
    const title = chip - 2;
    const under = Number.parseFloat(tokens.space[3]) * 16;
    /** What it comes to for a stub `card` px tall: 100% is what is inside its hairlines and padding. */
    const row = (card: number): number => {
      const inside = card - 2 - under;
      return Math.max(title, Math.min((limit - inside) * steep, inside + under));
    };
    // A stub as short as a chip, FishAI's two at 1280 x 576, and the tallest that a line of
    // text does not fit in: the row is the whole card inside its hairlines, so everything the
    // card holds is under the cut and the title stands in the middle.
    expect([44, 59.5, 71].map(row)).toEqual([42, 57.5, 69]);
    // From 72 px a line shows (About's right column at 1280 x 576 is 76.8): a title row.
    expect([72, 76.8, 120, 176].map(row)).toEqual([42, 42, 42, 42]);
  });
});

describe('stepping from card to card', () => {
  it('stops at the overview and at the last card', () => {
    expect(stepOpen(0, 1, 8)).toBe(1);
    expect(stepOpen(3, 1, 8)).toBe(4);
    expect(stepOpen(8, 1, 8)).toBe(8);
    expect(stepOpen(1, -1, 8)).toBe(0);
    expect(stepOpen(0, -1, 8)).toBe(0);
    // A page with no section card has nowhere to go.
    expect(stepOpen(0, 1, 0)).toBe(0);
  });
});

/** Feed a run of wheel events to the reducer: what each one came to. */
function turn(
  events: Array<Partial<WheelInput> & { dy: number; t: number }>,
  from: WheelState = WHEEL_REST,
): { outcomes: WheelOutcome[]; steps: number[]; state: WheelState } {
  let state = from;
  const outcomes: WheelOutcome[] = [];
  /** When it stepped. */
  const steps: number[] = [];
  for (const event of events) {
    const outcome = wheelStep(state, { canScroll: false, native: false, ...event });
    outcomes.push(outcome);
    if (outcome.step !== 0) steps.push(event.t);
    state = outcome.state;
  }
  return { outcomes, steps, state };
}

describe('the wheel among the cards', () => {
  it('steps on one notch of a mouse wheel, and keeps the event to itself', () => {
    const { outcomes } = turn([{ dy: 100, t: 1000 }]);
    expect(outcomes[0]).toMatchObject({ step: 1, scrollBy: 0, claim: true });
    expect(turn([{ dy: -100, t: 1000 }]).outcomes[0]).toMatchObject({ step: -1, claim: true });
  });

  it('waits for 80 px of a slow turn', () => {
    const { outcomes } = turn([
      { dy: 30, t: 0 },
      { dy: 30, t: 16 },
      { dy: 30, t: 32 },
    ]);
    expect(outcomes.map((outcome) => outcome.step)).toEqual([0, 0, 1]);
    // Its own from the first event: the browser scrolls nothing while it makes up its mind.
    expect(outcomes.every((outcome) => outcome.claim)).toBe(true);
  });

  it('steps once for a flick of a trackpad, however long it glides', () => {
    // A second of inertia: sixty small events, a frame apart.
    const glide = Array.from({ length: 60 }, (_, frame) => ({ dy: 30, t: frame * 16 }));
    const { steps, outcomes } = turn(glide);
    expect(steps).toEqual([32]);
    // The tail never scrolls the card it has just opened.
    expect(outcomes.every((outcome) => outcome.claim && outcome.scrollBy === 0)).toBe(true);
  });

  it('goes on stepping for a wheel kept rolling, 400 ms apart', () => {
    const notches = Array.from({ length: 10 }, (_, notch) => ({ dy: 100, t: notch * 100 }));
    expect(turn(notches).steps).toEqual([0, 400, 800]);
  });

  it('never steps in a gesture that began with something left to scroll', () => {
    const { outcomes } = turn([
      { dy: 100, t: 0, canScroll: true },
      // The card reaches its end under the same turn of the wheel: it stays the card's.
      { dy: 100, t: 100, canScroll: false },
      { dy: 100, t: 200, canScroll: false },
      { dy: 100, t: 300, canScroll: false },
      { dy: 100, t: 400, canScroll: false },
      { dy: 100, t: 500, canScroll: false },
    ]);
    expect(outcomes.every((outcome) => outcome.step === 0 && !outcome.claim)).toBe(true);
  });

  it('scrolls the open card itself when the pointer is somewhere else', () => {
    const away = wheelStep(WHEEL_REST, { dy: 100, t: 0, canScroll: true, native: false });
    expect(away).toMatchObject({ step: 0, scrollBy: 100, claim: false });
    // Over the card the browser scrolls it: once is enough.
    const over = wheelStep(WHEEL_REST, { dy: 100, t: 0, canScroll: true, native: true });
    expect(over).toMatchObject({ step: 0, scrollBy: 0, claim: false });
  });

  it('steps in a new gesture that begins at the end of the card', () => {
    const read = turn([
      { dy: 100, t: 0, canScroll: true },
      { dy: 100, t: 100, canScroll: false },
    ]);
    // A pause, and the wheel again: now it means the next card.
    const { outcomes } = turn([{ dy: 100, t: 100 + 251, canScroll: false }], read.state);
    expect(outcomes[0]).toMatchObject({ step: 1, claim: true });
  });

  it('starts counting again when the wheel turns round', () => {
    const { outcomes } = turn([
      { dy: 60, t: 0 },
      { dy: -60, t: 50 },
      { dy: -30, t: 100 },
    ]);
    expect(outcomes.map((outcome) => outcome.step)).toEqual([0, 0, -1]);
  });

  it('gives the card back a turn that comes back from its end', () => {
    // At the end of a card, a little too far down; then up, where the card can scroll.
    const { outcomes } = turn([
      { dy: 40, t: 0, canScroll: false },
      { dy: -40, t: 50, canScroll: true },
      { dy: -40, t: 100, canScroll: true },
      { dy: -40, t: 150, canScroll: true },
    ]);
    expect(outcomes[0]).toMatchObject({ step: 0, claim: true });
    for (const outcome of outcomes.slice(1)) {
      expect(outcome).toMatchObject({ step: 0, scrollBy: -40, claim: false });
    }
  });

  it('steps there and back with a wheel that turns round after a step', () => {
    const { steps, outcomes } = turn([
      { dy: 100, t: 0 },
      { dy: -100, t: 100 },
      { dy: -100, t: 200 },
      { dy: -100, t: 300 },
      { dy: -100, t: 400 },
    ]);
    expect(steps).toEqual([0, 400]);
    expect(outcomes.at(-1)?.step).toBe(-1);
    // Still the cards' own: the card that opened is not scrolled on the way back.
    expect(outcomes.every((outcome) => outcome.claim)).toBe(true);
  });
});

describe('the keys among the cards', () => {
  const at = (context: Partial<KeyContext>): KeyContext => ({
    open: 0,
    count: 8,
    shift: false,
    repeat: false,
    inMain: false,
    below: 0,
    above: 0,
    page: 400,
    ...context,
  });

  it('opens the first card from the overview, with the keys that scroll down', () => {
    expect(keyStep('PageDown', at({}))).toEqual({ open: 1, scrollBy: 0 });
    expect(keyStep(' ', at({}))).toEqual({ open: 1, scrollBy: 0 });
    expect(keyStep('ArrowDown', at({ inMain: true }))).toEqual({ open: 1, scrollBy: 0 });
  });

  it('leaves the arrows to the ship unless the focus is in the content', () => {
    expect(keyStep('ArrowDown', at({}))).toBeNull();
    expect(keyStep('ArrowUp', at({ open: 3 }))).toBeNull();
    expect(keyStep('ArrowLeft', at({ inMain: true }))).toBeNull();
  });

  it('has nowhere to go up from the overview', () => {
    expect(keyStep('PageUp', at({}))).toBeNull();
    expect(keyStep(' ', at({ shift: true }))).toBeNull();
    expect(keyStep('ArrowUp', at({ inMain: true }))).toBeNull();
    expect(keyStep('Home', at({}))).toBeNull();
  });

  it('scrolls the open card while it has more to show', () => {
    const reading = at({ open: 2, inMain: true, below: 300, above: 120 });
    expect(keyStep('PageDown', reading)).toEqual({ open: 2, scrollBy: 340 });
    expect(keyStep(' ', reading)).toEqual({ open: 2, scrollBy: 340 });
    expect(keyStep('ArrowDown', reading)).toEqual({ open: 2, scrollBy: 40 });
    expect(keyStep('PageUp', reading)).toEqual({ open: 2, scrollBy: -340 });
    expect(keyStep(' ', { ...reading, shift: true })).toEqual({ open: 2, scrollBy: -340 });
    expect(keyStep('ArrowUp', reading)).toEqual({ open: 2, scrollBy: -40 });
  });

  it('steps at the end of the card on a fresh press, and never while the key is held', () => {
    const end = at({ open: 2, below: 0.4, above: 300 });
    expect(keyStep('PageDown', end)).toEqual({ open: 3, scrollBy: 0 });
    // Held down, the key has arrived at the end: it is still the cards' key, and does nothing.
    expect(keyStep('PageDown', { ...end, repeat: true })).toEqual({ open: 2, scrollBy: 0 });
    const top = at({ open: 1, below: 300, above: 0 });
    expect(keyStep('PageUp', top)).toEqual({ open: 0, scrollBy: 0 });
    expect(keyStep('PageUp', { ...top, repeat: true })).toEqual({ open: 1, scrollBy: 0 });
  });

  it('stays on the last card at its end', () => {
    expect(keyStep('PageDown', at({ open: 8 }))).toEqual({ open: 8, scrollBy: 0 });
  });

  it('goes to the overview on Home and to the last card on End', () => {
    expect(keyStep('Home', at({ open: 5 }))).toEqual({ open: 0, scrollBy: 0 });
    expect(keyStep('End', at({ open: 5 }))).toEqual({ open: 8, scrollBy: 0 });
    expect(keyStep('End', at({}))).toEqual({ open: 8, scrollBy: 0 });
    // Already there: the key is nobody's.
    expect(keyStep('End', at({ open: 8 }))).toBeNull();
    // With Shift they select text.
    expect(keyStep('Home', at({ open: 5, shift: true }))).toBeNull();
    expect(keyStep('PageDown', at({ shift: true }))).toBeNull();
  });

  it('leaves every other key alone', () => {
    for (const key of ['Enter', 'Tab', 'a', 'Escape', 'ArrowRight']) {
      expect(keyStep(key, at({ open: 2, inMain: true }))).toBeNull();
    }
  });
});

describe('what the deck leaves free', () => {
  /** The stage at 1280 x 800, About's head and its last card (global.css, the deck). */
  const stage = { offsetLeft: 24, offsetTop: 76, offsetWidth: 1232, offsetHeight: 656 };
  const head = { offsetLeft: 0, offsetTop: 0, offsetWidth: 307, offsetHeight: 98 };
  const last = { offsetLeft: 925, offsetTop: 534, offsetWidth: 307, offsetHeight: 122 };

  it('is everything between the two columns, less a gap on each side', () => {
    expect(deckInset(head, last, stage, { width: 1280 }, 57)).toEqual({
      top: 57,
      right: 355,
      bottom: 0,
      left: 355,
      frameTop: 0,
    });
  });

  it('follows the column that an open card makes wider', () => {
    const wide = { ...last, offsetLeft: 752, offsetWidth: 480 };
    expect(deckInset(head, wide, stage, { width: 1280 }).right).toBe(528);
    expect(deckInset({ ...head, offsetWidth: 480 }, last, stage, { width: 1280 }).left).toBe(528);
  });

  it('leaves the whole right free on a page with no section card', () => {
    expect(deckInset(head, null, stage, { width: 1280 }, 57, 24)).toMatchObject({
      left: 355,
      right: 0,
    });
  });

  it('takes the gap it is given, and never goes negative', () => {
    expect(deckInset(head, last, stage, { width: 1280 }, 0, 32)).toMatchObject({
      left: 363,
      right: 363,
    });
    const away = { ...last, offsetLeft: 4000 };
    expect(deckInset(head, away, stage, { width: 1280 }).right).toBe(0);
  });
});

describe('where a leader begins', () => {
  const stage = { offsetLeft: 24, offsetTop: 76, offsetWidth: 1232, offsetHeight: 656 };

  it('is the middle of the inner edge of the card’s title row', () => {
    // A card of the left column: its right edge faces the body.
    const left = { offsetLeft: 0, offsetTop: 124, offsetWidth: 307, offsetHeight: 160 };
    expect(anchorOf(left, stage, -1, 42)).toEqual({ x: 331, y: 221 });
    // One of the right column: its left edge does.
    const right = { offsetLeft: 925, offsetTop: 134, offsetWidth: 307, offsetHeight: 122 };
    expect(anchorOf(right, stage, 1, 42)).toEqual({ x: 949, y: 231 });
  });

  it('follows the title row of an open card, which is taller', () => {
    const open = { offsetLeft: 752, offsetTop: 161, offsetWidth: 480, offsetHeight: 334 };
    expect(anchorOf(open, stage, 1, 52)).toEqual({ x: 776, y: 263 });
  });
});
