import type { Vec3 } from '../../../sim/world/kit';
import type { ColorPath } from '../../../sim/world/palette';
import { chip, crane } from '../../../sim/world/planned';
import { FLAG, type Item, type Rows } from '../../../sim/world/rows';
import {
  bush,
  cloud,
  falls,
  flow,
  flowers,
  gulls,
  isle,
  islet,
  jitter,
  lamppost,
  leaves,
  pine,
  puff,
  rock,
  stones,
  tree,
} from '../isles';
import {
  aim,
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
 * FISH ONLINE (planned): Canadian Fish played online, the step after the demo. A pine coast with
 * a beach and a stream that pours off the rim, and on its green the games pavilion going up:
 * a six-sided roof only half on its rafters over a round table of clay and its six seats (the
 * game's six players, two teams of three), a fan of clay cards on the cloth, a giant card
 * standing by. A radio mast of clay at the back with its light on says "online". The crane,
 * the paint chip, the site office and the work lamp say none of it is built.
 */

const G = isle({
  seed: 37,
  r: 0.95,
  hills: 0.11,
  bumps: 0.035,
  pads: [{ x: 0, z: 0, r: 0.44, dy: 0.07 }],
  grass: ['nature.moss', 'nature.grass', 'nature.meadow'],
  crystal: 'sky.light',
});

// --- The building site's kit (site.ts has what the planned islands share) ----------------------

/** A pallet of roof shingles of clay, stacked. */
const shingles = (at: Vec3, yaw: number): Item => [
  'g',
  ['box', 0.11, 0.014, 0.09, WOOD, { at: [0, 0.007, 0] }],
  ...[0, 1, 2, 3].map((i): Item => [
    'box',
    0.1 - i * 0.006,
    0.014,
    0.08,
    i % 2 ? CLAY : CLAY_HI,
    { at: [0, 0.022 + i * 0.015, 0], rot: [0, i * 0.08, 0] },
  ]),
  { at, rot: [0, yaw, 0] },
];

/** A cable drum on its side. */
const drum = (at: Vec3, yaw: number): Item => [
  'g',
  ['cyl', 0.05, -0.035, -0.025, 10, WOOD, { rot: [Math.PI / 2, 0, 0] }],
  ['cyl', 0.05, 0.025, 0.035, 10, WOOD, { rot: [Math.PI / 2, 0, 0] }],
  ['cyl', 0.036, -0.026, 0.026, 10, 'sky.shade', { rot: [Math.PI / 2, 0, 0] }],
  { at: [at[0], at[1] + 0.05, at[2]], rot: [0, yaw, 0] },
];

/** The flowers' colours, the coast's. */
const BLOOMS: readonly ColorPath[] = [
  'sky.light',
  'ink.high',
  'nature.gold',
  'sky.base',
  'nature.rose',
];

// --- The pavilion ----------------------------------------------------------------------------------

const MID = G.at(0, 0);
/** Six sides: the seats, the posts, the rafters. The first seat faces bearing `FRONT`. */
const FRONT = 150;
const SIX = Array.from({ length: 6 }, (_, i) => ((FRONT + i * 60) * Math.PI) / 180);
/** The posts' radius and height, the roof's apex. */
const POST_R = 0.36;
const POST_H = 0.26;
const APEX = POST_H + 0.16;

/** The table: a six-sided top on a pedestal, a cloth inset, a fan of cards and the deck. */
const table: Item[] = [
  ['cyl', 0.05, 0, 0.02, 6, CLAY_LO, { at: MID }],
  ['cyl', 0.022, 0.02, 0.085, 6, CLAY, { at: MID }],
  ['cyl', 0.19, 0.085, 0.115, 6, CLAY, CLAY, CLAY_HI, { at: MID }],
  ['cyl', 0.15, 0.115, 0.121, 6, CLAY_LO, { at: MID }],
  ...[-2, -1, 0, 1, 2].map((i): Item => [
    'box',
    0.03,
    0.004,
    0.045,
    CLAY_HI,
    {
      at: [
        MID[0] + 0.035 * Math.sin(i * 0.35),
        MID[1] + 0.12 + i * 0.001,
        MID[2] + 0.06 - 0.03 * Math.cos(i * 0.35),
      ],
      rot: [0, i * 0.35, 0],
    },
  ]),
  [
    'box',
    0.03,
    0.02,
    0.045,
    CLAY_HI,
    { at: [MID[0] - 0.05, MID[1] + 0.126, MID[2] - 0.04], rot: [0, 0.3, 0] },
  ],
];

/** Six seats round it, facing in: alternately the two teams' (a shade apart). */
const seats: Item[] = SIX.map((b, i): Item => {
  const at: Vec3 = [MID[0] + 0.27 * Math.sin(b), MID[1], MID[2] - 0.27 * Math.cos(b)];
  const tone = i % 2 ? CLAY_HI : CLAY;
  return [
    'g',
    ['box', 0.08, 0.07, 0.08, tone, { at: [0, 0.035, 0] }],
    ['box', 0.08, 0.1, 0.022, tone, { at: [0, 0.12, -0.034] }],
    { at, rot: [0, Math.PI - b + Math.PI, 0] },
  ];
});

/** The pavilion: six posts, a ring beam, the rafters, two of its six roof panels on, a finial. */
const pavilion: Item[] = (() => {
  const out: Item[] = [];
  const corner = (b: number, r: number, y: number): Vec3 => [
    MID[0] + r * Math.sin(b),
    MID[1] + y,
    MID[2] - r * Math.cos(b),
  ];
  const beam = (a: Vec3, c: Vec3, w: number, color: ColorPath): Item => {
    const [dx, dy, dz] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const d = Math.hypot(dx, dz);
    return [
      'box',
      w,
      Math.hypot(d, dy),
      w,
      color,
      {
        at: [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2],
        rot: [Math.atan2(d, dy), Math.atan2(dx, dz), 0],
      },
    ];
  };
  const top: Vec3 = [MID[0], MID[1] + APEX, MID[2]];
  SIX.forEach((b0, i) => {
    const b = b0 + Math.PI / 6;
    const b1 = b + Math.PI / 3;
    out.push(['box', 0.026, POST_H, 0.026, CLAY, { at: corner(b, POST_R, POST_H / 2) }]);
    out.push(beam(corner(b, POST_R, POST_H), corner(b1, POST_R, POST_H), 0.022, CLAY_HI));
    out.push(beam(corner(b, POST_R + 0.03, POST_H - 0.01), top, 0.018, WOOD));
    // The two panels on at the back: a fan of slabs between two rafters.
    if (i === 3 || i === 4) {
      for (let k = 0; k < 4; k += 1) {
        const t = (k + 0.5) / 4;
        const r = (POST_R + 0.03) * (1 - t);
        out.push(
          beam(
            corner(b, r, POST_H + (APEX - POST_H) * t),
            corner(b1, r, POST_H + (APEX - POST_H) * t),
            0.05,
            k % 2 ? CLAY : CLAY_HI,
          ),
        );
      }
    }
  });
  out.push(['cone', 0.03, 0, APEX - 0.01, APEX + 0.06, 6, CLAY_HI, { at: MID }]);
  return out;
})();

// --- Round the site --------------------------------------------------------------------------------

const HUT_AT = G.brg(96, 0.7);
const HUT_YAW = face(96) + 0.4;
const PIPE_AT = place(HUT_AT, HUT_YAW, PIPE);
const CRANE_AT = G.brg(300, 0.66);
const CHIP_DEG = 122;
const CHIP_AT = G.brg(CHIP_DEG, 0.82);
const MAST_AT = G.brg(38, 0.6);
/** The stream's pond, and the bearing it pours over the rim at. */
const POND = { x: -0.5, z: 0.32, r: 0.1 };
const FALL = 238;

/** The radio mast: a tapering lattice of clay, two dishes, its light (a part of its own). */
const mast: Item[] = [
  ['box', 0.08, 0.03, 0.08, CLAY_LO, { at: [MAST_AT[0], MAST_AT[1] + 0.015, MAST_AT[2]] }],
  ['cone', 0.04, 0.012, 0.03, 0.56, 4, CLAY, { at: MAST_AT, rot: [0, Math.PI / 4, 0] }],
  ...[0.14, 0.26, 0.38, 0.48].map((y, i): Item => [
    'box',
    0.07 - i * 0.012,
    0.01,
    0.07 - i * 0.012,
    CLAY_HI,
    { at: [MAST_AT[0], MAST_AT[1] + y, MAST_AT[2]] },
  ]),
  [
    'cyl',
    0.035,
    0,
    0.012,
    8,
    CLAY_HI,
    { at: [MAST_AT[0] - 0.03, MAST_AT[1] + 0.34, MAST_AT[2] + 0.02], rot: [1.2, 0.6, 0] },
  ],
  [
    'cyl',
    0.028,
    0,
    0.012,
    8,
    CLAY_HI,
    { at: [MAST_AT[0] + 0.03, MAST_AT[1] + 0.22, MAST_AT[2] + 0.02], rot: [1.2, -0.7, 0] },
  ],
  ['g', scaffold(0.1, 0.1, 0.2, 2), { at: MAST_AT, rot: [0, 0.3, 0] }],
];
const SIGNAL: Vec3 = [MAST_AT[0], MAST_AT[1] + 0.585, MAST_AT[2]];

/** A giant card of clay, standing on its stand, a fish roughed on its face. */
const bigCard = (at: Vec3, yaw: number): Item => [
  'g',
  ['box', 0.2, 0.28, 0.024, CLAY_HI, { at: [0, 0.17, 0], rot: [-0.12, 0, 0] }],
  ['box', 0.16, 0.24, 0.008, CLAY, { at: [0, 0.172, 0.015], rot: [-0.12, 0, 0] }],
  ['box', 0.08, 0.04, 0.012, CLAY_LO, { at: [-0.008, 0.175, 0.022], rot: [-0.12, 0, 0] }],
  ['box', 0.034, 0.046, 0.012, CLAY_LO, { at: [0.048, 0.175, 0.022], rot: [-0.12, 0, 0.6] }],
  ['box', 0.024, 0.024, 0.012, CLAY_LO, { at: [-0.06, 0.29, 0.03], rot: [-0.12, 0, 0] }],
  ['box', 0.024, 0.024, 0.012, CLAY_LO, { at: [0.06, 0.055, 0.0], rot: [-0.12, 0, 0] }],
  ['box', 0.16, 0.02, 0.07, WOOD, { at: [0, 0.01, -0.01] }],
  ['box', 0.016, 0.16, 0.016, WOOD, { at: [0, 0.09, -0.05], rot: [0.4, 0, 0] }],
  { at, rot: [0, yaw, 0] },
];

/** Places the woods leave alone. */
const CLEAR: readonly (readonly [number, number, number])[] = [
  [0, 0, 0.5],
  spot(G.brg(158, 0.78), 0.3),
  spot(HUT_AT, 0.17),
  spot(CRANE_AT, 0.12),
  spot(CHIP_AT, 0.1),
  spot(MAST_AT, 0.14),
  [POND.x, POND.z, POND.r + 0.1],
  spot(G.brg(FALL, 0.8), 0.14),
  spot(G.brg(FALL, 0.94), 0.12),
];

/** A pine coast: mostly pines, some round trees in summer green, a gold one here and there. */
const woods = (n: number, seed: number): Item[] => {
  const out: Item[] = [];
  for (let i = 0; out.length < n && i < n * 10; i += 1) {
    const b = (jitter(seed, i * 3) + 1) * Math.PI;
    const rr = G.r * (0.62 + 0.3 * ((jitter(seed, i * 3 + 1) + 1) / 2));
    const x = rr * Math.sin(b);
    const z = -rr * Math.cos(b);
    if (CLEAR.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) continue;
    const s = 0.75 + 0.35 * ((jitter(seed, i * 3 + 2) + 1) / 2);
    const k = out.length % 7;
    out.push(
      k === 1 || k === 4
        ? tree(G.at(x, z), s, 'nature.grass', 'nature.meadow')
        : k === 6
          ? tree(G.at(x, z), s, 'nature.gold', 'nature.amber')
          : k === 3
            ? bush(G.at(x, z), s * 1.3, 'nature.moss')
            : pine(G.at(x, z), s * 1.05, k === 2 ? 'nature.moss' : 'nature.pine'),
    );
  }
  return out;
};

export const fishOnline: Rows = [
  G.hull,
  [
    'earth',
    FLAG.decal,
    ['cyl', 0.34, -0.03, 0.026, 12, 'nature.loam', { at: MID }],
    ['cyl', 0.12, -0.03, 0.028, 8, 'nature.sand', { at: G.at(0.2, 0.22) }],
    ['cyl', 0.08, -0.03, 0.028, 8, CLAY_LO, { at: G.at(-0.22, -0.18) }],
    // The beach at the front, where the island meets the sky.
    ...[160, 176, 192, 206].map((deg, i): Item => [
      'cyl',
      0.1 + 0.02 * (i % 2),
      -0.03,
      0.026,
      8,
      'nature.sand',
      { at: G.brg(deg, 0.86) },
    ]),
  ],
  ['table', 0, ...table],
  ['seats', 0, ...seats],
  [
    'pavilion',
    0,
    ...pavilion,
    [
      'g',
      scaffold(0.12, 0.12, POST_H + 0.04, 3),
      { at: place(MID, face(70), [0, 0, POST_R + 0.07]), rot: [0, face(70), 0] },
    ],
  ],
  ['mast', 0, ...mast],
  ['signal', 0, ['g', ['bead', 0.03, 'sky.light', { g: 2 }], { at: SIGNAL }]],
  ['crane', 0, ['g', crane('sky'), { at: CRANE_AT, s: 0.8, rot: [0, aim(78), 0] }]],
  [
    'paint-chip',
    0,
    ['g', chip('sky'), ...swatch('sky'), { at: CHIP_AT, s: 0.7, rot: [0, face(CHIP_DEG + 25), 0] }],
  ],
  [
    'yard',
    0,
    hut(HUT_AT, HUT_YAW, 'sky.base', 'ink.high'),
    worklamp(G.brg(212, 0.5), face(212) + Math.PI),
    bigCard(G.brg(196, 0.62), face(166)),
    planks(G.brg(140, 0.58), 0.6),
    shingles(G.brg(230, 0.62), 0.3),
    drum(G.brg(130, 0.7), 0.9),
    ...[0, 1, 2, 3].map((i): Item =>
      stake(G.brg(100 + i * 14, 0.5), i % 2 ? 'nature.rust' : 'nature.rose', 0.4 * i),
    ),
    ...stones(G, [HUT_AT[0] * 0.78, HUT_AT[2] * 0.78], [0.3, 0.1], 3, 'nature.sand'),
    lamppost(G.brg(176, 0.8)),
    lamppost(G.brg(112, 0.62)),
    rock(G.brg(196, 0.92), 1, 2),
    rock(G.brg(168, 0.94), 0.8, 3),
    bush(G.brg(150, 0.92), 1.1),
  ],
  [
    'woods',
    0,
    ...woods(28, 37),
    pine(G.brg(340, 0.72), 1.3),
    pine(G.brg(262, 0.74), 1.2),
    tree(G.brg(18, 0.8), 1.2, 'nature.gold', 'nature.amber'),
  ],
  [
    'meadow',
    0,
    ...flowers(G, 20, 37, [[0, 0, 0.46], spot(HUT_AT, 0.15)]),
    ...rimBlooms(G, BLOOMS, 14, 120, 225, 37),
  ],
  ['falls', 0, ...falls(G, FALL, POND)],
  ['flow', 0, flow(G, FALL)],
  ['smoke-1', 0, puff([PIPE_AT[0], PIPE_AT[1] + 0.02, PIPE_AT[2]], 0.8)],
  ['smoke-2', 0, puff([PIPE_AT[0], PIPE_AT[1] + 0.02, PIPE_AT[2]], 1)],
  ['leaves', 0, leaves(G.brg(18, 0.8, 0.13))],
  ['crystals', 0, ...G.crystals],
  ['gulls', 0, ...gulls(4, 0.8, 0.72, 37)],
  ['islets', 0, islet([1.1, -0.5, 0.4], 0.8, 8), islet([-1.05, -0.6, -0.5], 0.9, 9)],
  ['clouds', 0, cloud([1.18, 0.6, -0.4], 0.85), cloud([-1.2, 0.68, 0.1], 0.7)],
];
