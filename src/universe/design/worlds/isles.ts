import { TAU } from '../../sim/math';
import { brg, type Vec2, type Vec3 } from '../../sim/world/kit';
import type { ColorPath } from '../../sim/world/palette';
import type { Hull, Item } from '../../sim/world/rows';

/**
 * THE ISLES (docs/DESIGN.md, "The isles", 2026-11-16): a world is a floating island, a diorama
 * cut out of the ground and hung in space, as Allen's reference is (a voxel island on a turtle's
 * back, dense with autumn trees, a lighthouse, a stream that pours off the edge). Every project's
 * island is made with this kit: a hilly top of grass in patches, a lip of turf, bands of soil and
 * a root of rock that tapers to a point, with roots and crystals hanging under it; and the
 * scenery that makes it a place (round trees in autumn colours, pines, bushes, flowers, rocks,
 * cottages with smoking chimneys, lamps, paths, streams and falls, clouds, gulls).
 *
 * Modelled at radius 1, as every world is (sim/world/rows.ts), with +Y up. The rim is at `TOP`
 * and the ground rises from it in hills (`Isle.h`): anything stood on the island stands on
 * `Isle.at`. What reaches out past the rim in the ship's lane (|y| < 0.3) counts against the
 * world's reach (design/worlds/reach.ts).
 *
 * Everything here is cut into cubes when it is built (sim/voxel.ts): the shapes are drawn smooth
 * and the cubes give them their edges, their steps and their grain.
 */

/** The height of an island's rim, which its hills rise from. */
export const TOP = 0.14;

/** A small, fixed, repeatable jitter in [-1, 1] for the i-th thing of a seed: no Math.random. */
export function jitter(seed: number, i: number): number {
  const s = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/** Smooth value noise in about [-1, 1] at (x, z), for a seed. */
function noise(seed: number, x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const at = (i: number, k: number): number => jitter(seed, i * 57 + k * 131 + 7);
  const a = at(x0, z0) + (at(x0 + 1, z0) - at(x0, z0)) * sx;
  const b = at(x0, z0 + 1) + (at(x0 + 1, z0 + 1) - at(x0, z0 + 1)) * sx;
  return a + (b - a) * sz;
}

/** Fractal noise: three octaves of `noise`, in about [-1, 1]. */
export function fbm(seed: number, x: number, z: number): number {
  return (
    0.57 * noise(seed, x, z) +
    0.29 * noise(seed + 1, x * 2.1, z * 2.1) +
    0.14 * noise(seed + 2, x * 4.3, z * 4.3)
  );
}

const smooth = (x: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/** A flat place on the top for something that needs one (a field, a castle), at its own height. */
export interface Pad {
  readonly x: number;
  readonly z: number;
  /** Its radius; it blends into the hills over a little more. */
  readonly r: number;
  /** Its height above the rim (default: the hills' own height at its middle). */
  readonly dy?: number;
}

export interface IsleLook {
  /** Which jitter its hills, boulders and roots take. */
  readonly seed: number;
  /** The top's radius (1 is the world's own). */
  readonly r?: number;
  /** How deep its root of rock hangs below the top, in radii. */
  readonly depth?: number;
  /** How high the middle of the top rises over the rim, in radii. */
  readonly hills?: number;
  /** How rough the hills are, in radii. */
  readonly bumps?: number;
  /** Flat places on the top. */
  readonly pads?: readonly Pad[];
  /** The grass in three shades, deep, mid and light: the patches of the lawn. */
  readonly grass?: readonly [ColorPath, ColorPath, ColorPath];
  readonly soil?: readonly [ColorPath, ColorPath];
  readonly rock?: readonly [ColorPath, ColorPath];
  /** Hanging roots under the rim (none on a snowy or a planned island). */
  readonly roots?: boolean;
  /** Crystals under the root, in this colour, and whether they glow. */
  readonly crystal?: ColorPath | null;
}

/** An island: its body as a hull, and where its ground is. */
export interface Isle {
  readonly hull: Hull;
  /** The crystals under it (a part of their own: they glow). */
  readonly crystals: Item[];
  /** The top's radius. */
  readonly r: number;
  /** The ground's height at (x, z). */
  h(x: number, z: number): number;
  /** A place on the ground at (x, z), or `dy` above it. */
  at(x: number, z: number, dy?: number): Vec3;
  /** A place on the ground by compass bearing (degrees, clockwise from -Z) and radius. */
  brg(deg: number, r: number, dy?: number): Vec3;
}

/** The ground's rings and sectors: its top is a polar grid of triangles, each a patch's colour. */
const RINGS = 9;
const SECTORS = 30;

/**
 * The island itself: turf over soil over a root of rock, hills on top, boulders standing out of
 * the rim, stalactites, roots and crystals under it.
 */
export function isle(look: IsleLook): Isle {
  const {
    seed,
    r = 1,
    depth = 1.15,
    hills = 0.1,
    bumps = 0.035,
    pads = [],
    grass = ['nature.moss', 'nature.grass', 'nature.meadow'],
    soil = ['nature.loam', 'nature.soil'],
    rock = ['nature.rock', 'nature.slate'],
    roots = true,
    crystal = 'nature.crystal',
  } = look;
  const rise = (x: number, z: number): number => {
    const d = Math.hypot(x, z) / r;
    const mound = hills * smooth((0.94 - d) / 0.94) ** 1.3;
    const rough = bumps * fbm(seed, x * 2.6 + 11, z * 2.6 - 3) * smooth((0.92 - d) / 0.25);
    return Math.max(0, mound + rough);
  };
  const h = (x: number, z: number): number => {
    let y = rise(x, z);
    for (const pad of pads) {
      const d = Math.hypot(x - pad.x, z - pad.z);
      const w = smooth((pad.r + 0.1 - d) / 0.1);
      if (w > 0) y += ((pad.dy ?? rise(pad.x, pad.z)) - y) * w;
    }
    return TOP + y;
  };
  const at = (x: number, z: number, dy = 0): Vec3 => [x, h(x, z) + dy, z];

  // The top: a polar grid, rim at TOP, its triangles in the lawn's patches.
  const ringR = (i: number): number => (r * 0.975 * i) / RINGS;
  const vertex = (i: number, j: number): Vec3 => {
    const [x, z] = brg((j / SECTORS) * TAU, ringR(i));
    return [x, i === RINGS ? TOP : h(x, z), z];
  };
  const patch = (p: Vec3, q: Vec3, s: Vec3): ColorPath => {
    const cx = (p[0] + q[0] + s[0]) / 3;
    const cz = (p[2] + q[2] + s[2]) / 3;
    const n =
      fbm(seed + 5, cx * 3.2, cz * 3.2) + (0.35 * ((p[1] + q[1] + s[1]) / 3 - TOP)) / (hills || 1);
    return n < -0.18 ? grass[0] : n > 0.32 ? grass[2] : grass[1];
  };
  const top: Item[] = [];
  for (let j = 0; j < SECTORS; j += 1) {
    const c = vertex(0, 0);
    const a = vertex(1, j);
    const b = vertex(1, j + 1);
    top.push(['tri', c, b, a, patch(c, a, b), [0, 1, 0]]);
    for (let i = 1; i < RINGS; i += 1) {
      const p = vertex(i, j);
      const q = vertex(i, j + 1);
      const u = vertex(i + 1, j);
      const v = vertex(i + 1, j + 1);
      top.push(['tri', p, q, v, patch(p, q, v), [0, 1, 0]]);
      top.push(['tri', p, v, u, patch(p, v, u), [0, 1, 0]]);
    }
  }

  // The body: lip of turf, bands of soil, the root of rock. [y, radius] from the tip up.
  const profile: Vec2[] = [
    [-depth, 0],
    [-depth * 0.84, r * 0.2],
    [-depth * 0.62, r * 0.44],
    [-depth * 0.42, r * 0.64],
    [-0.27, r * 0.8],
    [-0.16, r * 0.9],
    [-0.07, r * 0.96],
    [0.02, r * 0.995],
    [0.09, r],
    [TOP, r * 0.985],
    [TOP, 0],
  ];
  const hull: Item[] = [
    ...top,
    [
      'lathe',
      profile,
      20,
      [rock[1], rock[0], rock[1], soil[1], soil[0], soil[1], soil[0], grass[0], grass[1], grass[1]],
      seed,
    ],
  ];
  // Boulders half out of the rim, never further than 1.06 radii.
  for (let i = 0; i < 6; i += 1) {
    const b = (i / 6) * TAU + jitter(seed, i) * 0.4;
    const size = 0.11 + 0.04 * jitter(seed, i + 10);
    const [x, z] = brg(b, r * 0.94);
    const y = -0.12 + 0.05 * jitter(seed, i + 20);
    hull.push([
      'box',
      size,
      size * 0.85,
      size,
      i % 2 === 0 ? rock[0] : 'nature.flint',
      { at: [x, y, z], rot: [0.3 * jitter(seed, i + 30), b, 0.3 * jitter(seed, i + 40)] },
    ]);
  }
  // Stalactites of rock under the root, and a few smaller round them.
  for (let i = 0; i < 6; i += 1) {
    const big = i < 3;
    const [x, z] = brg((i / 3) * TAU + seed + (big ? 0 : 1), r * (big ? 0.36 : 0.55));
    const len = (big ? 0.34 : 0.18) + 0.12 * jitter(seed, i + 50);
    const y0 = big ? -depth * 0.45 : -depth * 0.3;
    hull.push([
      'cone',
      big ? 0.13 : 0.08,
      0,
      y0,
      y0 - len,
      6,
      i % 2 ? rock[0] : rock[1],
      { at: [x, 0, z] },
    ]);
  }
  // Crumbs: grains of soil and rock come loose from under the rim and hang beside it.
  for (let i = 0; i < 16; i += 1) {
    const b = (i / 16) * TAU + jitter(seed, i + 80) * 0.25;
    const [x, z] = brg(b, r * (0.9 + 0.1 * Math.abs(jitter(seed, i + 81))));
    const size = 0.025 + 0.02 * Math.abs(jitter(seed, i + 82));
    const y = -0.12 - 0.22 * Math.abs(jitter(seed, i + 83));
    hull.push([
      'box',
      size,
      size,
      size,
      y > -0.2 ? (soil[i % 2] ?? soil[0]) : (rock[i % 2] ?? rock[0]),
      { at: [x, y, z], rot: [jitter(seed, i + 84), b, jitter(seed, i + 85)] },
    ]);
  }
  // Roots that hang from the soil under the rim.
  if (roots) {
    for (let i = 0; i < 9; i += 1) {
      const b = (i / 9) * TAU + jitter(seed, i + 60) * 0.3;
      const [x, z] = brg(b, r * (0.84 + 0.04 * jitter(seed, i + 61)));
      const len = 0.12 + 0.1 * Math.abs(jitter(seed, i + 62));
      hull.push([
        'box',
        0.022,
        len,
        0.022,
        'nature.bark',
        {
          at: [x, -0.2 - len / 2, z],
          rot: [0.25 * jitter(seed, i + 63), 0, 0.25 * jitter(seed, i + 64)],
        },
      ]);
    }
  }
  const crystals: Item[] = [];
  if (crystal) {
    for (let i = 0; i < 5; i += 1) {
      const [x, z] = brg(
        (i / 5) * TAU + seed * 0.7,
        r * (0.22 + 0.2 * Math.abs(jitter(seed, i + 70))),
      );
      const y = -depth * (0.42 + 0.12 * Math.abs(jitter(seed, i + 71)));
      const len = 0.07 + 0.05 * Math.abs(jitter(seed, i + 72));
      crystals.push([
        'cone',
        0.035,
        0,
        0,
        -len,
        4,
        crystal,
        { at: [x, y, z], rot: [0.4 * jitter(seed, i + 73), 0, 0.4 * jitter(seed, i + 74)], g: 2 },
      ]);
    }
  }
  return {
    hull,
    crystals,
    r,
    h,
    at,
    brg: (deg, radius, dy = 0) => {
      const [x, z] = brg((deg * Math.PI) / 180, radius);
      return at(x, z, dy);
    },
  };
}

// --- Scenery -------------------------------------------------------------------------------------

/** Autumn leaves, the reference's oranges and golds in the site's own tones. */
export const AUTUMN: readonly ColorPath[] = [
  'nature.gold',
  'nature.amber',
  'nature.rust',
  'nature.gold',
];

/**
 * A round tree: a trunk and a crown of three blobs (`leaf` the main, `light` the top). `s`
 * scales it: at 1 it is about 0.3 radii tall.
 */
export const tree = (
  at: Vec3,
  s = 1,
  leaf: ColorPath = 'nature.grass',
  light: ColorPath = 'nature.meadow',
): Item => [
  'g',
  ['box', 0.035, 0.16, 0.035, 'nature.bark', { at: [0, 0.08, 0] }],
  ['box', 0.06, 0.02, 0.016, 'nature.bark', { at: [0.03, 0.12, 0], rot: [0, 0, 0.7] }],
  ['bead', 0.095, leaf, { at: [0, 0.2, 0] }],
  ['bead', 0.07, leaf, { at: [0.06, 0.17, 0.04] }],
  ['bead', 0.065, light, { at: [-0.03, 0.26, -0.02] }],
  { at, s },
];

/** A pine: a trunk and three stacked cones, narrowing (a stepped spire once in cubes). */
export const pine = (
  at: Vec3,
  s = 1,
  leaf: ColorPath = 'nature.pine',
  deep: ColorPath = 'nature.fir',
): Item => [
  'g',
  ['box', 0.03, 0.08, 0.03, 'nature.bark', { at: [0, 0.04, 0] }],
  ['cone', 0.1, 0.035, 0.06, 0.17, 7, deep],
  ['cone', 0.08, 0.02, 0.15, 0.26, 7, leaf],
  ['cone', 0.055, 0, 0.24, 0.36, 7, leaf],
  { at, s },
];

/** A bush: two blobs of leaves. */
export const bush = (at: Vec3, s = 1, leaf: ColorPath = 'nature.moss'): Item => [
  'g',
  ['bead', 0.05, leaf, { at: [0, 0.03, 0] }],
  ['bead', 0.035, leaf, { at: [0.04, 0.02, 0.02] }],
  { at, s },
];

/** A rock: two grey blocks, half sunk. */
export const rock = (at: Vec3, s = 1, seed = 0): Item => [
  'g',
  ['box', 0.07, 0.05, 0.06, 'nature.rock', { at: [0, 0.01, 0], rot: [0, jitter(seed, 1), 0.2] }],
  [
    'box',
    0.045,
    0.04,
    0.05,
    'nature.flint',
    { at: [0.04, 0.015, 0.02], rot: [0.2, jitter(seed, 2), 0] },
  ],
  { at, s },
];

/** The flowers' colours. */
const BLOOMS: readonly ColorPath[] = [
  'nature.rose',
  'ink.high',
  'nature.gold',
  'nature.plum',
  'sky.light',
  'nature.rose',
];

/**
 * A meadow: `n` flowers (a cube each, a cube above the grass) scattered over the top, kept off
 * the places in `avoid` ([x, z, r]).
 */
export function flowers(
  isle: Isle,
  n: number,
  seed: number,
  avoid: readonly (readonly [number, number, number])[] = [],
): Item[] {
  const out: Item[] = [];
  for (let i = 0; out.length < n && i < n * 6; i += 1) {
    const [x, z] = brg(
      (jitter(seed, i * 2) + 1) * Math.PI,
      isle.r * 0.9 * Math.sqrt((jitter(seed, i * 2 + 1) + 1) / 2),
    );
    if (avoid.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) continue;
    const color = BLOOMS[out.length % BLOOMS.length] ?? 'ink.high';
    out.push(['box', 0.022, 0.022, 0.022, color, { at: isle.at(x, z, 0.02) }]);
  }
  return out;
}

/** Trees round the top, out of the places in `avoid` ([x, z, r]): a forest of mixed kinds. */
export function forest(
  isle: Isle,
  n: number,
  seed: number,
  avoid: readonly (readonly [number, number, number])[] = [],
  leaves: readonly ColorPath[] = AUTUMN,
  ring: readonly [number, number] = [0.35, 0.9],
): Item[] {
  const out: Item[] = [];
  for (let i = 0; out.length < n && i < n * 8; i += 1) {
    const b = (jitter(seed, i * 3) + 1) * Math.PI;
    const rr = isle.r * (ring[0] + (ring[1] - ring[0]) * ((jitter(seed, i * 3 + 1) + 1) / 2));
    const [x, z] = brg(b, rr);
    if (avoid.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) continue;
    const s = 0.75 + 0.35 * ((jitter(seed, i * 3 + 2) + 1) / 2);
    const kind = out.length % 5;
    const leaf = leaves[out.length % leaves.length] ?? 'nature.grass';
    out.push(
      kind === 1 || kind === 3
        ? pine(isle.at(x, z), s)
        : kind === 4
          ? bush(isle.at(x, z), s * 1.3, 'nature.moss')
          : tree(isle.at(x, z), s, leaf, kind === 0 ? 'nature.gold' : leaf),
    );
  }
  return out;
}

/** A cloud of a few white blobs, for the sky round an island. */
export const cloud = (at: Vec3, s = 1): Item => [
  'g',
  ['bead', 0.12, 'ink.high', { at: [0, 0, 0] }],
  ['bead', 0.09, 'ink.high', { at: [0.13, -0.02, 0.02] }],
  ['bead', 0.085, 'ink.high', { at: [-0.13, -0.025, -0.01] }],
  ['bead', 0.07, 'biome.frost.high', { at: [0.05, 0.07, -0.03] }],
  ['box', 0.32, 0.05, 0.14, 'biome.frost.low', { at: [0, -0.07, 0] }],
  { at, s },
];

/**
 * A cottage: walls, a pitched roof of two slabs, a chimney, a lit window and a door. Its
 * chimney's top is at `chimneyOf` (for the smoke).
 */
export const cottage = (
  at: Vec3,
  s = 1,
  wall: ColorPath = 'ink.high',
  roof: ColorPath = 'nature.brick',
  spin = 0,
): Item => [
  'g',
  ['box', 0.2, 0.14, 0.16, wall, { at: [0, 0.07, 0] }],
  ['box', 0.24, 0.03, 0.12, roof, { at: [0, 0.17, -0.042], rot: [0.6, 0, 0] }],
  ['box', 0.24, 0.03, 0.12, roof, { at: [0, 0.17, 0.042], rot: [-0.6, 0, 0] }],
  ['box', 0.04, 0.09, 0.04, 'nature.brick', { at: [0.06, 0.2, -0.03] }],
  ['box', 0.045, 0.045, 0.01, 'lamp.window', { at: [0.05, 0.085, 0.081], g: 1 }],
  ['box', 0.04, 0.075, 0.01, 'nature.wood', { at: [-0.05, 0.038, 0.081] }],
  { at, s, rot: [0, spin, 0] },
];

/** Where a cottage's chimney ends, for one stood at `at` with scale `s` and turn `spin`. */
export const chimneyOf = (at: Vec3, s = 1, spin = 0): Vec3 => [
  at[0] + s * (0.06 * Math.cos(spin) - 0.03 * Math.sin(spin)),
  at[1] + s * 0.25,
  at[2] + s * (-0.06 * Math.sin(spin) - 0.03 * Math.cos(spin)),
];

/** A lamp post: a dark pole and a warm lamp (it glows). */
export const lamppost = (at: Vec3, s = 1): Item => [
  'g',
  ['box', 0.016, 0.14, 0.016, 'space.600', { at: [0, 0.07, 0] }],
  ['box', 0.04, 0.012, 0.04, 'space.600', { at: [0, 0.145, 0] }],
  ['bead', 0.02, 'nature.lamp', { at: [0, 0.165, 0], g: 2 }],
  { at, s },
];

/** A path of square stones from one place on the top to another, on the ground. */
export const stones = (
  isle: Isle,
  from: Vec2,
  to: Vec2,
  n: number,
  color: ColorPath = 'nature.flint',
): Item[] =>
  Array.from({ length: n }, (_, i): Item => {
    const t = (i + 0.5) / n;
    const x = from[0] + (to[0] - from[0]) * t;
    const z = from[1] + (to[1] - from[1]) * t;
    return ['box', 0.06, 0.02, 0.06, color, { at: isle.at(x, z, 0.004), rot: [0, t * 2, 0] }];
  });

/**
 * A pond on the top at (x, z), the stream from it to the rim at bearing `deg`, and the water
 * that falls from there down the island's side to below its root, with foam and a cloud of
 * spray where it ends. The still water; `flow` is what runs down it.
 */
export function falls(
  isle: Isle,
  deg: number,
  pond: { x: number; z: number; r: number },
  drop = 0.75,
): Item[] {
  const b = (deg * Math.PI) / 180;
  const [ex, ez] = brg(b, isle.r * 0.99);
  const run = Math.hypot(ex - pond.x, ez - pond.z);
  const yaw = Math.atan2(ex - pond.x, ez - pond.z);
  const [ox, oz] = brg(b, isle.r * 1.03);
  const surface = isle.h(pond.x, pond.z) - 0.005;
  const steps = Math.max(2, Math.round(run / 0.07));
  const stream: Item[] = Array.from({ length: steps }, (_, i): Item => {
    const t = (i + 0.5) / steps;
    const x = pond.x + (ex - pond.x) * t;
    const z = pond.z + (ez - pond.z) * t;
    return [
      'box',
      0.09,
      0.03,
      run / steps + 0.01,
      i % 2 ? 'nature.water' : 'nature.pool',
      { at: [x, isle.h(x, z) - 0.008, z], rot: [0, yaw, 0] },
    ];
  });
  const fall = (dx: number, w: number, color: ColorPath, len: number, dz = 0): Item => [
    'box',
    w,
    len,
    0.05,
    color,
    { at: [ox + dx * Math.cos(b), TOP - len / 2, oz + dx * Math.sin(b) + dz], rot: [0, yaw, 0] },
  ];
  return [
    [
      'cyl',
      pond.r,
      surface - 0.03,
      surface,
      12,
      'nature.pool',
      'nature.water',
      'nature.water',
      { at: [pond.x, 0, pond.z] },
    ],
    [
      'cyl',
      pond.r * 1.15,
      surface - 0.04,
      surface - 0.012,
      12,
      'nature.sand',
      { at: [pond.x, 0, pond.z] },
    ],
    ...stream,
    // The sheet of water: a wide band in two blues, a ribbon of foam down its middle.
    fall(0, 0.16, 'nature.pool', drop),
    fall(-0.035, 0.05, 'nature.water', drop * 0.9),
    fall(0.04, 0.04, 'nature.water', drop * 0.8),
    [
      'box',
      0.035,
      drop * 0.95,
      0.056,
      'nature.foam',
      { at: [ox, TOP - drop * 0.47, oz], rot: [0, yaw, 0] },
    ],
    // Foam where it leaves the rim, and the spray at the bottom.
    ['bead', 0.05, 'nature.foam', { at: [ox, TOP - 0.02, oz] }],
    [
      'g',
      ['bead', 0.08, 'nature.foam'],
      ['bead', 0.06, 'ink.high', { at: [0.07, -0.03, 0.02] }],
      ['bead', 0.05, 'ink.high', { at: [-0.07, -0.02, -0.02] }],
      ['bead', 0.035, 'nature.foam', { at: [0.02, -0.08, 0.05] }],
      ['box', 0.02, 0.02, 0.02, 'nature.foam', { at: [0.12, 0.03, 0.03] }],
      ['box', 0.02, 0.02, 0.02, 'nature.foam', { at: [-0.11, 0.05, -0.04] }],
      { at: [ox, TOP - drop - 0.04, oz], rot: [0, yaw, 0] },
    ],
  ];
}

/**
 * What runs down a fall (for a part of its own that slides down by one `FLOW_STEP` a period
 * and starts over, so the water seems to pour): a row of streaks of foam every step, the fall's
 * length. Every row is the same, so the start over cannot be seen: each row is then where the
 * one above it was. Its pivot is the fall's top, on the sheet of water's middle, and it turns
 * as the sheet does (its +Z out from the island, its +X along the rim), so the streaks stand on
 * the sheet's outer face and the motion's axis is the fall's own.
 */
export const FLOW_STEP = 0.1;
export function flow(isle: Isle, deg: number, drop = 0.75): Item {
  const b = (deg * Math.PI) / 180;
  const [ox, oz] = brg(b, isle.r * 1.03);
  // The lower row of the last step, slid one step down, still ends on the sheet.
  const n = Math.floor((drop - FLOW_STEP) / FLOW_STEP);
  const streak = (x: number, y: number, color: ColorPath): Item => [
    'box',
    0.03,
    0.045,
    0.02,
    color,
    { at: [x, y, 0.03] },
  ];
  return [
    'g',
    ...Array.from({ length: n }, (_, i): Item[] => [
      streak(-0.035, -i * FLOW_STEP - 0.03, 'ink.high'),
      streak(0.03, -i * FLOW_STEP - 0.08, 'nature.foam'),
    ]).flat(),
    { at: [ox, TOP, oz], rot: [0, Math.PI - b, 0] },
  ];
}

/** A puff of smoke at `at` (a part of its own: it rises and fades, then another follows). */
export const puff = (at: Vec3, s = 1): Item => [
  'g',
  ['bead', 0.03, 'biome.frost.low'],
  ['bead', 0.022, 'ink.high', { at: [0.02, 0.015, 0] }],
  { at, s },
];

/** Gulls: `n` small white birds round the island's middle at height `y`, radius `r`. */
export const gulls = (n: number, y: number, r: number, seed = 0): Item[] =>
  Array.from({ length: n }, (_, i): Item => {
    const b = (i / n) * TAU + jitter(seed, i) * 0.4;
    const [x, z] = brg(b, r + 0.08 * jitter(seed, i + 9));
    return [
      'g',
      ['box', 0.05, 0.008, 0.016, 'ink.high', { at: [0.022, 0.006, 0], rot: [0, 0, 0.35] }],
      ['box', 0.05, 0.008, 0.016, 'ink.high', { at: [-0.022, 0.006, 0], rot: [0, 0, -0.35] }],
      ['box', 0.014, 0.012, 0.03, 'ink.mid'],
      { at: [x, y + 0.05 * jitter(seed, i + 3), z], rot: [0, b + Math.PI / 2, 0] },
    ];
  });

/** Small floating islets near the island: a lump of rock with a cap of grass and a bush. */
export const islet = (at: Vec3, s = 1, seed = 0): Item => [
  'g',
  ['cone', 0.09, 0, 0, -0.14, 6, 'nature.slate'],
  ['cyl', 0.095, -0.03, 0, 6, 'nature.soil'],
  ['cyl', 0.095, 0, 0.02, 6, 'nature.grass'],
  bush([0.02 * jitter(seed, 1), 0.02, 0.02 * jitter(seed, 2)], 0.8, 'nature.moss'),
  { at, s },
];

/** Falling leaves under a tree at `at` (a part of its own, drifting down). */
export const leaves = (at: Vec3, colors: readonly ColorPath[] = AUTUMN): Item => [
  'g',
  ...Array.from({ length: 5 }, (_, i): Item => [
    'box',
    0.016,
    0.016,
    0.016,
    colors[i % colors.length] ?? 'nature.gold',
    { at: [0.07 * Math.sin(i * 2.4), 0.06 * i, 0.07 * Math.cos(i * 2.4)] },
  ]),
  { at },
];
