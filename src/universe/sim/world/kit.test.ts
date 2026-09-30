import { describe, expect, it } from 'vitest';
import { TAU } from '../math';
import {
  box,
  brg,
  centroidOf,
  cone,
  corner,
  cyl,
  dome,
  dot,
  normalOf,
  poly,
  prism,
  PRISM,
  quad,
  ring,
  RING,
  rotm,
  mulM,
  rq,
  sub,
  tri,
  xf,
  type Tri,
  type Vec2,
  type Vec3,
} from './kit';

// The kit's triangle counts are the vocabulary's (section 4.2): every body's budget is a sum of
// them, and tests/world-bodies.test.ts pins those sums.

const RED: Vec3 = [1, 0, 0];
const BLUE: Vec3 = [0, 0, 1];

/** Every triangle of a closed solid round the origin faces away from it. */
const facesOut = (tris: readonly Tri[], centre: Vec3 = [0, 0, 0]): boolean =>
  tris.every((t) => dot(normalOf(t), sub(centroidOf(t), centre)) > -1e-9);

const square: Vec2[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

describe('the kit', () => {
  it('makes a box of 12 triangles, all facing out', () => {
    const tris = box(1, 2, 3, RED);
    expect(tris).toHaveLength(12);
    expect(facesOut(tris)).toBe(true);
    expect(tris.every((t) => t.c === RED && t.g === 0)).toBe(true);
  });

  it('makes a capped cylinder of 4 x sides, coloured bottom, side, top', () => {
    const tris = cyl(0.5, -1, 1, 6, RED, BLUE, RED);
    expect(tris).toHaveLength(24);
    expect(facesOut(tris)).toBe(true);
    expect(tris.filter((t) => t.c[2] === 1)).toHaveLength(12);
  });

  it('makes a cone of 2 x sides and a frustum of 4 x sides', () => {
    expect(cone(0.5, 0, 0, 1, 8, RED)).toHaveLength(16);
    expect(cone(0.5, 0.2, 0, 1, 8, RED)).toHaveLength(32);
    expect(facesOut(cone(0.5, 0.2, -0.5, 0.5, 8, RED))).toBe(true);
  });

  it('makes a dome of 48 triangles for 8 sides and 3 steps', () => {
    const tris = dome(1, 8, 3, RED);
    expect(tris).toHaveLength(48);
    expect(facesOut(tris)).toBe(true);
    const ys = tris.flatMap((t) => [t.p[1], t.p[4], t.p[7]] as number[]);
    expect(Math.min(...ys)).toBeCloseTo(0, 6);
    expect(Math.max(...ys)).toBeCloseTo(1, 6);
  });

  it('extrudes a prism: 4n - 4 solid, n - 2 flat, and faces its hint', () => {
    expect(prism(square, 0, 1, RED)).toHaveLength(12);
    const hexagon = Array.from({ length: 6 }, (_, i): Vec2 => brg((i / 6) * TAU, 1));
    expect(prism(hexagon, -0.5, 0.5, RED)).toHaveLength(20);
    expect(facesOut(prism(hexagon, -0.5, 0.5, RED))).toBe(true);
    expect(prism(hexagon, 0, 0, RED)).toHaveLength(4);
    expect(prism(hexagon, 0, 0, RED).every((t) => normalOf(t)[1] > 0.999)).toBe(true);
    // No bottom, no walls, a fanned top: the counts a glyph and a tick are made of.
    expect(prism(square, 0, 1, RED, RED, RED, PRISM.noBottom)).toHaveLength(10);
    expect(prism(square, 0, 1, RED, RED, RED, PRISM.noWalls)).toHaveLength(4);
    expect(prism(square, 0, 1, RED, RED, RED, PRISM.fanTop)).toHaveLength(14);
  });

  it('sweeps a ring: 2 a step flat, 8 a step solid, 4 more for an arc’s ends', () => {
    expect(ring([1, 1.2], 0, TAU, 12, 0, 0, RED)).toHaveLength(24);
    expect(ring([1, 1.2], 0, TAU, 12, 0, 0, RED, RED, RING.flatUnderside)).toHaveLength(48);
    expect(ring([1, 1.2], 0, TAU, 12, 0, 0.1, RED)).toHaveLength(96);
    expect(ring([1, 1.2], 0, 1, 6, 0, 0.1, RED)).toHaveLength(52);
    expect(ring([1, 1.2], 0, TAU, 12, 0, 0.1, RED, RED, RING.noUnderside)).toHaveLength(72);
    expect(
      facesOut(ring([1, 1.2], 0, TAU, 24, 0, 0.1, RED).filter((t) => normalOf(t)[1] > 0.5)),
    ).toBe(true);
  });

  it('takes a ring’s radii as a function of the bearing, and its colours in turn', () => {
    const wave = ring((b) => [1, 1.2 + 0.1 * Math.sin(4 * b)], 0, TAU, 16, 0, 0, [RED, BLUE]);
    expect(wave).toHaveLength(32);
    expect(wave.map((t) => t.c)).toEqual(
      Array.from({ length: 16 }, (_, i) => [i % 2 ? BLUE : RED, i % 2 ? BLUE : RED]).flat(),
    );
  });

  it('lays a trapezoid of 10 triangles (or 2 when it is flat) along a bearing', () => {
    expect(rq(0.3, 1, 1.4, 0.05, 0.02, 0, 0.05, RED)).toHaveLength(10);
    expect(rq(0.3, 1, 1.4, 0.05, 0.02, 0, 0.001, RED)).toHaveLength(2);
    // North is -Z, and bearings go clockwise seen from above.
    const [x, z] = brg(Math.PI / 2, 2);
    expect(x).toBeCloseTo(2, 12);
    expect(z).toBeCloseTo(0, 12);
    expect(brg(0, 1)[1]).toBe(-1);
  });

  it('turns a face toward its hint whatever order its corners came in', () => {
    const a: Vec3 = [0, 0, 0];
    const b: Vec3 = [1, 0, 0];
    const c: Vec3 = [0, 0, 1];
    for (const hint of [
      [0, 1, 0],
      [0, -1, 0],
    ] as Vec3[]) {
      for (const t of [...tri(a, b, c, RED, hint), ...tri(a, c, b, RED, hint)]) {
        expect(dot(normalOf(t), hint)).toBeGreaterThan(0.999);
      }
    }
    expect(quad(a, b, [1, 0, 1], c, RED, [0, 1, 0])).toHaveLength(2);
    expect(
      poly(
        Array.from({ length: 7 }, (_, i): Vec3 => [Math.cos(i), 0, Math.sin(i)]),
        RED,
      ),
    ).toHaveLength(5);
  });

  it('moves, turns and scales triangles, scale first and move last', () => {
    const [t] = xf(tri([1, 0, 0], [0, 1, 0], [0, 0, 1], RED), {
      at: [10, 0, 0],
      rot: [0, Math.PI / 2, 0],
      s: 2,
    });
    if (!t) throw new Error('no triangle');
    const turn = rotm(0, Math.PI / 2, 0);
    const expected = mulM(turn, [2, 0, 0]);
    const first = corner(t, 0);
    [0, 1, 2].forEach((i) =>
      expect(first[i]).toBeCloseTo((expected[i] ?? 0) + (i === 0 ? 10 : 0), 12),
    );
    // A per-axis scale, and nothing at all.
    const [flat] = xf(tri([1, 1, 1], [0, 1, 0], [0, 0, 1], RED), { s: [1, 0, 1] });
    expect(flat?.p.filter((_, i) => i % 3 === 1)).toEqual([0, 0, 0]);
    const plain = tri([1, 1, 1], [0, 1, 0], [0, 0, 1], RED);
    expect(xf(plain)).toEqual(plain);
  });

  it('turns about X, then Y, then Z', () => {
    const p = mulM(rotm(Math.PI / 2, Math.PI / 2, 0), [0, 1, 0]);
    // Y up turned a quarter about X points along +Z, and that a quarter about Y along +X.
    expect(p[0]).toBeCloseTo(1, 12);
    expect(p[1]).toBeCloseTo(0, 12);
    expect(p[2]).toBeCloseTo(0, 12);
  });
});
