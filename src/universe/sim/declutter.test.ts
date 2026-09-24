import { describe, expect, it } from 'vitest';
import {
  createLabelBoxes,
  createTakenBoxes,
  declutter,
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
