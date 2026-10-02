import { describe, expect, it } from 'vitest';
import { tuning } from '../../design/tuning';
import {
  assemble,
  assembling,
  callsOf,
  fineOf,
  groundDetail,
  pack,
  turnsOf,
  wire,
  type Assembly,
  type Packed,
} from './glue';
import type { GroundLooks } from './ground';
import { box, centroidOf, cyl, dot, type Vec3 } from './kit';
import type { MotionRow } from './motion';
import { colorOf } from './palette';
import { FLAG, fromPivot, make, pivotOf, toPivot, type BodyRecipe, type Item } from './rows';

// The glue turns a build into its draw groups: at most two calls for a body at rest, plus the
// edge lines of its ghosts, each riding with what it outlines.

const LOOKS: GroundLooks = { planet: tuning.planet, terrain: tuning.terrain, sun: tuning.look.sun };
const BOX: Item = ['box', 0.2, 0.2, 0.2, 'ink.high'];
const RAISED: Item = ['s', 30, 60, { alt: 0.1 }, BOX];
const PLAN: Item = ['g', BOX, { at: [1.5, 0, 0] }];
const recipe = (planFlags: number = FLAG.ghost): BodyRecipe => ({
  rows: [
    {},
    ['on-ground', 0, RAISED],
    ['level', FLAG.hold, ['g', BOX, { at: [0, 1.5, 0] }]],
    ['plan', planFlags, PLAN],
    ['lamp', FLAG.glow, ['bead', 0.1, 'star.warm', { at: [0, -1.5, 0] }]],
  ],
  ghost: 'coral',
});
const build = make('t', recipe(), { detail: 1, looks: LOOKS });
/** A box has twelve feature edges, each once: two vertices of three numbers each. */
const BOX_EDGES = 12 * 6;

/** A colour as the buffers hold it. */
const f32 = (path: Parameters<typeof colorOf>[0]): number[] =>
  Array.from(new Float32Array(colorOf(path)));
/** The colour and the centre of each triangle of a packed group. */
function trianglesOf(packed: Packed): { color: number[]; centre: Vec3 }[] {
  return Array.from({ length: packed.triangleCount }, (_, i) => {
    const at = (k: number): number => packed.positions[i * 9 + k] ?? NaN;
    return {
      color: Array.from(packed.colors.slice(i * 9, i * 9 + 3)),
      centre: [
        (at(0) + at(3) + at(6)) / 3,
        (at(1) + at(4) + at(7)) / 3,
        (at(2) + at(5) + at(8)) / 3,
      ],
    };
  });
}

describe('the glue', () => {
  it('splits a turning body into what turns and what holds, and outlines its ghost where it is', () => {
    const a = assemble(build, { kind: 'planet' });
    // Ground 80, the part on the ground 12, the ghost 12 and the lamp 24 turn; the level part holds.
    expect(a.turn.triangleCount).toBe(80 + 12 + 12 + 24);
    expect(a.hold.triangleCount).toBe(12);
    expect(a.edges.turn.length).toBe(BOX_EDGES);
    expect(a.edges.hold.length).toBe(0);
    expect(a.edges.color).toEqual(colorOf('coral.base'));
    expect(a.movers).toEqual([]);
    expect(callsOf(a)).toBe(3);
  });

  it('packs a ghost as a navy blueprint, whatever its rows painted it', () => {
    const tris = trianglesOf(assemble(build, { kind: 'planet' }).turn);
    const ghost = tris.filter(({ centre }) => centre[0] > 1.3);
    expect(ghost).toHaveLength(12);
    for (const { color } of ghost) expect(color).toEqual(f32('space.700'));
    // Everything else keeps its own colour: the boxes are ink, the ground is not navy.
    const rest = tris.filter(({ centre }) => centre[0] <= 1.3);
    expect(rest.some(({ color }) => String(color) === String(f32('space.700')))).toBe(false);
    expect(rest.filter(({ color }) => String(color) === String(f32('ink.high')))).toHaveLength(12);
    // The build itself keeps the colours its rows gave it: a part turns solid by losing its flag.
    const part = build.parts.find((p) => p.name === 'plan');
    expect(part?.tris.every((t) => String(t.c) === String(colorOf('ink.high')))).toBe(true);
  });

  it('holds a held ghost’s edges with it', () => {
    const held = make('t', recipe(FLAG.hold | FLAG.ghost), { detail: 1, looks: LOOKS });
    const a = assemble(held, { kind: 'planet' });
    expect(a.hold.triangleCount).toBe(24);
    expect(a.edges.turn.length).toBe(0);
    expect(a.edges.hold.length).toBe(BOX_EDGES);
    expect(callsOf(a)).toBe(3);
  });

  it('has no edge colour for a body with no ghost family, and no lines for one with no ghost', () => {
    const plain = make('t', { rows: [{}, ['a', 0, BOX]] }, { detail: 1, looks: LOOKS });
    const a = assemble(plain, { kind: 'planet' });
    expect(a.edges).toEqual({ turn: new Float32Array(), hold: new Float32Array(), color: null });
    expect(callsOf(a)).toBe(1);
  });

  it('holds everything of a body that does not turn', () => {
    for (const a of [
      assemble(build, { kind: 'sun' }),
      assemble(build, { kind: 'planet', still: true }),
    ]) {
      expect(a.turn.triangleCount).toBe(0);
      expect(a.hold.triangleCount).toBe(140);
      expect(a.edges.turn.length).toBe(0);
      expect(a.edges.hold.length).toBe(BOX_EDGES);
      expect(callsOf(a)).toBe(2);
    }
  });

  it('draws the low tier as one held group: nothing turns and nothing moves', () => {
    const motion: MotionRow[] = [
      ['on-ground', 'rot', 'y', 'sine', 0.1, 8],
      ['lamp', 'scale', '*', 'hill', 1, 20],
    ];
    for (const moving of [false, true]) {
      const a = assemble(build, { kind: 'planet', low: true, moving, motion });
      expect(a.turn.triangleCount).toBe(0);
      // The still: the lamp only exists while it plays.
      expect(a.hold.triangleCount).toBe(124 - 8);
      expect(a.movers).toEqual([]);
      expect(a.edges.turn.length).toBe(0);
      expect(a.edges.hold.length).toBe(BOX_EDGES);
      expect(callsOf(a)).toBe(2);
    }
  });

  it('gives a moving part a mesh of its own, about its pivot, in the group its part is in', () => {
    const motion: MotionRow[] = [
      ['on-ground', 'rot', 'y', 'sine', 0.1, 8],
      ['level', 'rot', 'y', 'sine', 0.1, 8],
    ];
    const still = assemble(build, { kind: 'planet', motion });
    expect(still.movers).toEqual([]);
    const a = assemble(build, { kind: 'planet', motion, moving: true });
    expect(a.turn.triangleCount).toBe(80 + 12 + 24);
    expect(a.hold.triangleCount).toBe(0);
    expect(a.movers.map((m) => [m.name, m.group, m.mesh.triangleCount])).toEqual([
      ['on-ground', 'turn', 12],
      ['level', 'hold', 12],
    ]);
    // In its own frame the box sits on its pivot, and back in the body's it is where it was.
    const [mover] = a.movers;
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
    // On a body that does not turn, nothing it carries turns either.
    const sun = assemble(build, { kind: 'sun', motion, moving: true });
    expect(sun.movers.map((m) => m.group)).toEqual(['hold', 'hold']);
  });

  it('carries a moving ghost’s edges on its mover, in its own frame', () => {
    const motion: MotionRow[] = [['plan', 'rot', 'y', 'sine', 0.1, 8]];
    const a = assemble(build, { kind: 'planet', motion, moving: true });
    expect(a.edges.turn.length).toBe(0);
    const [mover] = a.movers;
    expect(mover?.name).toBe('plan');
    expect(mover?.group).toBe('turn');
    expect(mover?.edges.length).toBe(BOX_EDGES);
    // Back in the body's frame, they are the edges of the still.
    const back = Array.from({ length: (mover?.edges.length ?? 0) / 3 }, (_, i) =>
      fromPivot(
        [mover?.edges[i * 3] ?? 0, mover?.edges[i * 3 + 1] ?? 0, mover?.edges[i * 3 + 2] ?? 0],
        mover?.pivot ?? pivotOf([]),
      ),
    ).flat();
    const still = assemble(build, { kind: 'planet' }).edges.turn;
    back.forEach((v, i) => expect(v).toBeCloseTo(still[i] ?? NaN, 5));
  });

  it('moves the whole body as one mesh first when a row says *, and every ghost edge rides it', () => {
    const motion: MotionRow[] = [
      ['*', 'rot', 'z', 'sine', 0.12, 12],
      ['lamp', 'rot', 'y', 'sine', 0.1, 8],
    ];
    const a = assemble(build, { kind: 'moon', still: true, motion, moving: true });
    expect(a.movers.map((m) => [m.name, m.group, m.mesh.triangleCount])).toEqual([
      ['*', 'hold', 80 + 12 + 12 + 12],
      ['lamp', 'hold', 24],
    ]);
    expect(a.turn.triangleCount + a.hold.triangleCount).toBe(0);
    expect(a.edges.turn.length + a.edges.hold.length).toBe(0);
    const still = assemble(build, { kind: 'moon', still: true, motion });
    expect(a.movers[0]?.edges).toEqual(still.edges.hold);
    // Two meshes and the lines on the whole one.
    expect(callsOf(a)).toBe(3);
  });

  it('refuses a whole-body motion on a body that turns', () => {
    const motion: MotionRow[] = [['*', 'rot', 'z', 'sine', 0.12, 12]];
    expect(() => assemble(build, { kind: 'planet', motion, moving: true })).toThrow(/still/);
    expect(() => assemble(build, { kind: 'planet', motion })).not.toThrow();
  });

  it('leaves out of the still a part that only exists while it plays, and its edges', () => {
    const lamp: MotionRow[] = [['lamp', 'scale', '*', 'hill', 1, 20]];
    expect(assemble(build, { kind: 'planet', motion: lamp }).turn.triangleCount).toBe(80 + 12 + 12);
    expect(assemble(build, { kind: 'planet', motion: lamp, moving: true }).movers).toHaveLength(1);
    const plan: MotionRow[] = [['plan', 'scale', '*', 'hill', 1, 20]];
    const a = assemble(build, { kind: 'planet', motion: plan });
    expect(a.turn.triangleCount).toBe(80 + 12 + 24);
    expect(a.edges.turn.length).toBe(0);
  });

  it('draws the close-up parts only when asked', () => {
    const near = make('t', recipe(), { detail: 1, looks: LOOKS, near: [['close', 0, BOX]] });
    expect(assemble(near, { kind: 'planet' }).turn.triangleCount).toBe(128);
    expect(assemble(near, { kind: 'planet', near: true }).turn.triangleCount).toBe(140);
  });

  it('packs buffers with a flat normal facing out and the lighting on every vertex', () => {
    const packed = pack(
      make(
        't',
        { rows: [[BOX, ['bead', 0.1, 'star.warm', { g: 2 }]]] },
        { detail: 0, looks: LOOKS },
      ).ground,
    );
    expect(packed.triangleCount).toBe(36);
    expect(packed.positions).toHaveLength(324);
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
    expect(Array.from(packed.decal).every((d) => d === 0)).toBe(true);
  });

  it('packs a ground as the ball it is, and rounds a part where it is round', () => {
    const made = make(
      't',
      {
        rows: [
          { biome: 'primer', paint: [['band', 0, 0.5, 'coral.base']] },
          ['post', 0, ['cyl', 0.2, 1, 1.5, 12, 'ink.high']],
        ],
      },
      { detail: 3, looks: LOOKS },
    );
    const { turn } = assemble(made, { kind: 'planet' });
    expect(turn.triangleCount).toBe(320 + 48);
    expect(turn.sides).toHaveLength(turn.triangleCount * 24);
    // How the lines bend, four numbers a vertex: the band's edge is a circle round the ball, so
    // it is an arc in the facets it crosses, and nothing bends on the post.
    expect(turn.bends).toHaveLength(turn.triangleCount * 12);
    expect(turn.bends.subarray(0, 320 * 12).some((value) => value !== 0)).toBe(true);
    expect(turn.bends.subarray(320 * 12).every((value) => value === 0)).toBe(true);
    // The ground: at radius 1, so its normals are its positions; and the paint's edge runs
    // through the facets on the equator, which carry both colours.
    for (let i = 0; i < 320 * 9; i += 1)
      expect(turn.normals[i]).toBeCloseTo(turn.positions[i] ?? NaN, 5);
    const own = (t: number): string => String(Array.from(turn.colors.slice(t * 9, t * 9 + 3)));
    const colours = new Set(Array.from({ length: 320 }, (_, t) => own(t)));
    expect(colours.size).toBe(2);
    expect(colours.has(String(f32('coral.base')))).toBe(true);
    let split = 0;
    for (let t = 0; t < 320; t += 1) {
      const side = turn.sides.subarray(t * 24, t * 24 + 24);
      if (side.every((value) => value === 0)) continue;
      split += 1;
      // The other of the two colours, and no third.
      const second = String(Array.from(side.slice(0, 3)));
      expect(colours.has(second) && second !== own(t)).toBe(true);
      expect(Array.from(side.slice(4, 8))).toEqual([0, 0, 0, 0]);
    }
    expect(split).toBeGreaterThan(0);
    // The post: no second colour; its side is lit as a cylinder (normals straight out from its
    // axis), its caps are flat.
    for (let v = 320 * 3; v < turn.triangleCount * 3; v += 1) {
      expect(Array.from(turn.sides.subarray(v * 8, v * 8 + 8))).toEqual(new Array(8).fill(0));
      const [x, y, z] = [
        turn.positions[v * 3] ?? 0,
        turn.positions[v * 3 + 1] ?? 0,
        turn.positions[v * 3 + 2] ?? 0,
      ];
      const n = turn.normals.subarray(v * 3, v * 3 + 3);
      if (Math.abs(n[1] ?? 0) > 0.5) expect(Math.abs(n[1] ?? 0)).toBeCloseTo(1, 5);
      else if (Math.hypot(x, z) > 0.1) {
        expect(n[0]).toBeCloseTo(x / 0.2, 4);
        expect(n[2]).toBeCloseTo(z / 0.2, 4);
      }
      expect(y).toBeGreaterThan(0.99);
    }
  });

  it('marks every vertex of a decal part, in the same group as the rest', () => {
    const decal = make(
      't',
      { rows: [{}, ['grid', FLAG.decal, RAISED], ['plain', 0, BOX]] },
      { detail: 1, looks: LOOKS },
    );
    const { turn } = assemble(decal, { kind: 'planet' });
    expect(turn.triangleCount).toBe(80 + 12 + 12);
    expect(turn.decal).toHaveLength(turn.triangleCount * 3);
    // Packed in order: the ground, the decal, the plain box.
    const flags = Array.from(turn.decal);
    expect(flags.slice(0, 80 * 3).every((d) => d === 0)).toBe(true);
    expect(flags.slice(80 * 3, 92 * 3).every((d) => d === 1)).toBe(true);
    expect(flags.slice(92 * 3).every((d) => d === 0)).toBe(true);
  });

  it("turns a round part's normals with it into a mover's frame, and moves none of them", () => {
    // A post lying on its side, far from the middle: its pivot is turned and moved.
    const made = make(
      't',
      { rows: [{}, ['post', 0, ['s', 0, 90, { alt: 0.5 }, ['cyl', 0.2, 0, 1, 12, 'ink.high']]]] },
      { detail: 0, looks: LOOKS },
    );
    const motion: MotionRow[] = [['post', 'rot', 'y', 'sine', 0.1, 8]];
    const [mover] = assemble(made, { kind: 'planet', motion, moving: true }).movers;
    if (!mover) throw new Error('fixture');
    const { positions, normals, triangleCount } = mover.mesh;
    expect(triangleCount).toBe(48);
    for (let v = 0; v < triangleCount * 3; v += 1) {
      const [x, y, z] = [
        positions[v * 3] ?? 0,
        positions[v * 3 + 1] ?? 0,
        positions[v * 3 + 2] ?? 0,
      ];
      const n = normals.subarray(v * 3, v * 3 + 3);
      expect(Math.hypot(n[0] ?? 0, n[1] ?? 0, n[2] ?? 0)).toBeCloseTo(1, 5);
      // In its own frame the post stands on +Y again: caps along it, the side straight out.
      if (Math.abs(n[1] ?? 0) > 0.5) expect(Math.abs(n[1] ?? 0)).toBeCloseTo(1, 5);
      else if (Math.hypot(x, z) > 0.1) {
        expect(n[0]).toBeCloseTo(x / 0.2, 4);
        expect(n[2]).toBeCloseTo(z / 0.2, 4);
      }
      expect(y).toBeGreaterThan(-1e-6);
    }
  });

  it('lights an edged part by its faces and a round one by its curve, in one buffer', () => {
    const packed = pack([...box(0.2, 0.2, 0.2, [1, 1, 1]), ...cyl(0.2, 0, 1, 12, [1, 1, 1])]);
    // The box: three corners, one normal. The tube's side: a normal a corner.
    const cornersAlike = (t: number): boolean =>
      String(packed.normals.slice(t * 9, t * 9 + 3)) ===
        String(packed.normals.slice(t * 9 + 3, t * 9 + 6)) &&
      String(packed.normals.slice(t * 9, t * 9 + 3)) ===
        String(packed.normals.slice(t * 9 + 6, t * 9 + 9));
    for (let t = 0; t < 12; t += 1) expect(cornersAlike(t)).toBe(true);
    const side = Array.from({ length: 48 }, (_, i) => i + 12).filter(
      (t) => Math.abs(packed.normals[t * 9 + 1] ?? 0) < 0.5,
    );
    expect(side).toHaveLength(24);
    for (const t of side) expect(cornersAlike(t)).toBe(false);
  });

  it('outlines a round ghost by its rims, not by its sides', () => {
    // A tube of twelve sides: two rims of twelve edges, and no line down its side.
    expect(wire(cyl(0.2, 0, 1, 12, [1, 1, 1])).length).toBe(2 * 12 * 6);
    // A post of four sides is a box: its twelve edges.
    expect(wire(cyl(0.2, 0, 1, 4, [1, 1, 1])).length).toBe(BOX_EDGES);
  });

  it('builds finer up close than every day, and coarser on the low tier', () => {
    const { round } = tuning.world;
    expect(fineOf(false, false, round)).toEqual({ sag: round.sagEveryday, max: round.maxSides });
    expect(fineOf(true, false, round).sag).toBe(round.sagNear);
    expect(round.sagNear).toBeLessThan(round.sagEveryday);
    expect(fineOf(true, true, round).sag).toBe(round.sagNear * round.sagLowTimes);
    expect(round.sagLowTimes).toBeGreaterThan(1);
  });

  it('draws only the feature edges of a smooth surface', () => {
    // A flat tile: its outline, not its inner diagonals.
    const tile = make(
      't',
      { rows: [[['tile', 1, 6, 'ink.high']]] },
      { detail: 0, looks: LOOKS },
    ).ground;
    expect(wire(tile).length).toBe(6 * 6);
  });

  it('gives each kind of body its ground detail', () => {
    const { world } = tuning;
    expect(groundDetail('planet', false, false, world)).toBe(world.detailPlanet);
    expect(groundDetail('home', false, true, world)).toBe(world.detailNear);
    expect(groundDetail('home', false, false, world)).toBe(world.detailPlanet);
    // A maquette does not sharpen up close.
    expect(groundDetail('planet', true, true, world)).toBe(world.detailMaquettePlanet);
    expect(groundDetail('planet', true, false, world)).toBe(world.detailMaquettePlanet);
    expect(groundDetail('moon', false, true, world)).toBe(world.detailMoon);
    expect(groundDetail('moon', true, false, world)).toBe(world.detailMaquetteMoon);
    expect(groundDetail('sun', false, true, world)).toBe(world.detailSun);
    for (const hull of ['station', 'satellite', 'link'] as const) {
      expect(groundDetail(hull, false, false, world)).toBe(0);
    }
  });

  it('turns the ground of a planet, a moon and home, unless it is still or on the low tier', () => {
    for (const kind of ['planet', 'moon', 'home'] as const) {
      expect(turnsOf(kind), kind).toBe(true);
      expect(turnsOf(kind, { still: true }), kind).toBe(false);
      expect(turnsOf(kind, { low: true }), kind).toBe(false);
    }
    for (const kind of ['sun', 'station', 'satellite', 'link'] as const) {
      expect(turnsOf(kind), kind).toBe(false);
    }
  });

  it('assembles a slice at a time, into exactly what assemble makes at once', () => {
    const motion: MotionRow[] = [['plan', 'rot', 'y', 'ramp', 1, 10]];
    for (const options of [
      { kind: 'planet' as const },
      { kind: 'planet' as const, near: true, moving: true, motion },
      { kind: 'sun' as const, low: true },
    ]) {
      const job = assembling(build, options);
      let slices = 0;
      let step = job.next();
      while (!step.done) {
        slices += 1;
        step = job.next();
      }
      // It gives way between the groups and between the movers: never one long frame.
      expect(slices).toBeGreaterThanOrEqual(3);
      const whole: Assembly = assemble(build, options);
      expect(step.value).toEqual(whole);
    }
  });
});
