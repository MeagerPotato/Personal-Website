import { TAU } from '../../../sim/math';
import type { Vec3 } from '../../../sim/world/kit';
import type { ColorPath } from '../../../sim/world/palette';
import { chip, crane } from '../../../sim/world/planned';
import { FLAG, type Item, type Rows } from '../../../sim/world/rows';
import {
  bush,
  cloud,
  flowers,
  gulls,
  isle,
  islet,
  jitter,
  leaves,
  pine,
  puff,
  rock,
  stones,
  tree,
} from '../isles';
import {
  aim,
  BOARD,
  blocks,
  CLAY,
  CLAY_HI,
  CLAY_LO,
  face,
  hut,
  PIPE,
  place,
  planks,
  rimBlooms,
  scaffold,
  spot,
  stake,
  swatch,
  worklamp,
  WOOD,
} from './site';

/**
 * KALSHI (planned): a market on yes and no, under Sports Analysis. A blossom island in spring, and
 * on its middle a coin of clay twice a person's height turning slowly on its plinth between two
 * towers of scaffold: one face carved YES, the other NO and still rough at the edge, chips of
 * clay on the plank bridged over it. A line of posts by the pond traces a price as it moves,
 * a stone lantern glows by the water, the crane, the paint chip, the site office and the work
 * lamp say it is not built yet.
 */

const G = isle({
  seed: 43,
  r: 0.92,
  hills: 0.1,
  bumps: 0.03,
  pads: [{ x: 0, z: 0, r: 0.48, dy: 0.07 }],
  grass: ['nature.grass', 'nature.meadow', 'nature.meadow'],
  crystal: 'nature.rose',
});

// --- The building site's kit (site.ts has what the planned islands share) ----------------------

/**
 * Its stakes are posts (`stake` in site.ts), their flags hung at the height worked out from the
 * top (0.1 - 0.014), a hair off the kit's 0.086.
 */
const STAKE = { h: 0.1, w: 0.012 };

/** The flowers' colours, spring's. */
const BLOOMS: readonly ColorPath[] = [
  'nature.rose',
  'ink.high',
  'biome.bloom.high',
  'nature.plum',
  'sky.light',
];

/** Pixel letters as boxes standing `depth` proud of a face (+Z), centred on the origin. */
const relief = (art: readonly string[], px: number, depth: number, color: ColorPath): Item[] => {
  const out: Item[] = [];
  const w = art[0]?.length ?? 0;
  art.forEach((row, j) => {
    for (let i = 0; i < w;) {
      if (row[i] !== '#') {
        i += 1;
        continue;
      }
      let k = i;
      while (k < w && row[k] === '#') k += 1;
      const at: Vec3 = [((i + k) / 2 - w / 2) * px, (art.length / 2 - j - 0.5) * px, 0];
      out.push(['box', (k - i) * px, px, depth, color, { at }]);
      i = k;
    }
  });
  return out;
};

// --- The coin --------------------------------------------------------------------------------------

/** The coin's radius and half its thickness; it stands on edge, its faces along its own z. */
const R = 0.24;
const T = 0.03;
/** Its plinth's top, and the bearing its YES face looks out at when it is still. */
const PLINTH = 0.1;
const FACING = 150;
const COIN: Vec3 = G.at(0, 0, PLINTH + R + 0.008);
const COIN_YAW = face(FACING);
/** Lying flat in the cylinder ops, standing up here: their y becomes the coin's z. */
const UP: Vec3 = [Math.PI / 2, 0, 0];

const YES = ['#.#.###.###', '#.#.#...#..', '.#..###.###', '.#..#.....#', '.#..###.###'];
/** NO, read from the coin's back: drawn mirrored. */
const NO = ['###.#..#', '#.#.#.##', '#.#.##.#', '#.#.#..#', '###.#..#'];

/** The front half: its face carved YES inside a finished rim, a bar under the word. */
const yesFace: Item = [
  'g',
  ['cyl', R, 0, T, 14, CLAY, { rot: UP }],
  ['ring', [R - 0.035, R], 0, TAU, 14, T, T + 0.016, CLAY_HI, CLAY_HI, { rot: UP }],
  ['g', ...relief(YES, 0.028, 0.02, CLAY_HI), { at: [0, 0.03, T + 0.009] }],
  ['box', 0.22, 0.022, 0.02, CLAY_HI, { at: [0, -0.08, T + 0.009] }],
  { at: COIN, rot: [0, COIN_YAW, 0] },
];

/** The back half: NO carved, its rim only half cut, the blank still rough at the other edge. */
const noFace: Item = [
  'g',
  ['cyl', R, -T, 0, 14, CLAY, { rot: UP }],
  ['ring', [R - 0.035, R], 0, Math.PI, 7, -T - 0.016, -T, CLAY_HI, CLAY_HI, { rot: UP }],
  ['g', ...relief(NO, 0.03, 0.02, CLAY_HI), { at: [0, 0.01, -T - 0.009] }],
  ...[200, 235, 262, 290, 318].map((deg, i): Item => {
    const b = (deg * Math.PI) / 180;
    const s = 0.06 + 0.02 * Math.abs(jitter(43, i));
    return [
      'box',
      s,
      s * 0.9,
      0.07,
      i % 2 ? CLAY_LO : CLAY,
      { at: [R * 0.93 * Math.sin(b), R * 0.93 * Math.cos(b), -0.005], rot: [0, 0, b] },
    ];
  }),
  { at: COIN, rot: [0, COIN_YAW, 0] },
];

/** The plinth: two steps of clay and the stub the coin turns on. */
const plinth: Item[] = [
  ['cyl', 0.2, -0.02, 0.04, 8, CLAY_LO, { at: G.at(0, 0) }],
  ['cyl', 0.15, 0.04, 0.08, 8, CLAY, { at: G.at(0, 0) }],
  ['cyl', 0.035, 0.08, PLINTH, 6, CLAY_HI, { at: G.at(0, 0) }],
];

/** Two towers of scaffold beside the coin's edges, a plank bridged over it, chips on the plank. */
const TOWER = 0.4;
const SCAFFOLD_H = PLINTH + 2 * R + 0.06;
const towers: Item[] = [-1, 1].map((side): Item => [
  'g',
  scaffold(0.13, 0.13, SCAFFOLD_H, 4),
  { at: place(G.at(0, 0), COIN_YAW, [side * TOWER, 0, 0]), rot: [0, COIN_YAW, 0] },
]);
const BRIDGE_Y = G.h(0, 0) + SCAFFOLD_H + 0.006;
const bridge: Item = [
  'g',
  ['box', 2 * TOWER + 0.1, 0.014, 0.05, BOARD],
  ['box', 2 * TOWER + 0.1, 0.012, 0.012, WOOD, { at: [0, 0.05, 0.03] }],
  ...[-0.3, -0.1, 0.1, 0.3].map((x): Item => [
    'box',
    0.012,
    0.05,
    0.012,
    WOOD,
    { at: [x, 0.025, 0.03] },
  ]),
  ['box', 0.03, 0.02, 0.02, CLAY, { at: [0.06, 0.017, -0.01], rot: [0, 0.6, 0] }],
  ['box', 0.022, 0.018, 0.02, CLAY_LO, { at: [-0.12, 0.016, 0.005], rot: [0, 1.2, 0] }],
  ['box', 0.07, 0.012, 0.012, WOOD, { at: [0.2, 0.014, 0], rot: [0, 0.4, 0] }],
  ['box', 0.03, 0.03, 0.03, 'space.600', { at: [0.22, 0.02, 0.0] }],
  { at: [0, BRIDGE_Y, 0], rot: [0, COIN_YAW, 0] },
];

// --- Round the site --------------------------------------------------------------------------------

const HUT_AT = G.brg(228, 0.66);
const HUT_YAW = face(190);
const PIPE_AT = place(HUT_AT, HUT_YAW, PIPE);
const CRANE_AT = G.brg(270, 0.7);
const CHIP_DEG = 205;
const CHIP_AT = G.brg(CHIP_DEG, 0.76);
/** The pond, at the back on the right, and the price traced by the posts beside it. */
const POND = { x: 0.3, z: -0.46, r: 0.14 };
const PRICE = [0.05, 0.08, 0.07, 0.11, 0.1, 0.15, 0.13, 0.18];

/** A line of posts whose heights trace a price, a string along their tops. */
const chart: Item[] = (() => {
  const from = G.brg(112, 0.5);
  const to = G.brg(72, 0.76);
  const out: Item[] = [];
  const tops: Vec3[] = PRICE.map((h, i): Vec3 => {
    const t = i / (PRICE.length - 1);
    const at = G.at(from[0] + (to[0] - from[0]) * t, from[2] + (to[2] - from[2]) * t);
    out.push(stake(at, i === PRICE.length - 1 ? 'mint.base' : 'nature.rose', 0.4, { h, w: 0.02 }));
    return [at[0], at[1] + h, at[2]];
  });
  tops.forEach((b, i) => {
    const a = tops[i - 1];
    if (!a) return;
    const [dx, dy, dz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const d = Math.hypot(dx, dz);
    out.push([
      'box',
      0.016,
      Math.hypot(d, dy),
      0.016,
      'ink.high',
      {
        at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
        rot: [Math.atan2(d, dy), Math.atan2(dx, dz), 0],
      },
    ]);
  });
  return out;
})();

/** A stone lantern by the pond, its window lit. */
const lantern = (at: Vec3): Item => [
  'g',
  ['box', 0.07, 0.02, 0.07, 'nature.flint', { at: [0, 0.01, 0] }],
  ['box', 0.03, 0.08, 0.03, 'nature.rock', { at: [0, 0.06, 0] }],
  ['box', 0.07, 0.016, 0.07, 'nature.flint', { at: [0, 0.108, 0] }],
  ['box', 0.05, 0.045, 0.05, 'nature.lamp', { at: [0, 0.138, 0], g: 2 }],
  ['cone', 0.06, 0.012, 0.16, 0.2, 4, 'nature.rock', { rot: [0, Math.PI / 4, 0] }],
  ['box', 0.016, 0.016, 0.016, 'nature.flint', { at: [0, 0.205, 0] }],
  { at },
];

/** Blossom crowns: [leaf, light]. */
const BLOSSOM: readonly (readonly [ColorPath, ColorPath])[] = [
  ['nature.rose', 'biome.bloom.high'],
  ['biome.bloom.high', 'ink.high'],
  ['nature.plum', 'nature.rose'],
  ['ink.high', 'biome.bloom.peak'],
  ['nature.rose', 'ink.high'],
];

/** Places the orchard leaves alone. */
const CLEAR: readonly (readonly [number, number, number])[] = [
  [0, 0, 0.5],
  spot(G.brg(160, 0.74), 0.28),
  spot(HUT_AT, 0.17),
  spot(CRANE_AT, 0.12),
  spot(CHIP_AT, 0.1),
  [POND.x, POND.z, POND.r + 0.08],
  spot(G.brg(92, 0.62), 0.18),
  spot(G.brg(114, 0.72), 0.2),
  spot(G.brg(66, 0.66), 0.1),
];

/** An orchard in blossom round the rim, with a few dark pines and bushes between. */
const orchard = (n: number, seed: number): Item[] => {
  const out: Item[] = [];
  for (let i = 0; out.length < n && i < n * 10; i += 1) {
    const b = (jitter(seed, i * 3) + 1) * Math.PI;
    const rr = G.r * (0.66 + 0.26 * ((jitter(seed, i * 3 + 1) + 1) / 2));
    const x = rr * Math.sin(b);
    const z = -rr * Math.cos(b);
    if (CLEAR.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) continue;
    const s = 0.72 + 0.32 * ((jitter(seed, i * 3 + 2) + 1) / 2);
    const k = out.length;
    const [leaf, light] = BLOSSOM[k % BLOSSOM.length] ?? ['nature.rose', 'ink.high'];
    out.push(
      k % 6 === 2
        ? pine(G.at(x, z), s * 0.9)
        : k % 6 === 5
          ? bush(G.at(x, z), s * 1.3, 'nature.moss')
          : tree(G.at(x, z), s, leaf, light),
    );
  }
  return out;
};

export const kalshi: Rows = [
  G.hull,
  [
    'earth',
    FLAG.decal,
    ['cyl', 0.3, -0.03, 0.026, 12, 'nature.loam', { at: G.at(0, 0) }],
    ['cyl', 0.1, -0.03, 0.028, 8, 'nature.sand', { at: G.at(-0.18, 0.16) }],
    ['cyl', 0.08, -0.03, 0.028, 8, CLAY_LO, { at: G.at(0.17, 0.18) }],
  ],
  ['plinth', 0, ...plinth],
  ['yes-face', 0, yesFace],
  ['no-face', 0, noFace],
  ['scaffold', 0, ...towers, bridge],
  ['crane', 0, ['g', crane('mint'), { at: CRANE_AT, s: 0.8, rot: [0, aim(12), 0] }]],
  [
    'paint-chip',
    0,
    [
      'g',
      chip('mint'),
      ...swatch('mint'),
      { at: CHIP_AT, s: 0.7, rot: [0, face(CHIP_DEG - 35), 0] },
    ],
  ],
  [
    'yard',
    0,
    hut(HUT_AT, HUT_YAW, 'biome.bloom.high', 'ink.high'),
    worklamp(G.brg(198, 0.46), face(198) + Math.PI),
    planks(G.brg(140, 0.6), 0.3),
    blocks(G.brg(196, 0.56), 0.8),
    blocks(G.brg(126, 0.46), 2.1),
    ...[0, 1, 2, 3].map((i): Item =>
      stake(G.brg(210 + i * 22, 0.36), i % 2 ? 'nature.rust' : 'nature.rose', 0.5 * i, STAKE),
    ),
    ...stones(G, [HUT_AT[0] * 0.78, HUT_AT[2] * 0.78], [-0.22, 0.1], 3, 'nature.flint'),
    ...stones(G, [-0.05, 0.62], [-0.02, 0.32], 4, 'nature.flint'),
    rock(G.brg(176, 0.85), 0.9, 8),
  ],
  ['chart', 0, ...chart],
  [
    'pond',
    0,
    [
      'cyl',
      POND.r,
      -0.04,
      -0.008,
      10,
      'nature.pool',
      'nature.water',
      'nature.water',
      { at: G.at(POND.x, POND.z) },
    ],
    ['cyl', POND.r + 0.03, -0.05, 0.004, 10, 'nature.sand', { at: G.at(POND.x, POND.z) }],
    [
      'box',
      0.03,
      0.012,
      0.016,
      'nature.amber',
      { at: G.at(POND.x - 0.04, POND.z + 0.03, -0.004), rot: [0, 0.6, 0] },
    ],
    [
      'box',
      0.026,
      0.012,
      0.014,
      'ink.high',
      { at: G.at(POND.x + 0.05, POND.z - 0.02, -0.004), rot: [0, -0.4, 0] },
    ],
    ['cyl', 0.03, -0.006, -0.002, 6, 'nature.moss', { at: G.at(POND.x + 0.02, POND.z + 0.07) }],
    ['cyl', 0.024, -0.006, -0.002, 6, 'nature.moss', { at: G.at(POND.x - 0.07, POND.z - 0.05) }],
    lantern(G.brg(58, 0.62)),
    ...[-1, 0, 1].map((i): Item => [
      'box',
      0.045,
      0.02,
      0.04,
      'nature.flint',
      { at: G.at(POND.x + i * 0.07, POND.z + i * 0.03, -0.006), rot: [0, i, 0] },
    ]),
    rock(G.brg(14, 0.68), 0.8, 9),
  ],
  [
    'orchard',
    0,
    ...orchard(26, 43),
    tree(G.brg(300, 0.62), 1.3, 'nature.rose', 'biome.bloom.high'),
    tree(G.brg(20, 0.66), 1.2, 'ink.high', 'biome.bloom.high'),
  ],
  [
    'meadow',
    0,
    ...flowers(G, 20, 43, [[0, 0, 0.36], spot(HUT_AT, 0.15), [POND.x, POND.z, POND.r + 0.04]]),
    ...rimBlooms(G, BLOOMS, 16, 110, 240, 43),
  ],
  ['smoke-1', 0, puff([PIPE_AT[0], PIPE_AT[1] + 0.02, PIPE_AT[2]], 0.8)],
  ['smoke-2', 0, puff([PIPE_AT[0], PIPE_AT[1] + 0.02, PIPE_AT[2]], 1)],
  ['leaves', 0, leaves(G.brg(300, 0.62, 0.14), ['nature.rose', 'ink.high', 'biome.bloom.high'])],
  ['crystals', 0, ...G.crystals],
  ['gulls', 0, ...gulls(3, 0.85, 0.66, 43)],
  ['islets', 0, islet([1.1, -0.55, -0.3], 0.8, 6), islet([-1.06, -0.62, 0.4], 0.7, 7)],
  ['clouds', 0, cloud([1.2, 0.62, 0.3], 0.8), cloud([-1.18, 0.55, -0.45], 0.75)],
];
