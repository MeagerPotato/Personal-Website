import { TAU } from '../../sim/math';
import { brg, type Vec2, type Vec3 } from '../../sim/world/kit';
import type { ColorPath } from '../../sim/world/palette';
import type { Hull, Item } from '../../sim/world/rows';

/**
 * THE ISLES (docs/DESIGN.md, "Cubes", the worlds as islands, 2026-11-16): a world is a floating
 * island, a diorama cut out of the ground and hung in space, as Allen's reference (a voxel island
 * on a turtle's back) is. Every project's island is the same kit: a grass top, a lip of turf, a
 * band of soil and a root of rock that tapers to a point, boulders round the rim, and what the
 * project is built on top of it. Water falls off the edge where a world has a pond.
 *
 * Modelled at radius 1, as every world is (sim/world/rows.ts), with +Y up. The top is at
 * `TOP`; anything stood on the island stands on `TOP`. What reaches out past the rim in the
 * ship's lane counts against the world's reach (design/worlds/reach.ts), so the rim, its
 * boulders and anything near the edge stay inside 1.1 radii.
 *
 * Everything here is cut into cubes when it is built (sim/voxel.ts): the shapes are drawn
 * smooth, with few sides, and the cubes give them their edges.
 */

/** The height of an island's grass, which everything on it stands on. */
export const TOP = 0.14;

/** A place on the island's top, [x, z], lifted onto the grass (or `dy` above it). */
export const on = (x: number, z: number, dy = 0): Vec3 => [x, TOP + dy, z];

/** A place on the island's top by compass bearing (degrees, clockwise from -Z) and radius. */
export const onBrg = (deg: number, r: number, dy = 0): Vec3 => {
  const [x, z] = brg((deg * Math.PI) / 180, r);
  return [x, TOP + dy, z];
};

/** A small, fixed, repeatable jitter in [-1, 1] for the i-th thing of a seed: no Math.random. */
export function jitter(seed: number, i: number): number {
  const s = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

export interface IsleLook {
  /** Which jitter its boulders and roots take. */
  readonly seed: number;
  /** The top's radius (1 is the world's own). */
  readonly r?: number;
  /** How deep its root of rock hangs below the top, in radii. */
  readonly depth?: number;
  readonly grass?: ColorPath;
  readonly turf?: ColorPath;
  readonly soil?: ColorPath;
  readonly rock?: ColorPath;
  readonly stone?: ColorPath;
}

/**
 * The island itself, as a hull: the ground of a world that is an island. Turf over soil over a
 * root of rock, a few boulders standing out of the rim, and three stalactites under it.
 */
export function isle(look: IsleLook): Hull {
  const {
    seed,
    r = 1,
    depth = 1.15,
    grass = 'biome.terra.low',
    turf = 'biome.terra.high',
    soil = 'biome.dune.sea',
    rock = 'biome.primer.low',
    stone = 'biome.primer.high',
  } = look;
  const profile: Vec2[] = [
    [-depth, 0],
    [-depth * 0.82, r * 0.22],
    [-depth * 0.58, r * 0.5],
    [-depth * 0.32, r * 0.74],
    [-0.16, r * 0.9],
    [-0.04, r * 0.98],
    [0.06, r],
    [TOP, r * 0.97],
    [TOP, 0],
  ];
  const hull: Item[] = [
    ['lathe', profile, 12, [rock, rock, rock, rock, soil, soil, turf, grass], seed],
  ];
  // Boulders half out of the rim, never further than 1.06 radii.
  for (let i = 0; i < 7; i += 1) {
    const b = (i / 7) * TAU + jitter(seed, i) * 0.3;
    const size = 0.13 + 0.05 * jitter(seed, i + 10);
    const [x, z] = brg(b, r * 0.93);
    const y = -0.08 + 0.06 * jitter(seed, i + 20);
    hull.push([
      'box',
      size,
      size * 0.9,
      size,
      i % 2 === 0 ? stone : rock,
      { at: [x, y, z], rot: [0.3 * jitter(seed, i + 30), b, 0.3 * jitter(seed, i + 40)] },
    ]);
  }
  // Stalactites of rock under the root.
  for (let i = 0; i < 3; i += 1) {
    const [x, z] = brg((i / 3) * TAU + seed, r * 0.38);
    const len = 0.35 + 0.15 * jitter(seed, i + 50);
    hull.push(['cone', 0.14, 0, -depth * 0.45, -depth * 0.45 - len, 6, rock, { at: [x, 0, z] }]);
  }
  return hull;
}

/** A tree of cubes: a trunk and a two-tier crown. `s` scales it; `leaf` is the crown's colour. */
export const tree = (
  at: Vec3,
  s = 1,
  leaf: ColorPath = 'biome.terra.high',
  light: ColorPath = 'biome.terra.low',
): Item => [
  'g',
  ['box', 0.05, 0.16, 0.05, 'biome.dune.sea', { at: [0, 0.08, 0] }],
  ['box', 0.2, 0.14, 0.2, leaf, { at: [0, 0.21, 0] }],
  ['box', 0.13, 0.1, 0.13, light, { at: [0, 0.32, 0] }],
  { at, s },
];

/** A pine: a trunk and three stacked squares, narrowing. */
export const pine = (at: Vec3, s = 1, leaf: ColorPath = 'biome.terra.high'): Item => [
  'g',
  ['box', 0.04, 0.1, 0.04, 'biome.dune.sea', { at: [0, 0.05, 0] }],
  ['box', 0.2, 0.1, 0.2, leaf, { at: [0, 0.14, 0] }],
  ['box', 0.14, 0.1, 0.14, leaf, { at: [0, 0.23, 0] }],
  ['box', 0.08, 0.1, 0.08, leaf, { at: [0, 0.32, 0] }],
  { at, s },
];

/** A cloud of a few white blocks, for the sky round an island. */
export const cloud = (at: Vec3, s = 1): Item => [
  'g',
  ['box', 0.3, 0.1, 0.16, 'ink.high', { at: [0, 0, 0] }],
  ['box', 0.16, 0.1, 0.12, 'ink.high', { at: [0.08, 0.08, 0] }],
  ['box', 0.14, 0.08, 0.12, 'ink.high', { at: [-0.1, 0.05, 0.02] }],
  { at, s },
];

/** A cottage: walls, a pitched roof of two slabs, a lit window and a door. */
export const cottage = (
  at: Vec3,
  s = 1,
  wall: ColorPath = 'ink.high',
  roof: ColorPath = 'coral.base',
  spin = 0,
): Item => [
  'g',
  ['box', 0.22, 0.15, 0.18, wall, { at: [0, 0.075, 0] }],
  ['box', 0.26, 0.03, 0.13, roof, { at: [0, 0.18, -0.045], rot: [0.55, 0, 0] }],
  ['box', 0.26, 0.03, 0.13, roof, { at: [0, 0.18, 0.045], rot: [-0.55, 0, 0] }],
  ['box', 0.05, 0.05, 0.01, 'lamp.window', { at: [0.05, 0.09, 0.091], g: 1 }],
  ['box', 0.045, 0.08, 0.01, 'biome.dune.sea', { at: [-0.05, 0.04, 0.091] }],
  { at, s, rot: [0, spin, 0] },
];

/**
 * A pond on the top at (x, z) and the water that falls from it over the rim at bearing `deg`:
 * the pool, a channel to the edge, the fall down the island's side to below its root, and a
 * puff of spray where it ends. Returns the parts' items (a part of its own, so it can shimmer).
 */
export function falls(
  deg: number,
  pond: { x: number; z: number; r: number },
  drop = 0.7,
  water: ColorPath = 'biome.terra.sea',
  foam: ColorPath = 'biome.frost.high',
): Item[] {
  const b = (deg * Math.PI) / 180;
  const [ex, ez] = brg(b, 0.99);
  const dx = ex - pond.x;
  const dz = ez - pond.z;
  const run = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);
  const [ox, oz] = brg(b, 1.03);
  return [
    ['cyl', pond.r, TOP - 0.02, TOP + 0.012, 10, water, { at: [pond.x, 0, pond.z] }],
    [
      'box',
      0.1,
      0.02,
      run,
      water,
      { at: [(pond.x + ex) / 2, TOP + 0.002, (pond.z + ez) / 2], rot: [0, yaw, 0] },
    ],
    ['box', 0.15, drop, 0.05, water, { at: [ox, TOP - drop / 2, oz], rot: [0, yaw, 0] }],
    ['box', 0.06, drop * 0.9, 0.055, foam, { at: [ox, TOP - drop * 0.45, oz], rot: [0, yaw, 0] }],
    [
      'g',
      ['box', 0.16, 0.08, 0.12, foam],
      ['box', 0.1, 0.06, 0.1, 'ink.high', { at: [0.05, -0.05, 0.02] }],
      { at: [ox, TOP - drop - 0.04, oz], rot: [0, yaw, 0] },
    ],
  ];
}

/** A path of square stones from one place on the top to another. */
export const stones = (from: Vec2, to: Vec2, n: number, color: ColorPath = 'ink.mid'): Item[] =>
  Array.from({ length: n }, (_, i): Item => {
    const t = (i + 0.5) / n;
    return [
      'box',
      0.07,
      0.015,
      0.07,
      color,
      { at: [from[0] + (to[0] - from[0]) * t, TOP + 0.005, from[1] + (to[1] - from[1]) * t] },
    ];
  });
