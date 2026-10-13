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

  it('spreads a column’s stubs over its height, and packs its cards toward the top beside an open one', () => {
    const block = css.slice(css.indexOf('THE DECK.'));
    const rule = (state: string): string | undefined =>
      new RegExp(
        `\\n {4}html\\[data-mode='universe'\\]${state} main:has\\(> \\[data-card\\]\\) \\{([^}]*)\\}`,
      ).exec(block)?.[1];
    // One box for both columns: each column is a line of it, the two lines go to the two sides,
    // and what stands between two cards of a column is the deck's gap at the least.
    const deck = rule('');
    expect(deck).toContain('flex-flow: column wrap;');
    expect(deck).toContain('align-content: space-between;');
    expect(deck).toContain('gap: var(--deck-gap) 0;');
    expect(block).toContain('--deck-gap: var(--space-3);');
    // With none open a column's stubs reach from the top of the stage to its foot...
    expect(deck).toContain('justify-content: space-between;');
    // ...and with one open its cards stand together at the top, in the page's order, the gap and
    // no more between them: the ONE declaration that differs, in a rule that outweighs the
    // deck's own (an attribute more), wherever it is written.
    expect(rule('\\[data-card-open\\]')?.trim()).toBe('justify-content: flex-start;');
    // Packed, a column is as tall as its cards and the gaps between them, and no taller: a chip
    // neither grows nor shrinks, and the open card stops at the column less a chip and a gap for
    // each card the shell says shares it (and the pixel: the declarations above). So the last
    // chip under an open card ends on the stage, however much that card holds.
    const chip =
      /\n {4}html\[data-mode='universe'\]\[data-card-open\] main > \[data-card\] \{([^}]*)\}/.exec(
        block,
      )?.[1];
    expect(chip).toContain('flex: 0 0 var(--chip-h);');
    expect(chip).toContain('max-height: var(--chip-h);');
    const row = Number(/--chip-h: ([\d.]+)rem;/.exec(block)?.[1]) * 16;
    const gap = Number.parseFloat(tokens.space[3]) * 16;
    expect([row, gap]).toEqual([44, 12]);
    // Every shape a page can have and every card of it open, in the smallest deck (a window
    // 36rem tall, less the bar's 4.75rem and the corner chip's 4.25rem) and on a tall monitor.
    for (const column of [432, 1296]) {
      for (let boxes = 2; boxes <= MAX_CARDS + 1; boxes += 1) {
        const sides = Array.from({ length: boxes }, (_, index) => sideOf(index, boxes));
        for (let index = 1; index < boxes; index += 1) {
          const at = `box ${index + 1} of ${boxes} open, a column of ${column} px`;
          // What the stylesheet lets the open card have (`--deck-mates` is `matesOf`: cards.ts)...
          const cap = column - matesOf(index, boxes) * (row + gap) - 1;
          // ...and what stands in its column with it: a title row and a gap for each.
          const beside = sides.filter((side) => side === sides[index]).length - 1;
          expect(cap + beside * (row + gap), at).toBeLessThan(column);
          // It always has its own title row and some lines of its text (207 px at the least).
          expect(cap, at).toBeGreaterThanOrEqual(200);
          // The other column is title rows alone: five of them at the most, 268 px.
          const across = boxes - 1 - beside;
          expect(across * row + (across - 1) * gap, at).toBeLessThan(column);
        }
      }
    }
  });

  it('says of what a chip holds that it is out of sight, and of the open card’s that it is seen', () => {
    const block = css.slice(css.indexOf('THE DECK.'));
    // Under its title row a chip's text and keys are below its cut, and laid out there all the
    // same: packed, under the next chip's title row. A tool that goes by where a box lies (axe,
    // which does not know `overflow: clip`) reads a chip's key and the next title as two things
    // to press in one place, unless the one that cannot be seen says so. Out of sight and
    // nothing more: no declaration here may take it out of the page, the tab order or
    // find-in-page (display, visibility, content-visibility), so this is the only one.
    const held =
      /\n {4}html\[data-mode='universe'\]\[data-card-open\] main > \[data-card\]:not\(:first-child\) > :not\(h2\) \{([^}]*)\}/.exec(
        block,
      )?.[1];
    expect(held?.trim()).toBe('opacity: var(--content-opacity, 0);');
    // The title row is the one thing a chip shows: what the shell opens a card by (cards.ts).
    expect(block).toContain("html[data-mode='universe'] main > [data-card] > h2[id] > a {");
    // The open card alone says that what it holds is to be seen.
    const open =
      /\n {4}html\[data-mode='universe'\]\[data-card-open='8'\] main > \[data-card\]:nth-child\(9\) \{([^}]*)\}/.exec(
        block,
      )?.[1];
    expect(open).toContain('--content-opacity: 1;');
    expect(block.match(/--content-opacity: /g)).toHaveLength(1);
    // The head's chip says the same of what it holds, and that a press goes through it to the chip.
    const head =
      /\n {4}html\[data-mode='universe'\]\[data-card-open\]\n {6}main\n {6}> \[data-card\]:first-child\n {6}:not\(\.page-header, h1\) \{([^}]*)\}/.exec(
        block,
      )?.[1];
    expect(head).toContain('opacity: 0;');
    expect(head).toContain('pointer-events: none;');
  });

  it('lets a stub grow to what it holds, and never by its basis or its padding', () => {
    const block = css.slice(css.indexOf('THE DECK.'));
    // A column wraps by each card's basis, so that stays a title row; what a stub holds is only
    // where its growing stops.
    expect(block).toMatch(
      /flex: 1 1 var\(--chip-h\);\n {6}min-height: var\(--chip-h\);\n {6}max-height: max-content;/,
    );
    // The least a card can be is its padding and its hairlines, whatever its basis says: that
    // has to stay under a title row, or a column of title rows could come out over full.
    const chip = Number(/--chip-h: ([\d.]+)rem;/.exec(block)?.[1]) * 16;
    expect(block).toContain('--stub-foot: var(--space-6);');
    expect(block).toContain('padding: 0 var(--space-4) var(--stub-foot);');
    expect(Number.parseFloat(tokens.space[6]) * 16 + 2).toBeLessThanOrEqual(chip);
    // What a stub holds is measured with its title row as tall as the row's own content (the
    // switch below is a percentage, which counts for nothing there): the words' line and the
    // row's hairline, which together are the row's height. A pixel more would be a pixel of
    // plate under every stub that shows all it holds.
    expect(block).toContain('border-bottom: 1px solid var(--title-rule, transparent);');
    expect(block).toContain('line-height: calc(var(--title-h) - 1px);');
    // Where the engine does not size a box by what it holds in this axis, the cap is a length.
    expect(block).toMatch(
      /@supports \(-moz-appearance: none\) \{\n {6}html\[data-mode='universe'\] main > \[data-card\] \{\n {8}max-height: var\(--stub-max\);\n {6}\}\n {4}\}/,
    );
    expect(block).toContain('--stub-max: clamp(7.5rem, 20vh, 11rem);');
  });

  it('fades whatever a stub cuts off, a planet’s dot included', () => {
    const block = css.slice(css.indexOf('THE DECK.'));
    const fade =
      /\n {4}html\[data-mode='universe'\]:not\(\[data-card-open\]\) main > \[data-card\]:not\(:first-child\)::after \{([^}]*)\}/.exec(
        block,
      )?.[1];
    expect(fade).toContain('background: linear-gradient(transparent, var(--ground) 85%);');
    expect(fade).toContain('pointer-events: none;');
    // Never taller than the space under a stub's text: a stub that shows all it holds has the
    // fade over that space, and over none of its words.
    expect(fade).toContain('height: clamp(0.75rem, 25%, var(--stub-foot));');
    // What a card holds that stands a layer above its text: the fade is not under any of it.
    const layer = (rule: string | undefined): number =>
      Number(/\n\s+z-index: (-?\d+);/.exec(rule ?? '')?.[1] ?? NaN);
    const raised = ['.planet-dot', '.sun-dot'].map((name) =>
      layer(new RegExp(`\\n\\${name} \\{([^}]*)\\}`).exec(css)?.[1]),
    );
    expect(raised).toEqual([1, 1]);
    expect(layer(fade)).toBe(Math.max(...raised));
  });

  it('fades the last lines of an open card that has more under its cut, and takes no room', () => {
    const block = css.slice(css.indexOf('THE DECK.'));
    // The shell says when (cards.ts); the open card alone has the box to show it with.
    const fade =
      /\n {4}html\[data-mode='universe'\]\[data-card-more\] main > \[data-card\]::after \{([^}]*)\}/.exec(
        block,
      )?.[1];
    expect(fade).toContain('content: var(--more, none);');
    const open =
      /\n {4}html\[data-mode='universe'\]\[data-card-open='8'\] main > \[data-card\]:nth-child\(9\) \{([^}]*)\}/.exec(
        block,
      )?.[1];
    expect(open).toContain("--more: '';");
    expect(block.match(/--more: '';/g)).toHaveLength(1);
    // The same fade as a stub's, at the foot of the plate, however far the card has scrolled. A
    // box sticks inside its card's padding: left at `bottom: 0` it would stand over that space,
    // and whatever scrolls through the space would show under the fade. So it is told to stand
    // the card's own padding below, and reaches as far to the sides.
    expect(fade).toContain('position: sticky;');
    expect(open).toContain('--open-foot: var(--space-4);');
    expect(open).toContain('padding-bottom: var(--open-foot);');
    expect(fade).toContain('inset: auto auto calc(-1 * var(--open-foot));');
    expect(block).toContain('padding: 0 var(--space-4) var(--stub-foot);');
    expect(fade).toContain('background: linear-gradient(transparent, var(--ground) 85%);');
    expect(fade).toContain('pointer-events: none;');
    // It gives back the room it takes: a card measures the same with it and without, so that
    // its coming and going moves nothing, and changes nothing the shell has measured.
    expect(fade).toContain('display: block;');
    expect(fade).toContain('height: var(--more-h);');
    expect(fade).toContain('margin: calc(-1 * var(--more-h)) calc(-1 * var(--space-4)) 0;');
    // Taller than a stub's: a line of the open card's text and the space between two
    // paragraphs, so that a cut which falls in that space still has words to fade.
    expect(open).toContain('--more-h: var(--space-12);');
    expect(open).toContain('--text-base: var(--text-narrow-base);');
    expect(css).toMatch(/\nbody \{[^}]*\n {2}line-height: 1\.65;/);
    const line = 1.65 * Number.parseFloat(tokens.textNarrow.base) * 16;
    const gap = Number.parseFloat(tokens.space[4]) * 16;
    expect(Number.parseFloat(tokens.space[12]) * 16).toBeGreaterThanOrEqual(line + gap);
    // It comes and goes at once: an animation that never ends would be a card for ever on the
    // move, to anyone who waits for the cards to rest.
    expect(fade).not.toMatch(/animation|transition/);
    // What the keyboard scrolls to stops over it, as it stops under the title.
    expect(open).toContain('scroll-padding-top: var(--title-h);');
    expect(open).toContain('scroll-padding-bottom: var(--more-h);');
    // Forced colours paint no gradient: there the scrollbar says it alone.
    expect(block).toMatch(
      /@media \(forced-colors: active\) \{\n {6}html\[data-mode='universe'\]:not\(\[data-card-open\]\) main > \[data-card\]:not\(:first-child\)::after,\n {6}html\[data-mode='universe'\]\[data-card-more\] main > \[data-card\]::after \{\n {8}content: none;\n {6}\}/,
    );
  });

  it('keeps the keys an open card ends with in sight: they stick to the foot of what shows', () => {
    const block = css.slice(css.indexOf('THE DECK.'));
    const open =
      /\n {4}html\[data-mode='universe'\]\[data-card-open='8'\] main > \[data-card\]:nth-child\(9\) \{([^}]*)\}/.exec(
        block,
      )?.[1];
    // The open card alone says that its keys stick: a chip's are a title row out of sight.
    expect(open).toContain('--keys-position: sticky;');
    expect(block.match(/--keys-position: sticky;/g)).toHaveLength(1);
    const keys =
      /\n {4}html\[data-mode='universe'\]\[data-card-open\] main > \[data-card\] > \.actions:last-child \{([^}]*)\}/.exec(
        block,
      )?.[1];
    expect(keys).toContain('position: var(--keys-position, static);');
    expect(keys).toContain('bottom: 0;');
    // Nothing of the row is in the flow that was not: no margin, no padding of its own. (A
    // negative margin under the last box of a card would meet the fade's, and the card would
    // measure 16 px more with the fade than without: the shell's word would never settle.)
    expect(keys).not.toMatch(/margin|padding/);
    // Over the fade at the card's foot, and over a planet's dot.
    const layer = (rule: string | undefined): number =>
      Number(/\n\s+z-index: (-?\d+);/.exec(rule ?? '')?.[1] ?? NaN);
    const fade =
      /\n {4}html\[data-mode='universe'\]\[data-card-more\] main > \[data-card\]::after \{([^}]*)\}/.exec(
        block,
      )?.[1];
    expect(layer(keys)).toBeGreaterThan(layer(fade));
    // While there is more, a plate behind the keys: placed (so it takes no room), from a fade's
    // height over the row to the foot of the plate and as wide, inside the card's padding box.
    const plate =
      /\n {4}html\[data-mode='universe'\]\[data-card-more\] main > \[data-card\] > \.actions:last-child::before \{([^}]*)\}/.exec(
        block,
      )?.[1];
    expect(plate).toContain('content: var(--more, none);');
    expect(plate).toContain('position: absolute;');
    expect(layer(plate)).toBe(-1);
    expect(plate).toContain(
      'inset: calc(-1 * var(--stub-foot)) calc(-1 * var(--space-4)) calc(-1 * var(--open-foot));',
    );
    expect(plate).toContain(
      'background: linear-gradient(transparent, var(--ground) calc(0.85 * var(--stub-foot)));',
    );
    expect(plate).toContain('pointer-events: none;');
    // What the keyboard scrolls to in such a card stops over the keys and their plate.
    expect(block).toMatch(
      /\n {4}html\[data-mode='universe'\]\[data-card-open\] main > \[data-card\]:has\(> \.actions:last-child\) \{\n {6}scroll-padding-bottom: calc\(var\(--stub-keys\) \+ var\(--stub-foot\) \+ var\(--space-4\)\);\n {4}\}/,
    );
    // Forced colours: the system's ground, a step over the keys, and no gradient.
    expect(block).toMatch(
      /\n {6}html\[data-mode='universe'\]\[data-card-more\] main > \[data-card\] > \.actions:last-child::before \{\n {8}top: calc\(-1 \* var\(--space-2\)\);\n {8}background: Canvas;\n {6}\}/,
    );
  });

  it('makes a stub with no room for a line of its text its title alone', () => {
    const block = css.slice(css.indexOf('THE DECK.'));
    // A stub's title row: its height is a switch, between the row's own and the whole card's.
    const rule =
      /\n {4}html\[data-mode='universe'\]:not\(\[data-card-open\]\) main > \[data-card\]:not\(:first-child\) > h2\[id\] \{\n {6}height: clamp\(var\(--title-h\), calc\(\(([\d.]+)rem - 100%\) \* (\d+)\), calc\(100% \+ var\(--stub-foot\)\)\);\n {4}\}/.exec(
        block,
      );
    expect(rule).not.toBeNull();
    const limit = Number(rule?.[1]) * 16;
    const steep = Number(rule?.[2]);
    // What the declaration reads: a title row (a chip less its two hairlines), and the space
    // under a stub's text, which is the card's bottom padding.
    const chip = Number(/--chip-h: ([\d.]+)rem;/.exec(block)?.[1]) * 16;
    expect(block).toContain('--title-h: calc(var(--chip-h) - 2px);');
    expect(block).toContain('--stub-foot: var(--space-6);');
    expect(block).toContain('padding: 0 var(--space-4) var(--stub-foot);');
    const title = chip - 2;
    const under = Number.parseFloat(tokens.space[6]) * 16;
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
    // And nothing between: one step of the layout (a 64th of a px) under 72, and the row is
    // already the whole card. No stub is caught with half a line.
    expect(row(72 - 1 / 64)).toBe(70 - 1 / 64);
  });

  it('keeps the keys a stub ends with at its foot, where it has room for a line over them', () => {
    const block = css.slice(css.indexOf('THE DECK.'));
    const px = (value: string): number => Number.parseFloat(value) * 16;
    // A row of keys in a stub: a line of its text, and a key's padding above and below it.
    expect(block).toContain('--stub-keys: calc(1.5 * var(--text-narrow-sm) + 2 * var(--space-3));');
    expect(css).toMatch(
      /\n\.button \{[^}]*\n {2}padding: var\(--space-3\) 1\.25rem;[^}]*\n {2}line-height: 1\.5;/,
    );
    const keys = 1.5 * px(tokens.textNarrow.sm) + 2 * px(tokens.space[3]);
    // The room they take is a margin under what stands before them (the stub's own padding is
    // the least it can be: see above), and the fade is then that room and the space under a
    // stub's text.
    expect(block).toContain('--keys-room: calc(var(--stub-keys) + var(--space-3));');
    expect(block).toContain('--keys-foot: calc(var(--stub-foot) + var(--keys-room));');
    expect(block).toMatch(
      /> :has\(\+ \.actions:last-child\) \{\n {6}margin-bottom: var\(--keys-room\);/,
    );
    const room = keys + px(tokens.space[3]);
    const foot = px(tokens.space[6]) + room;
    // The switch: 100% is the stub inside its hairlines (what an absolute box is placed in).
    const swap = /--keys-in: calc\(\(100% - ([\d.]+)rem - var\(--keys-foot\)\) \* (\d+)\);/.exec(
      block,
    );
    expect(swap).not.toBeNull();
    const limit = Number(swap?.[1]) * 16;
    const steep = Number(swap?.[2]);
    // The same limit and the same steepness as the title's own switch, a row of keys further on.
    const title =
      /calc\(\(([\d.]+)rem - 100%\) \* (\d+)\), calc\(100% \+ var\(--stub-foot\)\)/.exec(block);
    expect([limit, steep]).toEqual([Number(title?.[1]) * 16, Number(title?.[2])]);
    expect(block).toContain('bottom: min(var(--space-3), calc(var(--keys-in) + var(--space-3)));');
    expect(block).toMatch(
      /height: clamp\(\n {8}clamp\(0\.75rem, 25%, var\(--stub-foot\)\),\n {8}calc\(var\(--keys-in\) \+ var\(--keys-foot\)\),\n {8}var\(--keys-foot\)\n {6}\);/,
    );
    const isIn = (card: number): number => (card - 2 - limit - foot) * steep;
    /** How far above the stub's foot the keys stand, in a stub `card` px tall. */
    const bottom = (card: number): number => Math.min(12, isIn(card) + 12);
    /** How tall the fade is. */
    const fade = (card: number): number => {
      const plain = Math.max(12, Math.min(0.25 * (card - 2), px(tokens.space[6])));
      return Math.max(plain, Math.min(isIn(card) + foot, foot));
    };
    // The shortest stub with the room, and the resume's first card at 1280 x 576 and 1280 x 800:
    // the keys a step above the foot, on a plate as tall as the fade and all that is under it.
    const least = 2 + limit + foot;
    expect(least).toBe(130.5);
    expect([least, 155.125, 267.125].map(bottom)).toEqual([12, 12, 12]);
    expect([least, 155.125, 267.125].map(fade)).toEqual([foot, foot, foot]);
    // One step of the layout shorter, and they are far under the cut (a row of keys is 46.5 px),
    // with the fade any stub has: a stub of 72 px to 130 shows its title and a line of its text,
    // as the others do.
    expect(bottom(least - 1 / 64)).toBeLessThan(-10 * keys);
    expect([72, 100, least - 1 / 64].map(fade)).toEqual([17.5, 24, 24]);
    // Forced colours paint no fade: there the keys stand on a plate of the system's ground, a
    // step taller than their room (what it cuts off does not touch them), and under the text of
    // a stub that shows all it holds, which ends the whole foot above the stub's edge.
    expect(block).toMatch(
      /@media \(forced-colors: active\) \{[^@]*:has\(> \.actions:last-child\)::after \{\n {8}--keys-plate: calc\(var\(--keys-room\) \+ var\(--space-2\)\);\n\n {8}content: '';\n {8}height: clamp\(0px, calc\(var\(--keys-in\) \+ var\(--keys-plate\)\), var\(--keys-plate\)\);\n {8}background: Canvas;/,
    );
    expect(room + px(tokens.space[2])).toBeLessThan(foot);
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
