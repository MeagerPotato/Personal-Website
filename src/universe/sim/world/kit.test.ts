import { describe, expect, it } from 'vitest';
import { TAU } from '../math';
import { ROUND_FROM } from '../meshBuilder';
import {
  AS_WRITTEN,
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
  sidesFor,
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

  // --- round or edged --------------------------------------------------------------------------

  /** The normal a triangle carries at corner `v`. */
  const carried = (t: Tri, v: number): Vec3 => corner({ ...t, p: Array.from(t.n ?? []) }, v);

  it('says once what is round: a lathe of five sides or more carries its curve, the rest nothing', () => {
    for (const round of [
      cyl(1, 0, 1, ROUND_FROM, RED),
      cone(1, 0, 0, 1, 12, RED),
      dome(1, 8, 3, RED),
    ])
      expect(round.every((t) => t.n?.length === 9)).toBe(true);
    for (const edged of [
      cyl(1, 0, 1, 4, RED),
      cone(1, 0, 0, 1, 4, RED),
      box(1, 1, 1, RED),
      prism(square, 0, 1, RED),
      rq(0, 0.5, 1, 0.1, 0.05, 0, 0.1, RED),
      quad([0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], RED),
    ])
      expect(edged.every((t) => t.n === undefined)).toBe(true);
  });

  it('lights a tube straight out from its axis, standing on +Y, and its caps flat', () => {
    for (const t of cyl(0.5, 0, 2, 12, RED)) {
      for (let v = 0; v < 3; v += 1) {
        const [x, , z] = corner(t, v);
        const n = carried(t, v);
        if (Math.abs(normalOf(t)[1]) > 0.5) expect(dot(n, normalOf(t))).toBeCloseTo(1, 6);
        else {
          expect(n[0]).toBeCloseTo(x / 0.5, 5);
          expect(n[1]).toBeCloseTo(0, 5);
          expect(n[2]).toBeCloseTo(z / 0.5, 5);
        }
      }
    }
  });

  it('lights a dome as the half ball it is: every normal straight out, its pole straight up', () => {
    for (const t of dome(1, 16, 4, RED).filter((d) => centroidOf(d)[1] > 1e-6)) {
      for (let v = 0; v < 3; v += 1) {
        const at = corner(t, v);
        expect(dot(carried(t, v), at)).toBeGreaterThan(Math.cos(Math.PI / 16) - 1e-6);
        if (at[1] > 0.9999) expect(carried(t, v)[1]).toBeCloseTo(1, 6);
      }
    }
  });

  it('builds a circle with the sides its size wants, and never fewer than were written', () => {
    const fine = { sag: 0.0025, max: 64 };
    // The middle of a side stays within the sag of the true circle.
    for (const r of [0.03, 0.1, 0.29, 1, 1.4]) {
      const n = sidesFor(r, 6, fine);
      expect(r * (1 - Math.cos(Math.PI / n))).toBeLessThanOrEqual(fine.sag * 1.001);
      expect(r * (1 - Math.cos(Math.PI / (n - 2)))).toBeGreaterThan(fine.sag * 0.7);
    }
    expect(sidesFor(0.29, 8, fine)).toBe(24);
    expect(sidesFor(0.001, 12, fine)).toBe(12);
    expect(sidesFor(50, 8, fine)).toBe(64);
    // A square stays a square, a pyramid a pyramid; and as written, nothing grows.
    expect(sidesFor(1, 4, fine)).toBe(4);
    expect(sidesFor(1, 3, fine)).toBe(3);
    expect(sidesFor(1, 8, AS_WRITTEN)).toBe(8);
  });

  it('carries a normal through a move, a turn and a squash', () => {
    const [side] = cyl(1, 0, 1, 12, RED).filter((t) => Math.abs(normalOf(t)[1]) < 0.5);
    if (!side) throw new Error('fixture');
    // Moved: unchanged. Turned: turned with it.
    expect(carried(xf([side], { at: [3, 4, 5] })[0] ?? side, 0)).toEqual(carried(side, 0));
    const turned = xf([side], { rot: [0, 0, Math.PI / 2] })[0] ?? side;
    const was = carried(side, 0);
    expect(carried(turned, 0)[0]).toBeCloseTo(-was[1], 6);
    expect(carried(turned, 0)[1]).toBeCloseTo(was[0], 6);
    // Squashed along x: the tube is an ellipse, and its normal leans toward the squashed axis.
    const squashed = xf(cyl(1, 0, 1, 24, RED), { s: [0.5, 1, 1] });
    for (const t of squashed.filter((q) => Math.abs(normalOf(q)[1]) < 0.5)) {
      for (let v = 0; v < 3; v += 1) {
        const [x, , z] = corner(t, v);
        const n = carried(t, v);
        expect(Math.hypot(...n)).toBeCloseTo(1, 6);
        // The ellipse x^2 / 0.25 + z^2 = 1: its gradient is (x / 0.25, z).
        const g = Math.hypot(x / 0.25, z);
        expect(n[0]).toBeCloseTo(x / 0.25 / g, 5);
        expect(n[2]).toBeCloseTo(z / g, 5);
      }
    }
  });

  it("lights a hoop's walls as one curve, out from its axis and in toward it", () => {
    const hoop = ring([1, 1.2], 0, TAU, 24, 0, 0.1, RED);
    const walls = hoop.filter((t) => Math.abs(normalOf(t)[1]) < 0.5);
    expect(walls).toHaveLength(96);
    expect(hoop.filter((t) => Math.abs(normalOf(t)[1]) > 0.5).every((t) => !t.n)).toBe(true);
    for (const t of walls) {
      for (let v = 0; v < 3; v += 1) {
        const [x, , z] = corner(t, v);
        const r = Math.hypot(x, z);
        const outer = r > 1.1;
        const n = carried(t, v);
        expect(n[0]).toBeCloseTo(((outer ? 1 : -1) * x) / r, 5);
        expect(n[2]).toBeCloseTo(((outer ? 1 : -1) * z) / r, 5);
      }
    }
    // An arc swept the other way round faces the same way.
    for (const t of ring([1, 1.2], 1, 0, 6, 0, 0.1, RED).filter((w) => w.n)) {
      const [x, , z] = centroidOf(t);
      expect(dot(carried(t, 0), [x, 0, z]) > 0).toBe(Math.hypot(x, z) > 1.1);
    }
  });

  it('keeps a block of one step flat, and a fold in a wall an edge', () => {
    // A stand of a stadium: one step.
    expect(ring([0.56, 0.84], 0, TAU / 16, 1, 0.5, 1.1, RED).every((t) => !t.n)).toBe(true);
    // A square wave of radius: its risers are folds of 90 degrees, and stay sharp.
    const teeth = ring(
      (b) => [1, Math.floor((b / TAU) * 16) % 2 ? 1.6 : 1.2],
      0,
      TAU,
      64,
      0,
      0.1,
      RED,
    );
    const outer = teeth.filter((t) => t.n && Math.hypot(centroidOf(t)[0], centroidOf(t)[2]) > 1.1);
    const sharp = outer.filter((t) =>
      [0, 1, 2].every((v) => dot(carried(t, v), normalOf(t)) > 0.999),
    );
    expect(sharp.length).toBeGreaterThan(0);
    for (const t of outer)
      for (let v = 0; v < 3; v += 1) expect(dot(carried(t, v), normalOf(t))).toBeGreaterThan(0.9);
  });

  it('paints a ring built finer than it was written where it was painted', () => {
    const coarse = ring([1, 1.2], 0, TAU, 4, 0, 0, [RED, BLUE]);
    const fine = ring([1, 1.2], 0, TAU, 12, 0, 0, [RED, BLUE], RED, 0, 3);
    expect(coarse.map((t) => t.c)).toEqual([RED, RED, BLUE, BLUE, RED, RED, BLUE, BLUE]);
    expect(fine.map((t) => t.c)).toEqual(coarse.flatMap((t) => [t.c, t.c, t.c]));
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
