import { TAU } from '../../../sim/math';
import type { Vec3 } from '../../../sim/world/kit';
import type { ColorPath } from '../../../sim/world/palette';
import type { Item } from '../../../sim/world/rows';
import type { ThemeKey } from '../../tokens';
import { jitter, type Isle } from '../isles';

/**
 * The planned islands' building-site kit (Sports Analysis, Kalshi, Fish Online, Corgi): how they
 * stand and turn things, the timber and the clay, and what lies about every one of their sites.
 * Where two sites differ (a scaffold's overhang, a stake's post), an option says how, so that
 * each island keeps its own.
 */

/** The yaw that turns an item's +Z to look out at bearing `deg` (degrees). */
export const face = (deg: number): number => Math.PI - (deg * Math.PI) / 180;
/** The yaw that turns an item's +X to point at bearing `deg`. */
export const aim = (deg: number): number => Math.PI / 2 - (deg * Math.PI) / 180;
/** A point `local` of an item stood at `at` and turned by `yaw`. */
export const place = (at: Vec3, yaw: number, local: Vec3): Vec3 => [
  at[0] + local[0] * Math.cos(yaw) + local[2] * Math.sin(yaw),
  at[1] + local[1],
  at[2] - local[0] * Math.sin(yaw) + local[2] * Math.cos(yaw),
];
/** A place on the top as [x, z, r], for a list of places to keep clear. */
export const spot = (at: Vec3, r: number): readonly [number, number, number] => [at[0], at[2], r];

export const WOOD: ColorPath = 'nature.wood';
export const BOARD: ColorPath = 'nature.sand';
export const CLAY: ColorPath = 'biome.primer.high';
export const CLAY_HI: ColorPath = 'biome.primer.peak';
export const CLAY_LO: ColorPath = 'biome.primer.low';

/** Where one island's scaffolds differ from the rest. */
export interface ScaffoldStyle {
  /** How much longer than the depth the transoms (the bars along z) are: 0.03, or 0 (Sports Analysis). */
  readonly overhang?: number;
  /** The walk on each lift: one board down the middle, or two along the back and left (Corgi). */
  readonly walk?: 'middle' | 'corner';
  /**
   * The braces: one a lift, zigzag, on the front (+Z) or the back (Corgi); or one up its whole
   * height on the front (Sports Analysis).
   */
  readonly brace?: 'front' | 'back' | 'one';
}

/** A scaffold w by d and h tall in `lifts` lifts: poles, ledgers, a board walk, braces. */
export const scaffold = (
  w: number,
  d: number,
  h: number,
  lifts: number,
  { overhang = 0.03, walk = 'middle', brace = 'front' }: ScaffoldStyle = {},
): Item => {
  const out: Item[] = [];
  const xs = w > 0.3 ? [-w / 2, 0, w / 2] : [-w / 2, w / 2];
  for (const x of xs) {
    for (const z of [-d / 2, d / 2])
      out.push(['box', 0.014, h, 0.014, WOOD, { at: [x, h / 2, z] }]);
  }
  for (let i = 1; i <= lifts; i += 1) {
    const y = (h * i) / lifts - 0.008;
    for (const z of [-d / 2, d / 2])
      out.push(['box', w + 0.03, 0.012, 0.012, WOOD, { at: [0, y, z] }]);
    for (const x of [-w / 2, w / 2])
      out.push(['box', 0.012, 0.012, d + overhang, WOOD, { at: [x, y, 0] }]);
    if (walk === 'corner') {
      out.push(['box', w, 0.01, 0.05, BOARD, { at: [0, y + 0.01, -d / 2 + 0.02] }]);
      out.push(['box', 0.05, 0.01, d - 0.05, BOARD, { at: [-w / 2 + 0.02, y + 0.01, 0.02] }]);
    } else out.push(['box', w, 0.01, d * 0.8, BOARD, { at: [0, y + 0.01, 0] }]);
  }
  if (brace === 'one') {
    out.push([
      'box',
      0.01,
      Math.hypot(w, h) * 0.98,
      0.01,
      WOOD,
      { at: [0, h / 2, d / 2 + 0.008], rot: [0, 0, Math.atan2(w, h)] },
    ]);
    return ['g', ...out];
  }
  const lean = Math.atan2(w, h / lifts);
  const z = brace === 'back' ? -d / 2 - 0.008 : d / 2 + 0.008;
  for (let i = 0; i < lifts; i += 1) {
    out.push([
      'box',
      0.01,
      Math.hypot(w, h / lifts) * 0.96,
      0.01,
      WOOD,
      { at: [0, (h * (i + 0.5)) / lifts, z], rot: [0, 0, i % 2 ? lean : -lean] },
    ]);
  }
  return ['g', ...out];
};

/**
 * A survey stake with a little flag. Given a `post`, it is a post `h` tall and `w` thick with
 * its flag 0.014 under the top, worked out (Kalshi's: its price chart is a line of them).
 */
export const stake = (
  at: Vec3,
  flag: ColorPath,
  yaw = 0,
  post?: { readonly h: number; readonly w: number },
): Item => {
  const [w, h, top] = post ? [post.w, post.h, post.h - 0.014] : [0.012, 0.1, 0.086];
  return [
    'g',
    ['box', w, h, w, WOOD, { at: [0, h / 2, 0] }],
    ['box', 0.036, 0.024, 0.006, flag, { at: [0.02, top, 0] }],
    { at, rot: [0, yaw, 0] },
  ];
};

/** The site office: a cabin on skids, lit windows, a door, a stovepipe ending at `PIPE`. */
export const PIPE: Vec3 = [-0.06, 0.2, -0.03];
export const hut = (at: Vec3, yaw: number, wall: ColorPath, trim: ColorPath): Item => [
  'g',
  ['box', 0.23, 0.014, 0.13, 'space.600', { at: [0, 0.007, 0] }],
  ['box', 0.21, 0.1, 0.12, wall, { at: [0, 0.064, 0] }],
  ['box', 0.212, 0.014, 0.122, trim, { at: [0, 0.03, 0] }],
  ['box', 0.23, 0.016, 0.14, 'ink.high', { at: [0, 0.122, 0] }],
  ['box', 0.07, 0.04, 0.008, 'lamp.window', { at: [0.045, 0.078, 0.062], g: 1 }],
  ['box', 0.008, 0.04, 0.06, 'lamp.window', { at: [-0.106, 0.078, 0], g: 1 }],
  ['box', 0.036, 0.075, 0.008, 'ink.high', { at: [-0.05, 0.052, 0.062] }],
  ['box', 0.018, 0.075, 0.018, 'space.600', { at: [PIPE[0], 0.16, PIPE[2]] }],
  { at, rot: [0, yaw, 0] },
];

/** A work lamp: a mast on a tripod, two lamps on a bar tilted down at the site (they glow). */
export const worklamp = (at: Vec3, yaw: number, h = 0.28): Item => [
  'g',
  ['box', 0.014, h, 0.014, 'space.600', { at: [0, h / 2, 0] }],
  ...[0, 1, 2].map((i): Item => {
    const b = (i / 3) * TAU;
    return [
      'box',
      0.01,
      0.08,
      0.01,
      'space.600',
      {
        at: [0.024 * Math.sin(b), 0.03, 0.024 * Math.cos(b)],
        rot: [0.45 * Math.cos(b), 0, -0.45 * Math.sin(b)],
      },
    ];
  }),
  ['box', 0.08, 0.012, 0.012, 'space.600', { at: [0, h, 0] }],
  [
    'box',
    0.034,
    0.03,
    0.018,
    'nature.lamp',
    { at: [-0.026, h + 0.006, 0.012], rot: [0.5, 0, 0], g: 2 },
  ],
  [
    'box',
    0.034,
    0.03,
    0.018,
    'nature.lamp',
    { at: [0.026, h + 0.006, 0.012], rot: [0.5, 0, 0], g: 2 },
  ],
  { at, rot: [0, yaw, 0] },
];

/** A stack of planks, two rows. */
export const planks = (at: Vec3, yaw: number): Item => [
  'g',
  ...[0, 1, 2, 3].map((i): Item => [
    'box',
    0.2,
    0.013,
    0.03,
    i % 2 ? WOOD : BOARD,
    { at: [0, 0.008 + i * 0.014, 0.017] },
  ]),
  ...[0, 1, 2].map((i): Item => [
    'box',
    0.2,
    0.013,
    0.03,
    i % 2 ? BOARD : WOOD,
    { at: [0, 0.008 + i * 0.014, -0.017] },
  ]),
  { at, rot: [0, yaw, 0] },
];

/** Blocks of clay as they come, on a pallet, waiting to be carved. */
export const blocks = (at: Vec3, yaw: number): Item => [
  'g',
  ['box', 0.12, 0.014, 0.1, WOOD, { at: [0, 0.007, 0] }],
  ['box', 0.07, 0.06, 0.07, CLAY, { at: [-0.025, 0.044, 0] }],
  ['box', 0.05, 0.05, 0.06, CLAY_LO, { at: [0.04, 0.039, 0.01] }],
  ['box', 0.05, 0.04, 0.05, CLAY_HI, { at: [-0.02, 0.094, 0], rot: [0, 0.5, 0] }],
  { at, rot: [0, yaw, 0] },
];

/**
 * The paint chip's swatches again, a hair in front of its card: the kit's own sit inside the
 * card's thickness, and in cubes the card's white wins them.
 */
export const swatch = (family: ThemeKey): Item[] =>
  (['light', 'base', 'shade'] as const).map((tone, i): Item => [
    'box',
    0.15,
    0.075,
    0.012,
    `${family}.${tone}`,
    { at: [0, 0.505 - i * 0.085, 0.012] },
  ]);

/** Where one island's rim of flowers differs from the rest. */
export interface RimBloomStyle {
  /** The band's inner edge, in the top's radii: 0.88, or 0.87 (Sports Analysis). */
  readonly band?: number;
  /** The colour the first flower takes: 0, or the seed (Sports Analysis). */
  readonly first?: number;
}

/**
 * Flowers along the rim in `colors`, from bearing `a` to `b` (degrees), in a band near the
 * edge.
 */
export const rimBlooms = (
  isle: Isle,
  colors: readonly ColorPath[],
  n: number,
  a: number,
  b: number,
  seed: number,
  { band = 0.88, first = 0 }: RimBloomStyle = {},
): Item[] =>
  Array.from({ length: n }, (_, i): Item => {
    const t = ((a + ((b - a) * (i + 0.5)) / n + 4 * jitter(seed, i)) * Math.PI) / 180;
    const r = isle.r * (band + 0.06 * jitter(seed, i + 40));
    return [
      'box',
      0.022,
      0.022,
      0.022,
      colors[(first + i) % colors.length] ?? 'ink.high',
      { at: isle.at(r * Math.sin(t), -r * Math.cos(t), 0.02) },
    ];
  });
