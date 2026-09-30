import { describe, expect, it } from 'vitest';
import {
  createLabelBoxes,
  createTakenBoxes,
  declutter,
  glidePast,
  verticalClearance,
  type LabelBoxes,
} from './declutter';
import { createRng } from './rng';

const PARAMS = { gapPx: 4, keepPx: 6, max: 12 };

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
    declutter(together, PARAMS, undefined, 5);
    expect(where(together)).toEqual([1, 1, 0, 0]);
    // ...and it holds, frame after frame.
    declutter(together, PARAMS, undefined, 5);
    expect(where(together)).toEqual([1, 1, 0, 0]);
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
    declutter(boxes, PARAMS, taken, 5);
    expect(where(boxes)).toEqual([1, null]);
  });
});

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
