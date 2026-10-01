import { describe, expect, it } from 'vitest';
import {
  createLabelBoxes,
  createTakenBoxes,
  declutter,
  glidePast,
  NOWHERE,
  verticalClearance,
  type DeclutterRules,
  type LabelBoxes,
} from './declutter';
import { createRng } from './rng';

const PARAMS = { gapPx: 4, keepPx: 6, max: 12 };
/** The labels more important than 5 are placed together; none is firm. */
const TOGETHER_5 = { firm: -Infinity, together: 5, keepSlots: false };

type Row = readonly [left: number, top: number, width: number, height: number, priority: number];

function boxesOf(rows: readonly Row[], capacity = rows.length): LabelBoxes {
  const boxes = createLabelBoxes(capacity);
  return load(boxes, rows);
}

function load(boxes: LabelBoxes, rows: readonly Row[]): LabelBoxes {
  boxes.count = rows.length;
  rows.forEach(([left, top, width, height, priority], i) => {
    boxes.left[i] = left;
    boxes.top[i] = top;
    boxes.width[i] = width;
    boxes.height[i] = height;
    boxes.priority[i] = priority;
  });
  return boxes;
}

const shown = (boxes: LabelBoxes): number[] => [...boxes.shown.subarray(0, boxes.count)];

describe('declutter', () => {
  it('shows everything when nothing touches', () => {
    const boxes = boxesOf([
      [0, 0, 80, 40, 2],
      [200, 0, 80, 40, 1],
      [0, 100, 80, 40, 3],
    ]);
    declutter(boxes, PARAMS);
    expect(shown(boxes)).toEqual([1, 1, 1]);
  });

  it('of two that overlap, shows the more important one, whatever order they come in', () => {
    const a = boxesOf([
      [0, 0, 80, 40, 2],
      [60, 10, 80, 40, 1],
    ]);
    declutter(a, PARAMS);
    expect(shown(a)).toEqual([0, 1]);

    const b = boxesOf([
      [60, 10, 80, 40, 1],
      [0, 0, 80, 40, 2],
    ]);
    declutter(b, PARAMS);
    expect(shown(b)).toEqual([1, 0]);
  });

  it('lets a lesser label show when the one that hid it is hidden itself', () => {
    // B hides behind A; C only touches B, so C shows.
    const boxes = boxesOf([
      [0, 0, 80, 40, 1],
      [70, 0, 80, 40, 2],
      [140, 0, 80, 40, 3],
    ]);
    declutter(boxes, PARAMS);
    expect(shown(boxes)).toEqual([1, 0, 1]);
  });

  it('keeps labels a gap apart, not merely off each other', () => {
    const near = boxesOf([
      [0, 0, 80, 40, 1],
      [83, 0, 80, 40, 2],
    ]);
    declutter(near, PARAMS);
    expect(shown(near)).toEqual([1, 0]);

    const clear = boxesOf([
      [0, 0, 80, 40, 1],
      [85, 0, 80, 40, 2],
    ]);
    declutter(clear, PARAMS);
    expect(shown(clear)).toEqual([1, 1]);
  });

  it('does not flicker: what shows stays until it is really in the way, what hides waits for real room', () => {
    const boxes = boxesOf([
      [0, 0, 80, 40, 1],
      [90, 0, 80, 40, 2],
    ]);
    declutter(boxes, PARAMS);
    expect(shown(boxes)).toEqual([1, 1]);

    // Drifting closer: inside the gap, but it showed already, so it may stay...
    boxes.left[1] = 80;
    declutter(boxes, PARAMS);
    expect(shown(boxes)).toEqual([1, 1]);
    // ...until it overlaps by more than the slack.
    boxes.left[1] = 77;
    declutter(boxes, PARAMS);
    expect(shown(boxes)).toEqual([1, 0]);
    // Drifting apart again: not back at 80, where it could stay before, only with a real gap.
    boxes.left[1] = 80;
    declutter(boxes, PARAMS);
    expect(shown(boxes)).toEqual([1, 0]);
    boxes.left[1] = 85;
    declutter(boxes, PARAMS);
    expect(shown(boxes)).toEqual([1, 1]);
  });

  it('never shows a label that is no candidate, and lets others have its place', () => {
    const boxes = boxesOf([
      [0, 0, 80, 40, Infinity],
      [10, 0, 80, 40, 5],
      [300, 0, 80, 40, Number.NaN],
    ]);
    boxes.shown[0] = 1;
    declutter(boxes, PARAMS);
    expect(shown(boxes)).toEqual([0, 1, 0]);
  });

  it('never shows more than it may, and then the most important ones', () => {
    const rows: Row[] = [];
    for (let i = 0; i < 20; i += 1) rows.push([i * 100, 0, 80, 40, 20 - i]);
    const boxes = boxesOf(rows);
    declutter(boxes, { ...PARAMS, max: 5 });
    expect(shown(boxes).reduce((sum, flag) => sum + flag, 0)).toBe(5);
    expect(shown(boxes).slice(15)).toEqual([1, 1, 1, 1, 1]);
  });

  it('follows priorities that change from frame to frame', () => {
    const boxes = boxesOf([
      [0, 0, 80, 40, 1],
      [40, 0, 80, 40, 2],
    ]);
    declutter(boxes, PARAMS);
    expect(shown(boxes)).toEqual([1, 0]);
    // The other one becomes where the ship is going: it wins, slack or no slack.
    boxes.priority[1] = 0;
    declutter(boxes, PARAMS);
    expect(shown(boxes)).toEqual([0, 1]);
  });

  it('gives way to what was there first, however important the label', () => {
    const taken = createTakenBoxes(2);
    taken.count = 1;
    Object.assign(taken.boxes[0] ?? {}, { left: 100, top: 300, width: 200, height: 44 });
    const boxes = boxesOf([
      [150, 280, 80, 40, 0], // where the ship is going, right on the prompt
      [150, 200, 80, 40, 2],
      [305, 300, 80, 40, 3], // beside it, a gap away
      [302, 300, 80, 40, 3], // beside it, too close
    ]);
    declutter(boxes, PARAMS, taken);
    expect(shown(boxes)).toEqual([0, 1, 1, 0]);

    // The prompt goes away: the room is free again.
    taken.count = 0;
    declutter(boxes, PARAMS, taken);
    expect(shown(boxes)).toEqual([1, 1, 1, 0]);
  });

  it('is as patient with a label beside something taken as beside another label', () => {
    const taken = createTakenBoxes(1);
    taken.count = 1;
    Object.assign(taken.boxes[0] ?? {}, { left: 100, top: 0, width: 100, height: 44 });
    const boxes = boxesOf([[10, 0, 80, 40, 1]]);
    declutter(boxes, PARAMS, taken);
    expect(shown(boxes)).toEqual([1]);
    boxes.left[0] = 21; // closer than the gap, touching even: it showed already, so it may stay...
    declutter(boxes, PARAMS, taken);
    expect(shown(boxes)).toEqual([1]);
    boxes.left[0] = 23; // ...until it is really in the way
    declutter(boxes, PARAMS, taken);
    expect(shown(boxes)).toEqual([0]);
    boxes.left[0] = 18; // and it comes back only with a real gap
    declutter(boxes, PARAMS, taken);
    expect(shown(boxes)).toEqual([0]);
    boxes.left[0] = 16;
    declutter(boxes, PARAMS, taken);
    expect(shown(boxes)).toEqual([1]);
  });

  it('in a crowd, shows labels that never touch, and always the most important of all', () => {
    const rng = createRng('labels');
    const boxes = createLabelBoxes(50);
    for (let frame = 0; frame < 50; frame += 1) {
      const rows: Row[] = [];
      for (let i = 0; i < 50; i += 1) {
        rows.push([rng() * 900, rng() * 600, 40 + rng() * 80, 40, i === 7 ? 0 : 1 + rng() * 3]);
      }
      load(boxes, rows);
      boxes.shown.fill(0);
      declutter(boxes, { ...PARAMS, max: 50 });
      expect(boxes.shown[7]).toBe(1);
      const on = rows.map((row, i) => ({ row, i })).filter(({ i }) => boxes.shown[i]);
      expect(on.length).toBeGreaterThan(5);
      for (const a of on) {
        for (const b of on) {
          if (a.i >= b.i) continue;
          const apart =
            a.row[0] + a.row[2] + PARAMS.gapPx <= b.row[0] ||
            b.row[0] + b.row[2] + PARAMS.gapPx <= a.row[0] ||
            a.row[1] + a.row[3] + PARAMS.gapPx <= b.row[1] ||
            b.row[1] + b.row[3] + PARAMS.gapPx <= a.row[1];
          expect(apart, `frame ${frame}: ${a.i} and ${b.i}`).toBe(true);
        }
      }
    }
  });
});

/**
 * A label with places: its size, its priority, and the corner of each of its places (null: that
 * place is not offered this time).
 */
type Placed = readonly [
  width: number,
  height: number,
  priority: number,
  places: readonly (readonly [left: number, top: number] | null)[],
];

function placesOf(rows: readonly Placed[], places: number): LabelBoxes {
  const boxes = createLabelBoxes(rows.length, places);
  return reload(boxes, rows);
}

function reload(boxes: LabelBoxes, rows: readonly Placed[]): LabelBoxes {
  boxes.count = rows.length;
  boxes.left.fill(Number.NaN);
  boxes.top.fill(Number.NaN);
  rows.forEach(([width, height, priority, corners], row) => {
    boxes.width[row] = width;
    boxes.height[row] = height;
    boxes.priority[row] = priority;
    corners.forEach((corner, place) => {
      if (!corner) return;
      boxes.left[row * boxes.places + place] = corner[0];
      boxes.top[row * boxes.places + place] = corner[1];
    });
  });
  return boxes;
}

/** Where each label shows (the index of its place), or null where it does not. */
const where = (boxes: LabelBoxes): (number | null)[] =>
  Array.from(boxes.shown.subarray(0, boxes.count), (on, row) =>
    on ? (boxes.at[row] ?? null) : null,
  );

describe('declutter, with places', () => {
  it('with one place each, is declutter as it always was', () => {
    const rows: Row[] = [
      [0, 0, 80, 40, 2],
      [60, 10, 80, 40, 1],
      [300, 0, 80, 40, 3],
    ];
    const one = boxesOf(rows);
    const alike = placesOf(
      rows.map(([left, top, width, height, priority]) => [width, height, priority, [[left, top]]]),
      1,
    );
    for (let frame = 0; frame < 3; frame += 1) {
      declutter(one, PARAMS);
      declutter(alike, PARAMS);
      expect(where(alike)).toEqual(shown(one).map((on) => (on ? 0 : null)));
    }
  });

  it('takes the first of its places with room, in the order they are offered', () => {
    // A is in the way of B's first place: B takes its second. C's first has room: it takes that.
    const boxes = placesOf(
      [
        [80, 40, 1, [[0, 0]]],
        [
          80,
          40,
          2,
          [
            [40, 10],
            [0, 100],
            [200, 0],
          ],
        ],
        [
          80,
          40,
          3,
          [
            [200, 100],
            [40, 0],
          ],
        ],
      ],
      3,
    );
    declutter(boxes, PARAMS);
    expect(where(boxes)).toEqual([0, 1, 0]);
  });

  it('goes back to its first place once that has room to spare, and not before', () => {
    // B showed at its second place, below, because A was on its first. A drifts off to the left:
    // B stays where it is until its first place is a gap AND a keep clear of A.
    const at = (aLeft: number) =>
      [
        [80, 40, 1, [[aLeft, 0]]],
        [
          80,
          40,
          2,
          [
            [100, 0],
            [100, 100],
          ],
        ],
      ] as const satisfies readonly Placed[];
    const boxes = placesOf(at(60), 2);
    declutter(boxes, PARAMS);
    expect(where(boxes)).toEqual([0, 1]);
    // A gap clear, but not a keep more: it stays below.
    reload(boxes, at(100 - 80 - PARAMS.gapPx - 1));
    declutter(boxes, PARAMS);
    expect(where(boxes)).toEqual([0, 1]);
    reload(boxes, at(100 - 80 - PARAMS.gapPx - PARAMS.keepPx - 1));
    declutter(boxes, PARAMS);
    expect(where(boxes)).toEqual([0, 0]);
  });

  it('stays where it showed while it may, as a label with one place does, and then moves on', () => {
    // B shows at its second place (A is on its first). D, more important, comes within a gap of
    // it there, but not a keep closer: B stays, though its third place has room. Closer still, it
    // moves there, and does not hide.
    const rows = (dTop: number): Placed[] => [
      [
        80,
        40,
        2,
        [
          [0, 0],
          [0, 100],
          [300, 300],
        ],
      ],
      [80, 40, 1, [[0, 0]]],
      [80, 40, 1.5, [[0, dTop]]],
    ];
    const boxes = placesOf(rows(400), 3);
    declutter(boxes, PARAMS);
    expect(where(boxes)).toEqual([1, 0, 0]);
    reload(boxes, rows(100 + 40 + PARAMS.gapPx - 1));
    declutter(boxes, PARAMS);
    expect(where(boxes)).toEqual([1, 0, 0]);
    reload(boxes, rows(100 + 40 + PARAMS.gapPx - PARAMS.keepPx - 1));
    declutter(boxes, PARAMS);
    expect(where(boxes)).toEqual([2, 0, 0]);
  });

  it('moves ONE label already placed to another of its places, to make room for one more', () => {
    // A takes its first place, which is B's only one; A has another with room: A moves, both show.
    const boxes = placesOf(
      [
        [
          80,
          40,
          1,
          [
            [0, 0],
            [0, 100],
          ],
        ],
        [80, 40, 2, [[20, 10]]],
      ],
      2,
    );
    declutter(boxes, PARAMS);
    expect(where(boxes)).toEqual([1, 0]);
  });

  it('never hides a label to make room, and never moves two', () => {
    // C's only place is under A and B at once: moving one of them is not enough, and C does not
    // show. Nothing that showed is gone for it.
    const boxes = placesOf(
      [
        [
          80,
          40,
          1,
          [
            [0, 0],
            [0, 200],
          ],
        ],
        [80, 40, 2, [[90, 0]]],
        [150, 40, 3, [[20, 10]]],
      ],
      2,
    );
    declutter(boxes, PARAMS);
    expect(where(boxes)).toEqual([0, 0, null]);
  });

  it('moves a label to make room only where it takes none from a label that shows', () => {
    // B's only place is under A. A's other place is clear of everything placed before B, but C,
    // placed after it, shows there: A stays, B waits, and C keeps its place.
    const boxes = placesOf(
      [
        [
          80,
          40,
          1,
          [
            [0, 0],
            [0, 200],
          ],
        ],
        [80, 40, 2, [[20, 10]]],
        [80, 40, 3, [[20, 210]]],
      ],
      2,
    );
    shows(boxes, [0, null, 0]);
    declutter(boxes, PARAMS);
    expect(where(boxes)).toEqual([0, null, 0]);
  });

  it('places the most important labels together, every way tried, before one is left out', () => {
    // Three systems' names. Greedy, A and B take their first places and C's only place is under
    // both: moving one of them is not enough. Placed together (all three more important than
    // `together`), A and B both move, and all three show.
    const rows: Placed[] = [
      [
        80,
        40,
        1,
        [
          [0, 0],
          [0, 200],
        ],
      ],
      [
        80,
        40,
        2,
        [
          [90, 0],
          [90, 200],
        ],
      ],
      [150, 40, 3, [[20, 10]]],
      // A planet's name, less important than the group: placed round it afterwards.
      [80, 40, 10, [[400, 0]]],
    ];
    const apart = placesOf(rows, 2);
    declutter(apart, PARAMS);
    expect(where(apart)).toEqual([0, 0, null, 0]);
    const together = placesOf(rows, 2);
    declutter(together, PARAMS, undefined, TOGETHER_5);
    expect(where(together)).toEqual([1, 1, 0, 0]);
    // ...and it holds, frame after frame.
    declutter(together, PARAMS, undefined, TOGETHER_5);
    expect(where(together)).toEqual([1, 1, 0, 0]);
  });

  it('together, puts a label where it lies on nothing before where it lies on something', () => {
    // As above, with C's places all under A's first and B's: once they move, all three show
    // whichever place C takes. Its first two lie on a body, its third on nothing: its third.
    const rows: Placed[] = [
      [
        80,
        40,
        1,
        [
          [0, 0],
          [0, 200],
        ],
      ],
      [
        80,
        40,
        2,
        [
          [90, 0],
          [90, 200],
        ],
      ],
      [
        150,
        40,
        3,
        [
          [20, 10],
          [20, 14],
          [20, 18],
        ],
      ],
    ];
    const boxes = placesOf(rows, 3);
    boxes.covers.set([0, 0, 0, 0, 0, 0, 1, 1, 0]);
    declutter(boxes, PARAMS, undefined, TOGETHER_5);
    expect(where(boxes)).toEqual([1, 1, 2]);
  });

  it('together, moves the group so that none lies where it must not, where one alone cannot', () => {
    // Two systems' names, both showing. B's place lies on another system's sun (a last resort),
    // and its only other place is where A is: B alone cannot leave it. Together, A goes to its
    // second place and B to where A was, and neither lies on a sun.
    const rows: Placed[] = [
      [
        80,
        40,
        1,
        [
          [0, 0],
          [0, 200],
        ],
      ],
      [
        80,
        40,
        2,
        [
          [300, 0],
          [0, 0],
        ],
      ],
    ];
    const boxes = placesOf(rows, 2);
    boxes.covers.set([0, 0, 2, 0]);
    shows(boxes, [0, 0]);
    declutter(boxes, PARAMS);
    expect(where(boxes), 'placed one by one').toEqual([0, 0]);
    shows(boxes, [0, 0]);
    declutter(boxes, PARAMS, undefined, TOGETHER_5);
    expect(where(boxes)).toEqual([1, 1]);
    // ...and it holds.
    declutter(boxes, PARAMS, undefined, TOGETHER_5);
    expect(where(boxes)).toEqual([1, 1]);

    // Right on a sun's disc (3) is worse than any number merely a gap off one (2): B leaves a place
    // right on one even where A's then lies a gap off one...
    const onIt = placesOf(rows, 2);
    onIt.covers.set([0, 2, 3, 2]);
    shows(onIt, [0, 0]);
    declutter(onIt, PARAMS, undefined, TOGETHER_5);
    expect(where(onIt)).toEqual([1, 1]);
    // ...and does not leave one a gap off it for a way that puts A right on one.
    const offIt = placesOf(rows, 2);
    offIt.covers.set([0, 3, 2, 0]);
    shows(offIt, [0, 0]);
    declutter(offIt, PARAMS, undefined, TOGETHER_5);
    expect(where(offIt)).toEqual([0, 0]);

    // Not while B has only just changed (young): it may not move of its own accord, and no search
    // is made for it. Nor while A has: the search keeps A where it was, finds no better way, and
    // moves nothing.
    for (const young of [[1], [0]]) {
      const held = placesOf(rows, 2);
      held.covers.set([0, 0, 2, 0]);
      shows(held, [0, 0], young);
      declutter(held, PARAMS, undefined, TOGETHER_5);
      expect(where(held), `young ${young.join()}`).toEqual([0, 0]);
    }
  });

  it('together, sets the group closer than a gap apart before one is left out or lies on a sun', () => {
    // Two systems' names, neither showing yet. B's place that lies on nothing is 2 px from A:
    // closer than names go by themselves (the gap, 4), but not so close that one of two that
    // show would have to give way (a keep closer: they may overlap by 2). Its other place lies
    // right on a sun. One by one, B takes the sun.
    const rows: Placed[] = [
      [
        80,
        40,
        1,
        [
          [0, 0],
          [Number.NaN, Number.NaN],
        ],
      ],
      [
        80,
        40,
        2,
        [
          [300, 0],
          [82, 0],
        ],
      ],
    ];
    const alone = placesOf(rows, 2);
    alone.covers.set([0, 0, 3, 0]);
    declutter(alone, PARAMS);
    expect(where(alone), 'placed one by one').toEqual([0, 0]);
    // Together, B stands beside A at once: where the two would end up anyhow, once B was allowed
    // to move again and A, showing by then, was held to the keep alone.
    const together = placesOf(rows, 2);
    together.covers.set([0, 0, 3, 0]);
    declutter(together, PARAMS, undefined, TOGETHER_5);
    expect(where(together)).toEqual([0, 1]);
    declutter(together, PARAMS, undefined, TOGETHER_5);
    expect(where(together), 'and it holds').toEqual([0, 1]);

    // The same where B's only other choice is not to show at all.
    const only: Placed[] = [
      rows[0] as Placed,
      [
        80,
        40,
        2,
        [
          [Number.NaN, Number.NaN],
          [82, 0],
        ],
      ],
    ];
    const missing = placesOf(only, 2);
    declutter(missing, PARAMS);
    expect(where(missing), 'placed one by one').toEqual([0, null]);
    const shows = placesOf(only, 2);
    declutter(shows, PARAMS, undefined, TOGETHER_5);
    expect(where(shows)).toEqual([0, 1]);

    // Not closer than the keep: 3 px into each other, B stays on the sun.
    const far: Placed[] = [
      rows[0] as Placed,
      [
        80,
        40,
        2,
        [
          [300, 0],
          [77, 0],
        ],
      ],
    ];
    const apart = placesOf(far, 2);
    apart.covers.set([0, 0, 3, 0]);
    declutter(apart, PARAMS, undefined, TOGETHER_5);
    expect(where(apart)).toEqual([0, 0]);
  });

  it('together, spends no try on a place that could do no better than the best way found', () => {
    // Two systems' names, both showing: A where it lies on nothing, B a gap off a sun, its only
    // place. No way does better, and the search looks at every way to know it. Give each a place
    // more, RIGHT ON a sun: a way through either is worse than what shows, whatever the rest
    // does, so neither is held up against anything, and the search costs what it cost without.
    const tries = (extra: boolean): number => {
      const rows: Placed[] = [
        [
          80,
          40,
          1,
          extra
            ? [
                [0, 0],
                [0, 200],
                [0, 400],
              ]
            : [
                [0, 0],
                [0, 200],
              ],
        ],
        [80, 40, 2, extra ? [[300, 0], null, [300, 400]] : [[300, 0]]],
      ];
      const boxes = placesOf(rows, extra ? 3 : 2);
      boxes.covers.set(extra ? [0, 0, 3, 2, 0, 3] : [0, 0, 2, 0]);
      shows(boxes, [0, 0]);
      declutter(boxes, PARAMS, undefined, TOGETHER_5);
      expect(where(boxes), extra ? 'with a place right on a sun' : 'without').toEqual([0, 0]);
      return boxes.tally[0] ?? 0;
    };
    const without = tries(false);
    expect(without).toBeGreaterThan(0);
    expect(tries(true)).toBe(without);
  });

  it('together, tries some 4,000 places a call at most, and after a search that found nothing rests', () => {
    // Nine systems' names, eight places each, in five slots that hold one name each: every way of
    // placing them shows five. The greedy pass shows five, and the search cannot do better.
    const SLOTS = 5;
    const rows: Placed[] = Array.from({ length: 9 }, (_, row) => [
      70,
      40,
      row + 1,
      Array.from({ length: 8 }, (_, place) => [((row + place) % SLOTS) * 100, place] as const),
    ]);
    const NINE = { firm: -Infinity, together: 100, keepSlots: false } satisfies DeclutterRules;
    const boxes = placesOf(rows, 8);
    declutter(boxes, PARAMS, undefined, NINE);
    expect(shown(boxes).filter(Boolean)).toHaveLength(SLOTS);
    // It ran out of tries, all its passes together (and a label's worth more, at most, to see
    // whether the rest have room at all).
    expect(boxes.tally[0]).toBeGreaterThan(3500);
    expect(boxes.tally[0]).toBeLessThanOrEqual(4000 + 9 * 8);
    // The next nine calls (frames) it does not search again, while as many show and wait...
    for (let call = 0; call < 9; call += 1) {
      declutter(boxes, PARAMS, undefined, NINE);
      expect(boxes.tally[0]).toBe(0);
    }
    // ...and the tenth it does.
    declutter(boxes, PARAMS, undefined, NINE);
    expect(boxes.tally[0]).toBeGreaterThan(0);
    // Resting again, it searches at once once fewer wait: the room may have changed.
    declutter(boxes, PARAMS, undefined, NINE);
    expect(boxes.tally[0]).toBe(0);
    const waiting = shown(boxes).indexOf(0);
    boxes.priority[waiting] = Infinity;
    declutter(boxes, PARAMS, undefined, NINE);
    expect(boxes.tally[0]).toBeGreaterThan(0);
  });

  it('together or not, gives way to what was there first', () => {
    const taken = createTakenBoxes(1);
    taken.count = 1;
    Object.assign(taken.boxes[0] ?? {}, { left: 0, top: 0, width: 100, height: 60 });
    const boxes = placesOf(
      [
        [
          80,
          40,
          1,
          [
            [10, 10],
            [10, 200],
          ],
        ],
        [80, 40, 2, [[20, 20]]],
      ],
      2,
    );
    declutter(boxes, PARAMS, taken, TOGETHER_5);
    expect(where(boxes)).toEqual([1, null]);
  });
});

describe('declutter, who moves for whom', () => {
  it('moves a label to make room only where it is then clear of the one it made room for', () => {
    // C's only place is under A. A's next place is still in C's way; its last is clear of it.
    const boxes = placesOf(
      [
        [
          80,
          40,
          1,
          [
            [0, 0],
            [0, 50],
            [0, 300],
          ],
        ],
        [80, 40, 2, [[20, 30]]],
      ],
      3,
    );
    declutter(boxes, PARAMS);
    expect(where(boxes)).toEqual([2, 0]);
  });

  it('goes back to its first place only where that takes no room from a label that shows', () => {
    // A system's name A shows at its second place; its first is free of everything placed before
    // it, but a planet's name B, placed after it, shows there. A stays, and so does B (a planet's
    // name could not move A back out of its way).
    const boxes = placesOf(
      [
        [
          80,
          40,
          1,
          [
            [0, 0],
            [0, 200],
          ],
        ],
        [80, 40, 10, [[40, 10]]],
      ],
      2,
    );
    shows(boxes, [1, 0]);
    declutter(boxes, PARAMS, undefined, TOGETHER_5);
    expect(where(boxes)).toEqual([1, 0]);
  });

  it('moves a label for its own kind to any of its places, for a lesser kind only back to its first', () => {
    const rows: Placed[] = [
      [
        80,
        40,
        1,
        [
          [0, 0],
          [0, 200],
        ],
      ],
      [80, 40, 10, [[40, 10]]],
    ];
    // Of one kind: A moves below, and both show.
    const alike = placesOf(rows, 2);
    declutter(alike, PARAMS);
    expect(where(alike)).toEqual([1, 0]);
    // A system's name in the way of a planet's: it keeps its first place, and the planet's waits.
    const apart = placesOf(rows, 2);
    declutter(apart, PARAMS, undefined, TOGETHER_5);
    expect(where(apart)).toEqual([0, null]);
  });

  it('never moves a firm label, nor leaves one out, nor holds one back', () => {
    const FIRM = { firm: 1, together: -Infinity, keepSlots: true } satisfies DeclutterRules;
    // F is where the ship is going: B's only place is under it, and F stays put.
    const put = placesOf(
      [
        [
          80,
          40,
          0.5,
          [
            [0, 0],
            [0, 200],
          ],
        ],
        [80, 40, 2, [[40, 10]]],
      ],
      2,
    );
    declutter(put, PARAMS, undefined, FIRM);
    expect(where(put)).toEqual([0, null]);
    // Two names show, as many as may; F has only just been hidden (young), and comes all the
    // same: the less important of the two gives it the room.
    const full = placesOf(
      [
        [80, 40, 0.5, [[0, 0]]],
        [80, 40, 2, [[200, 0]]],
        [80, 40, 3, [[400, 0]]],
      ],
      1,
    );
    shows(full, [null, 0, 0], [0]);
    declutter(full, { ...PARAMS, max: 2 }, undefined, FIRM);
    expect(where(full)).toEqual([0, 0, null]);
  });

  it('takes a place that lies on something only where it has no other, and keeps or leaves it', () => {
    const rows: Placed[] = [
      [
        80,
        40,
        1,
        [
          [0, 0],
          [0, 200],
          [0, 400],
        ],
      ],
    ];
    // Its first place lies on a body: it takes its second.
    const first = placesOf(rows, 3);
    first.covers[0] = 1;
    declutter(first, PARAMS);
    expect(where(first)).toEqual([1]);
    // Its first lies on what it must not, its second on a body: its second, then.
    first.covers.set([2, 1, 2]);
    shows(first, [null]);
    declutter(first, PARAMS);
    expect(where(first)).toEqual([1]);
    // All do: the one that lies on least, first first.
    const all = placesOf(rows, 3);
    all.covers.set([2, 2, 2]);
    declutter(all, PARAMS);
    expect(where(all)).toEqual([0]);
    // Showing at its second, it does not go back to a first that lies on more than where it is.
    const back = placesOf(rows, 3);
    back.covers[0] = 1;
    shows(back, [1]);
    declutter(back, PARAMS);
    expect(where(back)).toEqual([1]);
    // Showing at its first, it stays there when a body drifts under it...
    const under = placesOf(rows, 3);
    shows(under, [0]);
    under.covers[0] = 1;
    declutter(under, PARAMS);
    expect(where(under)).toEqual([0]);
    // ...but not when it is something it must not lie on: then it moves to a place that lies on
    // less once it may (not while young)...
    under.covers.set([2, 1, 0]);
    shows(under, [0], [0]);
    declutter(under, PARAMS);
    expect(where(under)).toEqual([0]);
    shows(under, [0]);
    declutter(under, PARAMS);
    expect(where(under)).toEqual([2]);
    // ...where that has room to spare (a keep more than the gap) and takes none from a label that
    // shows...
    const crowded = placesOf([...rows, [80, 40, 2, [[0, 448]]]], 3);
    crowded.covers.set([2, 2, 0]);
    shows(crowded, [0, 0]);
    declutter(crowded, PARAMS);
    expect(where(crowded)).toEqual([0, 0]);
    // ...and there it stays: it goes back only to a first place that lies on no more.
    under.covers.set([2, 1, 1]);
    declutter(under, PARAMS);
    expect(where(under)).toEqual([2]);
    under.covers.set([1, 1, 1]);
    declutter(under, PARAMS);
    expect(where(under)).toEqual([0]);
  });

  it('with keepSlots, keeps a slot for a young label that shows, and only for one', () => {
    const SLOTS = {
      firm: -Infinity,
      together: -Infinity,
      keepSlots: true,
    } satisfies DeclutterRules;
    // At most two. B shows, and has only just appeared; C, more important, waits with room.
    const rows = (bGone: boolean): Placed[] => [
      [80, 40, 1, [[0, 0]]],
      [80, 40, bGone ? Infinity : 2, [[200, 0]]],
      [80, 40, 1.5, [[400, 0]]],
    ];
    const params = { ...PARAMS, max: 2 };
    const kept = placesOf(rows(false), 1);
    shows(kept, [0, 0, null], [1]);
    declutter(kept, params, undefined, SLOTS);
    expect(where(kept)).toEqual([0, 0, null]);
    // Without, C takes B's slot at once: a name that has just come goes again.
    const traded = placesOf(rows(false), 1);
    shows(traded, [0, 0, null], [1]);
    declutter(traded, params);
    expect(where(traded)).toEqual([0, null, 0]);
    // B's body goes out of view: C shows.
    reload(kept, rows(true));
    declutter(kept, params, undefined, SLOTS);
    expect(where(kept)).toEqual([0, null, 0]);
    // Once B has shown a while, the more important C takes its slot: a moon's name does not keep a
    // planet's out.
    const settled = placesOf(rows(false), 1);
    shows(settled, [0, 0, null]);
    declutter(settled, params, undefined, SLOTS);
    expect(where(settled)).toEqual([0, null, 0]);
  });
});

describe('declutter, young labels', () => {
  const rows: Placed[] = [
    [
      80,
      40,
      1,
      [
        [0, 0],
        [0, 200],
      ],
    ],
    [80, 40, 2, [[20, 10]]],
  ];

  it('leaves a young label that is hidden hidden, room or not, and shows it once it is not', () => {
    const boxes = placesOf([[80, 40, 1, [[0, 0]]]], 1);
    shows(boxes, [null], [0]);
    declutter(boxes, PARAMS);
    expect(where(boxes)).toEqual([null]);
    boxes.young[0] = 0;
    declutter(boxes, PARAMS);
    expect(where(boxes)).toEqual([0]);
  });

  it('keeps the place a hidden young label would take from a lesser one that waits to show', () => {
    // A was hidden a moment ago and is young; B, less important, was hidden two frames before it
    // and no longer is. B's first place is where A would show: taken now, B would show there for
    // the two frames until A may, and then have to go. It takes its other place instead...
    const pair: Placed[] = [
      [80, 40, 1, [[0, 0]]],
      [
        80,
        40,
        2,
        [
          [20, 10],
          [20, 200],
        ],
      ],
    ];
    const boxes = placesOf(pair, 2);
    shows(boxes, [null, null], [0]);
    declutter(boxes, PARAMS);
    expect(where(boxes)).toEqual([null, 1]);
    // ...and A comes where it was kept room, and B stays.
    boxes.young[0] = 0;
    declutter(boxes, PARAMS);
    expect(where(boxes)).toEqual([0, 1]);

    // With no other place, B waits for A rather than show for a moment...
    const only = placesOf([pair[0] as Placed, [80, 40, 2, [[20, 10]]]], 1);
    shows(only, [null, null], [0]);
    declutter(only, PARAMS);
    expect(where(only)).toEqual([null, null]);
    only.young[0] = 0;
    declutter(only, PARAMS);
    expect(where(only)).toEqual([0, null]);

    // ...but one that shows there already keeps its place until A does come: nothing is hidden
    // for a label that is not there yet.
    const there = placesOf(pair, 2);
    shows(there, [null, 0], [0]);
    declutter(there, PARAMS);
    expect(where(there)).toEqual([null, 0]);

    // And a hidden young label with no room anywhere keeps none: B is free to show.
    const taken = createTakenBoxes(1);
    taken.count = 1;
    Object.assign(taken.boxes[0] ?? {}, { left: 0, top: 0, width: 10, height: 10 });
    const none = placesOf(
      [
        [80, 40, 1, [[0, 0]]],
        [80, 40, 2, [[20, 10]]],
      ],
      1,
    );
    shows(none, [null, null], [0]);
    declutter(none, PARAMS, taken);
    expect(where(none)).toEqual([null, 0]);
  });

  it('does not send a young label back to its first place, and does once it is not', () => {
    const boxes = placesOf(rows.slice(0, 1), 2);
    shows(boxes, [1], [0]);
    declutter(boxes, PARAMS);
    expect(where(boxes)).toEqual([1]);
    boxes.young[0] = 0;
    declutter(boxes, PARAMS);
    expect(where(boxes)).toEqual([0]);
  });

  it('does not move a young label to make room for another', () => {
    const young = placesOf(rows, 2);
    shows(young, [0, null], [0]);
    declutter(young, PARAMS);
    expect(where(young)).toEqual([0, null]);
    const grown = placesOf(rows, 2);
    shows(grown, [0, null]);
    declutter(grown, PARAMS);
    expect(where(grown)).toEqual([1, 0]);
  });

  it('still moves a young label where it must: something more important that shows needs its place', () => {
    // A has only just come, at its first place. B, more important, showed at a place that is gone,
    // and its only other place is A's: B takes it, and A moves to its second.
    const boxes = placesOf(
      [
        [
          80,
          40,
          2,
          [
            [0, 0],
            [0, 200],
          ],
        ],
        [80, 40, 1, [null, [20, 10]]],
      ],
      2,
    );
    shows(boxes, [0, NOWHERE], [0]);
    declutter(boxes, PARAMS);
    expect(where(boxes)).toEqual([1, 1]);
  });

  it('keeps a young label where it is a moment for one that waits to show, however important', () => {
    // B, more important, waits to show, and its only place is where A has only just come: it
    // waits a moment, and A does not go again as soon as it came.
    const boxes = placesOf(
      [
        [
          80,
          40,
          2,
          [
            [0, 0],
            [0, 200],
          ],
        ],
        [80, 40, 1, [[20, 10]]],
      ],
      2,
    );
    shows(boxes, [0, null], [0]);
    declutter(boxes, PARAMS);
    expect(where(boxes)).toEqual([0, null]);
    // Once A has shown a while, B takes its place, and A moves to its second.
    shows(boxes, [0, null]);
    declutter(boxes, PARAMS);
    expect(where(boxes)).toEqual([1, 0]);
    // Firm, or one of the group, B takes it at once.
    for (const rules of [
      { firm: 2, together: -Infinity, keepSlots: false },
      { firm: -Infinity, together: 2, keepSlots: false },
    ] satisfies DeclutterRules[]) {
      shows(boxes, [0, null], [0]);
      declutter(boxes, PARAMS, undefined, rules);
      expect(where(boxes)).toEqual([1, 0]);
    }
  });

  it('moves a young label whose place is gone, where one that was hidden stays hidden', () => {
    // Both young, both with room at their second place; A showed at a place that is no more.
    const boxes = placesOf(
      [
        [80, 40, 1, [null, [0, 200]]],
        [80, 40, 2, [null, [200, 200]]],
      ],
      2,
    );
    shows(boxes, [NOWHERE, null], [0, 1]);
    declutter(boxes, PARAMS);
    expect(where(boxes)).toEqual([1, null]);
  });

  it('in the group, keeps a young label where it was, and leaves a young one that is hidden out', () => {
    // A (young) shows at its second place, which is C's only one; its first is free. Every way
    // of placing the group is tried for C, but A stays: C waits until A is not young.
    const group: Placed[] = [
      [
        80,
        40,
        1,
        [
          [0, 0],
          [0, 200],
        ],
      ],
      [80, 40, 2, [[400, 0]]],
      [80, 40, 3, [[20, 210]]],
    ];
    const boxes = placesOf(group, 2);
    shows(boxes, [1, 0, null], [0]);
    declutter(boxes, PARAMS, undefined, TOGETHER_5);
    expect(where(boxes)).toEqual([1, 0, null]);
    boxes.young[0] = 0;
    declutter(boxes, PARAMS, undefined, TOGETHER_5);
    expect(where(boxes)).toEqual([0, 0, 0]);
    // B, young and hidden, with room: it stays hidden, and nothing is searched for it.
    const hidden = placesOf(group, 2);
    shows(hidden, [0, null, null], [1]);
    declutter(hidden, PARAMS, undefined, TOGETHER_5);
    expect(where(hidden)).toEqual([0, null, 0]);
  });

  it('in the group, lets a label stay a keep closer than the gap where it was, as it would alone', () => {
    // A, B and D (systems' names) show at their first places; C, the fourth, has one place, under
    // A and D at once. Placed together, A and D move and C shows. B, a little closer than the gap
    // to the dock prompt, stays where it is: it showed there, and the keep lets it.
    const taken = createTakenBoxes(1);
    taken.count = 1;
    Object.assign(taken.boxes[0] ?? {}, { left: 382, top: 0, width: 50, height: 40 });
    const boxes = placesOf(
      [
        [
          80,
          40,
          1,
          [
            [0, 0],
            [0, 200],
          ],
        ],
        [
          80,
          40,
          2,
          [
            [300, 0],
            [300, 200],
          ],
        ],
        [
          80,
          40,
          3,
          [
            [150, 0],
            [150, 200],
          ],
        ],
        [90, 40, 4, [[70, 10]]],
      ],
      2,
    );
    shows(boxes, [0, 0, 0, null]);
    declutter(boxes, PARAMS, taken, TOGETHER_5);
    expect(where(boxes)).toEqual([1, 0, 1, 0]);
  });

  it('in the group, does not show a young label that was hidden, even while searching for another', () => {
    // C, the fourth system's name, has one place, under A and D at once: every way of placing the
    // group is tried for it. B has room, but it hid a moment ago (young): the search leaves it
    // out, as placing one by one does.
    const boxes = placesOf(
      [
        [
          80,
          40,
          1,
          [
            [0, 0],
            [0, 200],
          ],
        ],
        [80, 40, 2, [[400, 0]]],
        [
          80,
          40,
          2.5,
          [
            [150, 0],
            [150, 200],
          ],
        ],
        [90, 40, 3, [[70, 10]]],
      ],
      2,
    );
    shows(boxes, [0, null, 0, null], [1]);
    declutter(boxes, PARAMS, undefined, TOGETHER_5);
    expect(where(boxes)).toEqual([1, null, 1, 0]);
  });

  it('in the group, moves nothing for a search that shows no more than there was', () => {
    // A goes back to its first place, which has room again. C's only place is under the dock
    // prompt: the search for it finds no way to show more, and leaves A where it went.
    const taken = createTakenBoxes(1);
    taken.count = 1;
    Object.assign(taken.boxes[0] ?? {}, { left: 290, top: 0, width: 100, height: 60 });
    const boxes = placesOf(
      [
        [
          80,
          40,
          1,
          [
            [0, 0],
            [0, 200],
          ],
        ],
        [80, 40, 3, [[300, 0]]],
      ],
      2,
    );
    shows(boxes, [1, null]);
    declutter(boxes, PARAMS, taken, TOGETHER_5);
    expect(where(boxes)).toEqual([0, null]);
  });
});

describe('declutter, at rest', () => {
  it('settles within the frame: a move that makes room is followed at once, not a frame later', () => {
    // A shows at its second place: its first is where C showed. B comes, and C moves aside for
    // it. A's first place is then free: A goes back to it in the same call.
    const boxes = placesOf(
      [
        [
          80,
          40,
          1,
          [
            [0, 0],
            [0, 200],
          ],
        ],
        [80, 40, 2, [[100, 60]]],
        [
          80,
          40,
          3,
          [
            [40, 30],
            [300, 300],
          ],
        ],
      ],
      2,
    );
    shows(boxes, [1, null, 0]);
    declutter(boxes, PARAMS);
    expect(where(boxes)).toEqual([0, 0, 1]);
    declutter(boxes, PARAMS);
    expect(where(boxes)).toEqual([0, 0, 1]);
  });

  it('comes to rest: every sky, once held still, stands within a few calls and then holds', () => {
    // Random crowded skies, four places a label, that drift for a while (places moving, coming
    // and going) and are then held still. Half as the star map has them: a label that waits goes
    // after those of its rank that show (ui/Labels.ts), the firm first, the most important rank
    // placed together, `keepSlots`, and a label that has just changed young for the next
    // `DWELL` calls. Half as in flight: fixed priorities, one kind, none young.
    const rng = createRng('at rest');
    const COUNT = 16;
    const PLACES = 4;
    const STEP = 1e6;
    const ON_MAP = { firm: STEP, together: 2 * STEP, keepSlots: true } satisfies DeclutterRules;
    const params = { ...PARAMS, max: 10 };
    const DRIFT = 12;
    const HOLD = 20;
    const DWELL = 3;
    let latest = -1;
    for (let sky = 0; sky < 400; sky += 1) {
      const map = sky % 2 === 0;
      const boxes = createLabelBoxes(COUNT, PLACES);
      boxes.count = COUNT;
      const rank: number[] = [];
      const near: number[] = [];
      for (let row = 0; row < COUNT; row += 1) {
        rank.push(rng() < 0.05 ? 0.5 : 1 + Math.floor(rng() * 3));
        near.push(rng() * 1000);
        boxes.width[row] = 40 + rng() * 80;
        boxes.height[row] = 40;
        for (let p = 0; p < PLACES; p += 1) {
          boxes.left[row * PLACES + p] = rng() * 400;
          boxes.top[row * PLACES + p] = rng() * 300;
        }
      }
      const changed = new Array<number>(COUNT).fill(-Infinity);
      let before = where(boxes);
      let last = -1;
      for (let call = 0; call < DRIFT + HOLD; call += 1) {
        const drifting = call < DRIFT;
        for (let row = 0; row < COUNT; row += 1) {
          for (let p = 0; drifting && p < PLACES; p += 1) {
            const at = row * PLACES + p;
            boxes.left[at] = (boxes.left[at] ?? 0) + (rng() - 0.5) * 24;
            boxes.top[at] = (boxes.top[at] ?? 0) + (rng() - 0.5) * 24;
            // Now and then on a body, or on what it must not (a sun: as a last resort).
            const lies = rng();
            boxes.covers[at] = lies < 0.1 ? 2 : lies < 0.2 ? 1 : 0;
          }
          // A place that is gone (as the caller says: ui/Labels.ts).
          const gone = drifting && rng() < 0.1 ? Math.floor(rng() * PLACES) : -1;
          if (gone >= 0) boxes.left[row * PLACES + gone] = Number.NaN;
          if (gone >= 0 && boxes.at[row] === gone) boxes.at[row] = NOWHERE;
          const wait = map && !boxes.shown[row] ? STEP / 4 : 0;
          boxes.priority[row] = (rank[row] ?? 3) * STEP + wait + (near[row] ?? 0);
          boxes.young[row] = map && call - (changed[row] ?? -Infinity) < DWELL ? 1 : 0;
        }
        declutter(boxes, params, undefined, map ? ON_MAP : undefined);
        const now = where(boxes);
        now.forEach((place, row) => {
          if (place === before[row]) return;
          changed[row] = call;
          if (!drifting) last = call - DRIFT;
        });
        before = now;
        // Never more than may show, nothing where it has no place, and no two closer than a keep
        // inside the gap.
        const on = now.flatMap((place, row) => (place === null ? [] : [{ row, place }]));
        expect(on.length).toBeLessThanOrEqual(params.max);
        for (const a of on) {
          const box = boxAt(boxes, a.row, a.place);
          expect(Number.isFinite(box.left), `sky ${sky}: ${a.row} has no place`).toBe(true);
          for (const b of on) {
            if (b.row <= a.row) continue;
            const other = boxAt(boxes, b.row, b.place);
            expect(
              gapBetween(box, other),
              `sky ${sky}, call ${call}: ${a.row} and ${b.row}`,
            ).toBeGreaterThanOrEqual(PARAMS.gapPx - PARAMS.keepPx);
          }
        }
      }
      expect(last, `sky ${sky} still changing`).toBeLessThan(HOLD - 2 * DWELL);
      latest = Math.max(latest, last);
    }
    // The changes that come once the sky stops are the young labels' last few, held back by the
    // dwell, and the group's, where a search that found no better way as the sky drifted rests a
    // few calls before the next (ten: `SEARCH_REST`); then nothing.
    expect(latest).toBeLessThanOrEqual(Math.max(DWELL, 10));
  });
});

/** Say where each label showed last time (null: it did not; NOWHERE: at a place now gone). */
function shows(
  boxes: LabelBoxes,
  places: readonly (number | null)[],
  young: readonly number[] = [],
): void {
  places.forEach((place, row) => {
    boxes.shown[row] = place === null ? 0 : 1;
    boxes.at[row] = place ?? 0;
  });
  boxes.young.fill(0);
  for (const row of young) boxes.young[row] = 1;
}

function boxAt(boxes: LabelBoxes, row: number, place: number) {
  const at = row * boxes.places + place;
  return {
    left: boxes.left[at] ?? Number.NaN,
    top: boxes.top[at] ?? Number.NaN,
    width: boxes.width[row] ?? 0,
    height: boxes.height[row] ?? 0,
  };
}

/** How far apart two boxes are (CSS px): negative by as much as they overlap, both ways. */
function gapBetween(a: ReturnType<typeof boxAt>, b: ReturnType<typeof boxAt>): number {
  return Math.max(
    a.left - (b.left + b.width),
    b.left - (a.left + a.width),
    a.top - (b.top + b.height),
    b.top - (a.top + a.height),
  );
}

describe('verticalClearance', () => {
  const box = { left: 100, top: 100, width: 20, height: 20 };

  it('is the gap up or down, and negative by the overlap', () => {
    expect(verticalClearance(80, 130, 60, 24, box, 4)).toBe(10); // below it
    expect(verticalClearance(80, 60, 60, 24, box, 4)).toBe(16); // above it
    expect(verticalClearance(80, 110, 60, 24, box, 4)).toBe(-10); // over its lower half
  });

  it('is Infinity for a label off to one side, and finite within besidePx of it', () => {
    expect(verticalClearance(125, 100, 60, 24, box, 4)).toBe(Infinity);
    expect(verticalClearance(123, 100, 60, 24, box, 4)).toBe(-20);
    expect(verticalClearance(20, 100, 76, 24, box, 4)).toBe(Infinity);
    expect(verticalClearance(20, 100, 77, 24, box, 4)).toBe(-20);
  });
});

describe('glidePast', () => {
  const box = { left: 100, top: 100, width: 20, height: 20 };

  it('is nothing for a label that is a gap clear of the box, above, below or beside it', () => {
    expect(glidePast(80, 124, 60, 24, box, 4, 1)).toBe(0); // a gap below
    expect(glidePast(80, 72, 60, 24, box, 4, -1)).toBe(0); // a gap above
    expect(glidePast(124, 100, 60, 24, box, 4, 1)).toBe(0); // a gap to the right
    expect(glidePast(16, 100, 80, 24, box, 4, -1)).toBe(0); // a gap to the left
  });

  it('goes all the way past the box, the way it is told, a gap beyond it', () => {
    // Over the box's lower half: down to 124, or up to 100 - 4 - 24 = 72.
    expect(glidePast(80, 110, 60, 24, box, 4, 1)).toBe(14);
    expect(glidePast(80, 110, 60, 24, box, 4, -1)).toBe(38);
    // Just inside the gap: a nudge.
    expect(glidePast(80, 122, 60, 24, box, 4, 1)).toBe(2);
    expect(glidePast(80, 74, 60, 24, box, 4, -1)).toBe(2);
    // Within the gap beside it counts as touching too.
    expect(glidePast(123, 110, 60, 24, box, 4, 1)).toBe(14);
  });
});
