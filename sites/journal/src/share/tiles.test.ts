import { describe, expect, test } from 'vitest';
import { arrangePhotos, type PhotoBlock } from './tiles';

// As the snapshot draws them: 936 px wide (1080 less its margins), 16 px apart.
const WIDTH = 936;
const GAP = 16;
const LANDSCAPE = 4 / 3;
const PORTRAIT = 3 / 4;
const WIDE = 16 / 9;

const arrange = (aspects: number[], least: number, most: number) =>
  arrangePhotos(aspects, WIDTH, GAP, least, most);
const times = (count: number, aspect: number) => Array.from({ length: count }, () => aspect);
/** How many rows a block's tiles start in. */
const rows = (block: PhotoBlock) => new Set(block.tiles.map((tile) => tile.y)).size;
/** Four photos in one row, as tall as the room kept. */
const oneRow = [0, 238, 476, 714].map((x) => ({ x, y: 0, w: 222, h: 340 }));

describe('arrangePhotos', () => {
  test('one photo takes the width and grows to its own shape, within the room and 3:4', () => {
    expect(arrange([LANDSCAPE], 340, 1000)).toEqual({
      height: 702,
      tiles: [{ x: 0, y: 0, w: 936, h: 702 }],
    });
    expect(arrange([LANDSCAPE], 340, 500).height).toBe(500);
    expect(arrange([1 / 2], 340, 2000).height).toBe(1248);
    // A panorama is still as tall as the room the snapshot kept.
    expect(arrange([4], 340, 1000).height).toBe(340);
    expect(arrange([], 340, 1000)).toEqual({ height: 0, tiles: [] });
  });

  test('four landscape photos with room to spare take two rows', () => {
    // In one row each is 222 px wide, 167 px tall at its own shape: never taller than the 340
    // kept, however much room is spare, and cut to half its width.
    expect(arrange(times(4, LANDSCAPE), 340, 553)).toEqual({
      height: 552,
      tiles: [
        { x: 0, y: 0, w: 460, h: 268 },
        { x: 476, y: 0, w: 460, h: 268 },
        { x: 0, y: 284, w: 460, h: 268 },
        { x: 476, y: 284, w: 460, h: 268 },
      ],
    });
    // Given more room than they need, they grow to their own shape and no further.
    const roomy = arrange(times(4, LANDSCAPE), 340, 2000);
    expect(roomy.height).toBe(706);
    expect(roomy.tiles[3]).toEqual({ x: 476, y: 361, w: 460, h: 345 });
  });

  test('with no room to spare, landscape photos keep one row, and wider ones still take two', () => {
    expect(arrange(times(4, LANDSCAPE), 340, 340)).toEqual({ height: 340, tiles: oneRow });
    const wide = arrange(times(4, WIDE), 340, 340);
    expect(wide.height).toBe(340);
    expect(wide.tiles.map(({ y, w, h }) => [y, w, h])).toEqual([
      [0, 460, 162],
      [0, 460, 162],
      [178, 460, 162],
      [178, 460, 162],
    ]);
  });

  test('portrait photos keep one row unless it would leave most of the room empty', () => {
    expect(arrange(times(4, PORTRAIT), 340, 553)).toEqual({ height: 340, tiles: oneRow });
    const tall = arrange(times(4, PORTRAIT), 340, 900);
    expect(tall.height).toBe(900);
    expect(rows(tall)).toBe(2);
  });

  test('of three, the first is large and the other two stack beside it', () => {
    expect(arrange(times(3, LANDSCAPE), 340, 553)).toEqual({
      height: 470,
      tiles: [
        { x: 0, y: 0, w: 613, h: 470 },
        { x: 629, y: 0, w: 307, h: 227 },
        { x: 629, y: 243, w: 307, h: 227 },
      ],
    });
    // Portrait ones fit one row at their own shape.
    const portrait = arrange(times(3, PORTRAIT), 340, 553);
    expect(portrait.height).toBe(401);
    expect(rows(portrait)).toBe(1);
  });

  test('two stack when they are wide, and stand side by side when not', () => {
    expect(arrange(times(2, 21 / 9), 340, 700)).toEqual({
      height: 700,
      tiles: [
        { x: 0, y: 0, w: 936, h: 342 },
        { x: 0, y: 358, w: 936, h: 342 },
      ],
    });
    // Side by side they show all of themselves; stacked they would lose half their height.
    expect(arrange(times(2, LANDSCAPE), 340, 720)).toEqual({
      height: 345,
      tiles: [
        { x: 0, y: 0, w: 460, h: 345 },
        { x: 476, y: 0, w: 460, h: 345 },
      ],
    });
  });

  test('every arrangement stays in its block and keeps its tiles apart', () => {
    const shapes = [1 / 2, PORTRAIT, 1, LANDSCAPE, WIDE, 3];
    for (let count = 1; count <= 4; count++) {
      for (let first = 0; first < shapes.length; first++) {
        const aspects = Array.from(
          { length: count },
          (_, i) => shapes[(first + i * 2) % shapes.length] ?? 1,
        );
        for (const least of [180, 340]) {
          for (const most of [least, least + 200, least + 1000]) {
            const block = arrange(aspects, least, most);
            expect(block.tiles).toHaveLength(count);
            expect(block.height).toBeGreaterThanOrEqual(least);
            expect(block.height).toBeLessThanOrEqual(most);
            block.tiles.forEach((a, i) => {
              expect(a.x).toBeGreaterThanOrEqual(0);
              expect(a.x + a.w).toBeLessThanOrEqual(WIDTH + 1e-9);
              expect(a.y).toBeGreaterThanOrEqual(0);
              expect(a.y + a.h).toBeLessThanOrEqual(block.height);
              for (const b of block.tiles.slice(i + 1)) {
                const apart =
                  a.x + a.w + GAP <= b.x + 1e-9 ||
                  b.x + b.w + GAP <= a.x + 1e-9 ||
                  a.y + a.h + GAP <= b.y ||
                  b.y + b.h + GAP <= a.y;
                expect(apart).toBe(true);
              }
            });
          }
        }
      }
    }
  });
});
