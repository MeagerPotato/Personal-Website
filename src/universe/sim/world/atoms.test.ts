import { describe, expect, it } from 'vitest';
import { bead, BEAD_SIDES, fin, FONT, pix, text, tile } from './atoms';
import { centroidOf, corner, dot, normalOf, type Vec3 } from './kit';

// The atoms' triangle counts are the vocabulary's (section 4.1).

const WHITE: Vec3 = [1, 1, 1];

describe('the atoms', () => {
  it('makes a bead, a ball: sides x (bands - 1) x 2 triangles facing out, lit as a ball', () => {
    const tris = bead(0.1, WHITE);
    expect(BEAD_SIDES).toBe(6);
    expect(tris).toHaveLength(24);
    expect(tris.every((t) => dot(normalOf(t), centroidOf(t)) > 0)).toBe(true);
    const fine = bead(0.1, WHITE, 16);
    expect(fine).toHaveLength(16 * 7 * 2);
    for (const t of [...tris, ...fine]) {
      for (let v = 0; v < 3; v += 1) {
        const at = corner(t, v);
        // On the ball, and its normal within a band's turn of straight out (exactly so at a pole).
        expect(Math.hypot(...at)).toBeCloseTo(0.1, 6);
        const n = corner({ ...t, p: Array.from(t.n ?? []) }, v);
        expect(dot(n, at) / 0.1).toBeGreaterThan(0.86);
        if (Math.abs(at[1]) > 0.0999) expect(Math.abs(n[1])).toBeCloseTo(1, 6);
      }
    }
  });

  it('makes a tile, a flat n-gon of n - 2 triangles facing up', () => {
    expect(tile(0.1, 12, WHITE)).toHaveLength(10);
    expect(tile(0.1, 4, WHITE)).toHaveLength(2);
    const tris = tile(0.1, 8, WHITE, 0.5, 0.3);
    expect(tris.every((t) => normalOf(t)[1] > 0.999 && t.p[1] === 0.5)).toBe(true);
  });

  it('makes a fin, a thick plate of 4n - 4 triangles', () => {
    const outline = [
      [0, 0],
      [0.3, 0],
      [0.2, 0.2],
      [0, 0.3],
    ] as const;
    expect(fin(outline, 0.02, WHITE)).toHaveLength(12);
    expect(
      fin(
        [
          [-0.1, 0],
          [0.1, 0],
          [0, 0.2],
        ],
        0.04,
        WHITE,
      ),
    ).toHaveLength(8);
  });

  it('spells digits and full stops in the 3x5 pixel font', () => {
    expect(FONT).toHaveLength(10);
    expect(text('1')).toEqual(['.#.', '##.', '.#.', '.#.', '###']);
    expect(text('0')).toEqual(['###', '#.#', '#.#', '#.#', '###']);
    expect(text('.5')).toEqual(['..###', '..#..', '..###', '....#', '#.###']);
    expect(() => text('A')).toThrow(/no 'A'/);
  });

  it('draws pixel art as one quad a run, 2 triangles a run', () => {
    expect(pix(['#.#', '###'], 0.1, WHITE)).toHaveLength(6);
    // 13.0: runs of the five rows of 1, 3, the stop and 0.
    const rows = text('13.0');
    const runs = rows.reduce((sum, row) => sum + (row.match(/#+/g)?.length ?? 0), 0);
    expect(pix('13.0', 0.03, WHITE)).toHaveLength(2 * runs);
    const tris = pix('5', 0.04, WHITE);
    expect(tris.every((t) => normalOf(t)[2] > 0.999)).toBe(true);
    // Centred on the origin: 3 cells wide, 5 high.
    const xs = tris.flatMap((t) => [t.p[0], t.p[3], t.p[6]] as number[]);
    const ys = tris.flatMap((t) => [t.p[1], t.p[4], t.p[7]] as number[]);
    expect(Math.min(...xs)).toBeCloseTo(-0.06, 12);
    expect(Math.max(...xs)).toBeCloseTo(0.06, 12);
    expect(Math.min(...ys)).toBeCloseTo(-0.1, 12);
    expect(Math.max(...ys)).toBeCloseTo(0.1, 12);
  });
});
