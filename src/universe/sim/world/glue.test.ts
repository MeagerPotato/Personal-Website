import { describe, expect, it } from 'vitest';
import { assemble, callsOf, groundDetail, pack, wire } from './glue';
import { box, centroidOf, dot, type Vec3 } from './kit';
import type { MotionRow } from './motion';
import { FLAG, make, pivotOf, toPivot, type BodyRecipe, type Item } from './rows';

// The glue turns a build into its draw groups: at most two calls for a body at rest.

const BOX: Item = ['box', 0.2, 0.2, 0.2, 'ink.high'];
const RAISED: Item = ['s', 30, 60, { alt: 0.1 }, BOX];
const recipe: BodyRecipe = {
  rows: [
    {},
    ['on-ground', 0, RAISED],
    ['level', FLAG.hold, ['g', BOX, { at: [0, 1.5, 0] }]],
    ['plan', FLAG.ghost, ['g', BOX, { at: [1.5, 0, 0] }]],
    ['lamp', FLAG.glow, ['bead', 0.1, 'star.warm', { at: [0, -1.5, 0] }]],
  ],
};
const build = make('t', recipe, { detail: 1 });

describe('the glue', () => {
  it('splits a turning body into what turns and what holds, plus the ghost’s edges', () => {
    const a = assemble(build, { kind: 'planet' });
    // Ground 80, the part on the ground 12, the lamp 8 turn; the level part and the ghost hold.
    expect(a.turn.triangleCount).toBe(80 + 12 + 8 + 12);
    expect(a.hold.triangleCount).toBe(12);
    // A box has twelve feature edges, each once.
    expect(a.edges.length).toBe(12 * 6);
    expect(a.movers).toEqual([]);
    expect(callsOf(a)).toBe(3);
  });

  it('holds everything of a body that does not turn', () => {
    for (const a of [
      assemble(build, { kind: 'sun' }),
      assemble(build, { kind: 'planet', still: true }),
    ]) {
      expect(a.turn.triangleCount).toBe(0);
      expect(a.hold.triangleCount).toBe(124);
      expect(callsOf(a)).toBe(2);
    }
  });

  it('draws the low tier as one group, the edges aside', () => {
    const a = assemble(build, { kind: 'planet', low: true });
    expect(a.turn.triangleCount).toBe(124);
    expect(a.hold.triangleCount).toBe(0);
    expect(callsOf(a)).toBe(2);
  });

  it('gives a moving part a mesh of its own, about its pivot', () => {
    const motion: MotionRow[] = [['on-ground', 'rot', 'y', 'sine', 0.1, 8]];
    const still = assemble(build, { kind: 'planet', motion });
    expect(still.movers).toEqual([]);
    const a = assemble(build, { kind: 'planet', motion, moving: true });
    expect(a.turn.triangleCount).toBe(80 + 8 + 12);
    const [mover] = a.movers;
    expect(mover?.name).toBe('on-ground');
    expect(mover?.mesh.triangleCount).toBe(12);
    // In its own frame the box sits on its pivot, and back in the body's it is where it was.
    const pivot = pivotOf([RAISED]);
    expect(mover?.pivot).toEqual(pivot);
    const xs = Array.from(mover?.mesh.positions ?? []);
    const mid = [0, 1, 2].map(
      (k) => xs.filter((_, i) => i % 3 === k).reduce((s, v) => s + v, 0) / (xs.length / 3),
    );
    mid.forEach((v) => expect(v).toBeCloseTo(0, 5));
    const part = build.parts.find((p) => p.name === 'on-ground');
    const first = part?.tris[0]?.p ?? [];
    const local = toPivot([first[0] ?? 0, first[1] ?? 0, first[2] ?? 0], pivot);
    local.forEach((v, i) => expect(mover?.mesh.positions[i]).toBeCloseTo(v, 5));
  });

  it('moves the whole body as one mesh first when a row says *', () => {
    const motion: MotionRow[] = [
      ['*', 'rot', 'z', 'sine', 0.12, 12],
      ['lamp', 'rot', 'y', 'sine', 0.1, 8],
    ];
    const a = assemble(build, { kind: 'moon', still: true, motion, moving: true });
    expect(a.movers.map((m) => [m.name, m.mesh.triangleCount])).toEqual([
      ['*', 80 + 12 + 12 + 12],
      ['lamp', 8],
    ]);
    expect(a.turn.triangleCount + a.hold.triangleCount).toBe(0);
    expect(callsOf(a)).toBe(3);
  });

  it('leaves out of the still a part that only exists while it plays', () => {
    const motion: MotionRow[] = [['lamp', 'scale', '*', 'hill', 1, 20]];
    expect(assemble(build, { kind: 'planet', motion }).turn.triangleCount).toBe(80 + 12 + 12);
    expect(assemble(build, { kind: 'planet', motion, moving: true }).movers).toHaveLength(1);
  });

  it('draws the close-up parts only when asked', () => {
    const near = make('t', recipe, { detail: 1, near: [['close', 0, BOX]] });
    expect(assemble(near, { kind: 'planet' }).turn.triangleCount).toBe(112);
    expect(assemble(near, { kind: 'planet', near: true }).turn.triangleCount).toBe(124);
  });

  it('packs buffers with a flat normal facing out and the lighting on every vertex', () => {
    const packed = pack(
      make('t', { rows: [[BOX, ['bead', 0.1, 'star.warm', { g: 2 }]]] }, { detail: 0 }).ground,
    );
    expect(packed.triangleCount).toBe(20);
    expect(packed.positions).toHaveLength(180);
    const tris = box(0.2, 0.2, 0.2, [1, 1, 1]);
    for (let i = 0; i < 12; i += 1) {
      const n: Vec3 = [
        packed.normals[i * 9] ?? 0,
        packed.normals[i * 9 + 1] ?? 0,
        packed.normals[i * 9 + 2] ?? 0,
      ];
      const t = tris[i];
      if (t) expect(dot(n, centroidOf(t))).toBeGreaterThan(0);
      expect(packed.normals.slice(i * 9, i * 9 + 3)).toEqual(
        packed.normals.slice(i * 9 + 6, i * 9 + 9),
      );
    }
    expect(Array.from(packed.unlit.slice(0, 36)).every((g) => g === 0)).toBe(true);
    expect(Array.from(packed.unlit.slice(36)).every((g) => g === 2)).toBe(true);
  });

  it('draws only the feature edges of a smooth surface', () => {
    // A flat tile: its outline, not its inner diagonals.
    const tile = make('t', { rows: [[['tile', 1, 6, 'ink.high']]] }, { detail: 0 }).ground;
    expect(wire(tile).length).toBe(6 * 6);
  });

  it('gives each kind of body its ground detail', () => {
    expect(groundDetail('planet', false, false)).toBe(8);
    expect(groundDetail('home', false, true)).toBe(14);
    expect(groundDetail('planet', true, true)).toBe(6);
    expect(groundDetail('moon', false, true)).toBe(3);
    expect(groundDetail('moon', true, false)).toBe(3);
    expect(groundDetail('sun', false, true)).toBe(4);
    expect(groundDetail('station', false, false)).toBe(0);
  });
});
