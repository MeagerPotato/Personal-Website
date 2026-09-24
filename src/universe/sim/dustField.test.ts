import { describe, expect, it } from 'vitest';
import { slideField } from './dustField';

const BOX = [260, 70, 260] as const;

describe('where in the dust the viewer is', () => {
  it('moves with the viewer, step for step, up to the speed it can be seen at', () => {
    const field = { x: 0, y: 0, z: 0 };
    const share = slideField(field, { x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: -2 }, 200, 300, BOX);
    expect(share).toBe(1);
    expect(field.x).toBeCloseTo(3, 9);
    expect(field.z).toBeCloseTo(BOX[2] - 2, 9); // the same place, wrapped into the box
  });

  it('beyond that speed, slides by no faster than it', () => {
    const field = { x: 10, y: 5, z: 10 };
    // 700 u/s for a frame at 30 fps: a step of 23 u, of which the dust shows what 300 u/s would.
    const step = 700 / 30;
    const share = slideField(field, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: step }, 700, 300, BOX);
    expect(share).toBeCloseTo(300 / 700, 12);
    expect(field.z - 10).toBeCloseTo(300 / 30, 9);
    expect(field.x).toBe(10);
    expect(field.y).toBe(5);
  });

  it('stays inside the box, however far the viewer goes', () => {
    const field = { x: 0, y: 0, z: 0 };
    const from = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 1000; i += 1) {
      const to = { x: from.x + 7.3, y: 0, z: from.z - 11.9 };
      slideField(field, from, to, 50, 300, BOX);
      from.x = to.x;
      from.z = to.z;
    }
    for (const [value, size] of [
      [field.x, BOX[0]],
      [field.y, BOX[1]],
      [field.z, BOX[2]],
    ] as const) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(size);
    }
    // ...and it is still exactly where the viewer is, wrapped: nothing drifted on the way.
    expect(field.x).toBeCloseTo(7300 % BOX[0], 6);
    expect(field.z).toBeCloseTo(BOX[2] - (11900 % BOX[2]), 6);
  });
});
