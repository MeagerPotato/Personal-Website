import type { Vec3 } from '../../../sim/world/kit';
import type { ColorPath } from '../../../sim/world/palette';
import { FLAG, type Item, type Rows } from '../../../sim/world/rows';
import { beacon } from '../shared';
import {
  bush,
  chimneyOf,
  cloud,
  cottage,
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
  type Isle,
} from '../isles';

/**
 * FISHAI: a harbour in a turquoise bay, where the bots learn the game. A little robot sits at the
 * end of the jetty fishing ('rod'), the lab on the hill behind shows the bots' win rates on its
 * screens, a striped beacon tower lights the point ('lantern'), boats ride in the bay, palms
 * lean over the beach, the boathouse smokes, and the bay spills over the rim.
 */

/** Where the island is seen from first (the lab's turntable, and a ship coming in to dock). */
const VIEW = 135;
const at2 = (deg: number, r: number): readonly [number, number] => [
  r * Math.sin((deg * Math.PI) / 180),
  -r * Math.cos((deg * Math.PI) / 180),
];
/** A bearing in degrees to the turn that makes a thing's +Z face out along it. */
const face = (deg: number): number => Math.PI - (deg * Math.PI) / 180;

/** The bay, in front; the point the beacon stands on (back left); the lab's hill (back right). */
const BAY = { x: at2(VIEW, 0.4)[0], z: at2(VIEW, 0.4)[1], r: 0.31 };
const POINT = { x: at2(VIEW + 145, 0.58)[0], z: at2(VIEW + 145, 0.58)[1] };
const LAB = { x: at2(VIEW - 150, 0.46)[0], z: at2(VIEW - 150, 0.46)[1] };

const G = isle({
  seed: 13,
  hills: 0.13,
  bumps: 0.035,
  pads: [
    { x: BAY.x, z: BAY.z, r: BAY.r + 0.05, dy: 0.015 },
    { x: POINT.x, z: POINT.z, r: 0.13, dy: 0.17 },
    { x: LAB.x, z: LAB.z, r: 0.2, dy: 0.17 },
  ],
  grass: ['nature.grass', 'nature.meadow', 'biome.tide.shore'],
  soil: ['biome.dune.shore', 'biome.dune.sea'],
  crystal: 'mint.base',
});

// --- The bay --------------------------------------------------------------------------------------

const WATER_Y = G.h(BAY.x, BAY.z) + 0.006;
/**
 * The water, a decal so that it takes the lawn's cubes (the first to reach a cube takes it): the
 * deep middle, the bay, the turquoise shallows, a beach of sand round them.
 */
const bay: Item[] = [
  ['cyl', BAY.r * 0.55, WATER_Y - 0.03, WATER_Y, 12, 'nature.pool', { at: [BAY.x, 0, BAY.z] }],
  ['cyl', BAY.r * 0.82, WATER_Y - 0.035, WATER_Y, 14, 'nature.water', { at: [BAY.x, 0, BAY.z] }],
  ['cyl', BAY.r, WATER_Y - 0.04, WATER_Y, 14, 'biome.tide.shore', { at: [BAY.x, 0, BAY.z] }],
  [
    'ring',
    [BAY.r, BAY.r + 0.07],
    0,
    Math.PI * 2,
    14,
    WATER_Y - 0.04,
    WATER_Y + 0.002,
    'nature.sand',
    'nature.sand',
    0,
    { at: [BAY.x, 0, BAY.z] },
  ],
];

/** Buoys in the bay, coral and white, and a ring of ripples round the robot's float. */
/**
 * The robot sits at the jetty's end a little behind the bay's middle, facing +Z (square to the
 * cubes, so that its face lands on them cleanly), and its rod reaches out over the water to the
 * float, which hangs straight under the rod's tip.
 */
const BOT_XZ = [BAY.x, BAY.z - 0.08] as const;
const BOT_S = 1.3;
const HANDS: Vec3 = [0, 0.085 * BOT_S, 0.09 * BOT_S];
const ROD_LEN = 0.28;
const ROD_UP = 0.65;
const TIP: Vec3 = [0, ROD_LEN * Math.sin(ROD_UP), ROD_LEN * Math.cos(ROD_UP)];
const FLOAT = [BOT_XZ[0], BOT_XZ[1] + HANDS[2] + TIP[2]] as const;
const buoys: Item[] = [
  ...[
    [VIEW + 70, 0.2],
    [VIEW - 20, 0.22],
    [VIEW + 150, 0.18],
  ].map(([deg = 0, r = 0], i): Item => [
    'g',
    ['cyl', 0.022, 0, 0.03, 8, i % 2 ? 'ink.high' : 'coral.base'],
    ['cyl', 0.023, 0.012, 0.02, 8, i % 2 ? 'coral.base' : 'ink.high'],
    ['box', 0.006, 0.03, 0.006, 'space.600', { at: [0, 0.045, 0] }],
    { at: [BAY.x + at2(deg, r)[0], WATER_Y - 0.008, BAY.z + at2(deg, r)[1]] },
  ]),
  [
    'ring',
    [0.035, 0.05],
    0,
    Math.PI * 2,
    10,
    WATER_Y - 0.004,
    WATER_Y + 0.006,
    'nature.foam',
    'nature.foam',
    1,
    { at: [FLOAT[0], 0, FLOAT[1]] },
  ],
];

// --- The jetty and the robot ----------------------------------------------------------------------

/** The jetty: from the beach on the right out into the bay. */
const JETTY_FROM = [
  BAY.x + at2(VIEW - 75, BAY.r + 0.06)[0],
  BAY.z + at2(VIEW - 75, BAY.r + 0.06)[1],
] as const;
const JETTY_TO = BOT_XZ;
const JETTY_LEN = Math.hypot(JETTY_TO[0] - JETTY_FROM[0], JETTY_TO[1] - JETTY_FROM[1]);
const JETTY_YAW = Math.atan2(JETTY_TO[0] - JETTY_FROM[0], JETTY_TO[1] - JETTY_FROM[1]);
const DECK_Y = WATER_Y + 0.035;
const jetty: Item = [
  'g',
  ['box', 0.1, 0.018, JETTY_LEN, 'nature.wood'],
  ...Array.from({ length: 7 }, (_, i): Item => [
    'box',
    0.104,
    0.02,
    0.008,
    'nature.bark',
    { at: [0, 0.001, -JETTY_LEN / 2 + 0.03 + (i * (JETTY_LEN - 0.06)) / 6] },
  ]),
  ...[-1, 1].flatMap((sx): Item[] =>
    [0.1, 0.5, 0.92].map((t): Item => [
      'box',
      0.02,
      0.09,
      0.02,
      'nature.bark',
      { at: [sx * 0.055, -0.025, -JETTY_LEN / 2 + t * JETTY_LEN] },
    ]),
  ),
  // A crate and a barrel near the shore end.
  [
    'box',
    0.05,
    0.045,
    0.05,
    'nature.wood',
    { at: [0.025, 0.03, -JETTY_LEN / 2 + 0.07], rot: [0, 0.3, 0] },
  ],
  [
    'cyl',
    0.024,
    0.009,
    0.07,
    8,
    'nature.bark',
    'nature.wood',
    'nature.wood',
    { at: [-0.03, 0, -JETTY_LEN / 2 + 0.12] },
  ],
  {
    at: [(JETTY_FROM[0] + JETTY_TO[0]) / 2, DECK_Y, (JETTY_FROM[1] + JETTY_TO[1]) / 2],
    rot: [0, JETTY_YAW, 0],
  },
];

/** Where the robot sits (the jetty's end) and the way it faces (out over the bay, to the float). */
const BOT_AT: Vec3 = [BOT_XZ[0], DECK_Y + 0.009, BOT_XZ[1]];

/** The robot: a white body and head, a face of screen with two mint eyes, legs over the edge. */
const robot: Item = [
  'g',
  // The face and the belly first: the first to reach a cube takes it.
  ['box', 0.018, 0.022, 0.012, 'mint.light', { at: [-0.022, 0.14, 0.048], g: 1 }],
  ['box', 0.018, 0.022, 0.012, 'mint.light', { at: [0.022, 0.14, 0.048], g: 1 }],
  ['box', 0.03, 0.008, 0.012, 'mint.base', { at: [0, 0.118, 0.048], g: 1 }],
  ['box', 0.09, 0.06, 0.012, 'space.900', { at: [0, 0.135, 0.044], g: 1 }],
  ['box', 0.014, 0.014, 0.012, 'mint.base', { at: [0.015, 0.05, 0.036], g: 1 }],
  ['box', 0.06, 0.04, 0.012, 'sky.base', { at: [0, 0.05, 0.032] }],
  ['box', 0.1, 0.09, 0.08, 'ink.high', { at: [0, 0.045, -0.01] }],
  ['box', 0.11, 0.085, 0.09, 'ink.high', { at: [0, 0.135, -0.005] }],
  ['box', 0.016, 0.03, 0.03, 'sky.base', { at: [-0.062, 0.135, -0.005] }],
  ['box', 0.016, 0.03, 0.03, 'sky.base', { at: [0.062, 0.135, -0.005] }],
  ['box', 0.008, 0.06, 0.008, 'ink.mid', { at: [0.02, 0.205, -0.01] }],
  beacon([0.02, 0.24, -0.01]),
  // Legs over the jetty's end, and arms forward to the rod.
  ...[-1, 1].flatMap((s): Item[] => [
    ['box', 0.03, 0.03, 0.07, 'ink.mid', { at: [s * 0.03, 0.012, 0.055] }],
    ['box', 0.03, 0.07, 0.03, 'ink.mid', { at: [s * 0.03, -0.03, 0.09] }],
    ['box', 0.036, 0.02, 0.04, 'sky.shade', { at: [s * 0.03, -0.065, 0.1] }],
    ['box', 0.024, 0.024, 0.07, 'ink.mid', { at: [s * 0.045, 0.07, 0.05], rot: [0.3, 0, 0] }],
  ]),
  { at: BOT_AT, s: BOT_S },
];

/** A bucket beside it, a fish's tail out of the top. */
const bucket: Item = [
  'g',
  ['cyl', 0.03, 0, 0.05, 8, 'sky.shade', 'sky.base', 'sky.shade'],
  ['cyl', 0.026, 0.045, 0.052, 8, 'nature.water'],
  ['box', 0.01, 0.04, 0.03, 'coral.base', { at: [0.006, 0.07, 0], rot: [0, 0, 0.3] }],
  {
    at: [BOT_AT[0] + 0.1, DECK_Y + 0.009, BOT_AT[2] - 0.01],
  },
];

/**
 * The rod in the robot's hands ('rod': it dips and lifts about them): out over the water, its
 * line down to a coral float. Built in the robot's frame (+Z where it faces).
 */
/** The line, from the tip down to the water. */
const LINE = TIP[1] + HANDS[1] + BOT_AT[1] - WATER_Y;
const rod: Item = [
  'g',
  [
    'box',
    0.012,
    0.012,
    ROD_LEN,
    'nature.bark',
    { at: [0, TIP[1] / 2, TIP[2] / 2], rot: [-ROD_UP, 0, 0] },
  ],
  ['box', 0.022, 0.022, 0.03, 'space.600', { at: [0.016, 0.012, 0.02] }],
  ['box', 0.005, LINE, 0.005, 'ink.high', { at: [0, TIP[1] - LINE / 2, TIP[2]] }],
  ['bead', 0.018, 'coral.base', { at: [0, TIP[1] - LINE + 0.01, TIP[2]] }],
  ['bead', 0.012, 'ink.high', { at: [0, TIP[1] - LINE + 0.024, TIP[2]] }],
  { at: [BOT_AT[0], BOT_AT[1] + HANDS[1], BOT_AT[2] + HANDS[2]] },
];

// --- Boats ----------------------------------------------------------------------------------------

/** A small sailboat: a white hull with a coral stripe, a mast and a sail. */
const sailboat = (at: Vec3, yaw: number): Item => [
  'g',
  ['box', 0.16, 0.035, 0.06, 'ink.high', { at: [0, 0.012, 0] }],
  ['box', 0.06, 0.03, 0.044, 'ink.high', { at: [0.09, 0.014, 0], rot: [0, Math.PI / 4, 0] }],
  ['box', 0.162, 0.01, 0.062, 'coral.base', { at: [0, 0.022, 0] }],
  ['box', 0.008, 0.2, 0.008, 'nature.bark', { at: [0.0, 0.12, 0] }],
  [
    'fin',
    [
      [0.005, 0.03],
      [0.1, 0.035],
      [0.005, 0.21],
    ],
    0.008,
    'ink.high',
  ],
  [
    'fin',
    [
      [-0.005, 0.05],
      [-0.005, 0.18],
      [-0.06, 0.05],
    ],
    0.008,
    'butter.light',
  ],
  { at, rot: [0, yaw, 0] },
];

/** A fishing boat moored by the jetty: a hull, a wheelhouse with a lit window. */
const trawler = (at: Vec3, yaw: number): Item => [
  'g',
  ['box', 0.2, 0.045, 0.08, 'sky.base', { at: [0, 0.015, 0] }],
  ['box', 0.07, 0.04, 0.058, 'sky.base', { at: [0.11, 0.018, 0], rot: [0, Math.PI / 4, 0] }],
  ['box', 0.202, 0.012, 0.082, 'ink.high', { at: [0, 0.035, 0] }],
  ['box', 0.07, 0.06, 0.06, 'ink.high', { at: [-0.04, 0.07, 0] }],
  ['box', 0.08, 0.012, 0.07, 'coral.base', { at: [-0.04, 0.105, 0] }],
  ['box', 0.03, 0.02, 0.062, 'lamp.window', { at: [-0.04, 0.075, 0], g: 1 }],
  ['box', 0.006, 0.12, 0.006, 'ink.mid', { at: [0.04, 0.1, 0] }],
  { at, rot: [0, yaw, 0] },
];

// --- The lab on the hill --------------------------------------------------------------------------

/** One screen of the lab: a dark pane and the bots' win rates as bars (mint, the best one). */
const screen = (bars: readonly number[], x: number): Item => [
  'g',
  ...bars.map((h, i): Item => [
    'box',
    0.018,
    h,
    0.014,
    i === bars.length - 1 ? 'mint.base' : 'sky.light',
    { at: [-0.03 + i * 0.026, -0.03 + h / 2, 0.006], g: 1 },
  ]),
  ['box', 0.1, 0.075, 0.01, 'space.900', { g: 1 }],
  { at: [x, 0, 0] },
];
const LAB_Y = G.h(LAB.x, LAB.z);
const lab: Item = [
  'g',
  // The window of screens along its front, listed first: the first to reach a cube takes it.
  [
    'g',
    screen([0.03, 0.045, 0.06], -0.105),
    screen([0.05, 0.035, 0.065], 0),
    screen([0.025, 0.05, 0.07], 0.105),
    { at: [0, 0.105, 0.108] },
  ],
  ['box', 0.05, 0.075, 0.012, 'sky.shade', { at: [0.13, 0.04, 0.104] }],
  ['box', 0.33, 0.1, 0.012, 'space.600', { at: [0, 0.105, 0.102] }],
  ['box', 0.34, 0.17, 0.2, 'ink.high', { at: [0, 0.085, 0] }],
  ['box', 0.36, 0.02, 0.22, 'sky.shade', { at: [0, 0.18, 0] }],
  ['box', 0.345, 0.025, 0.205, 'sky.base', { at: [0, 0.015, 0] }],
  // A dish on the roof, a mast with its lamp.
  ['cyl', 0.012, 0.19, 0.24, 6, 'ink.mid', { at: [-0.1, 0, -0.04] }],
  [
    'cone',
    0.06,
    0.015,
    0.0,
    0.03,
    8,
    'ink.high',
    'ink.high',
    'ink.mid',
    { at: [-0.1, 0.27, -0.03], rot: [0.9, 0, 0] },
  ],
  ['box', 0.01, 0.12, 0.01, 'ink.mid', { at: [0.12, 0.25, -0.05] }],
  beacon([0.12, 0.315, -0.05]),
  { at: [LAB.x, LAB_Y, LAB.z] },
];

// --- The beacon tower on the point ----------------------------------------------------------------

const POINT_Y = G.h(POINT.x, POINT.z);
const STRIPES: readonly ColorPath[] = [
  'ink.high',
  'coral.base',
  'ink.high',
  'coral.base',
  'ink.high',
];
const TOWER = 0.5;
const tower: Item = [
  'g',
  ['cyl', 0.11, -0.03, 0.04, 8, 'nature.rock', 'nature.rock', 'nature.flint'],
  ...STRIPES.map((c, i): Item => {
    const y0 = 0.04 + (i * TOWER) / STRIPES.length;
    const y1 = 0.04 + ((i + 1) * TOWER) / STRIPES.length;
    const r = (y: number): number => 0.085 - (0.03 * (y - 0.04)) / TOWER;
    return ['cone', r(y0), r(y1), y0, y1, 10, c];
  }),
  ['box', 0.022, 0.04, 0.01, 'lamp.window', { at: [0, 0.18, 0.082], g: 1 }],
  ['box', 0.022, 0.04, 0.01, 'lamp.window', { at: [0, 0.36, 0.072], g: 1 }],
  ['box', 0.03, 0.05, 0.012, 'nature.wood', { at: [0, 0.065, 0.088] }],
  ['cyl', 0.088, TOWER + 0.035, TOWER + 0.055, 10, 'space.600'],
  ['around', 4, 0.4, 0.062, TOWER + 0.1, 0, ['box', 0.01, 0.09, 0.01, 'space.600']],
  ['cyl', 0.075, TOWER + 0.145, TOWER + 0.16, 10, 'space.600'],
  ['cone', 0.072, 0.0, TOWER + 0.16, TOWER + 0.26, 10, 'coral.shade'],
  ['bead', 0.02, 'coral.shade', { at: [0, TOWER + 0.27, 0] }],
  { at: [POINT.x, POINT_Y, POINT.z] },
];
/** Its lamp, a part of its own so that it can breathe ('lantern'). */
const lantern: Item = [
  'g',
  ['cyl', 0.058, TOWER + 0.055, TOWER + 0.145, 10, 'nature.lamp'],
  ['bead', 0.045, 'star.warm', { at: [0, TOWER + 0.1, 0] }],
  { at: [POINT.x, POINT_Y, POINT.z], g: 2 },
];

// --- The beach and its trees ----------------------------------------------------------------------

/** A palm: a leaning trunk in segments, a crown of drooping fronds and coconuts. */
const palm = (at: Vec3, s = 1, lean = 0, seed = 0): Item => [
  'g',
  ...[0, 1, 2, 3, 4].map((i): Item => [
    'box',
    0.03 - i * 0.002,
    0.06,
    0.03 - i * 0.002,
    i % 2 ? 'nature.wood' : 'nature.bark',
    { at: [0.018 * i * i * 0.25, 0.03 + i * 0.055, 0], rot: [0, 0, -0.08 * i] },
  ]),
  ...Array.from({ length: 6 }, (_, i): Item => {
    const b = (i / 6) * Math.PI * 2 + seed;
    return [
      'box',
      0.13,
      0.012,
      0.04,
      i % 2 ? 'nature.moss' : 'nature.grass',
      { at: [0.1 + 0.055 * Math.cos(b), 0.29, 0.055 * Math.sin(b)], rot: [0, -b, -0.45] },
    ];
  }),
  ['bead', 0.022, 'nature.bark', { at: [0.1, 0.27, 0.015] }],
  ['bead', 0.02, 'nature.bark', { at: [0.085, 0.27, -0.015] }],
  { at, s, rot: [0, lean, 0] },
];

type Clear = readonly (readonly [number, number, number])[];

/** The boathouse on the right shore, by the jetty, and where its smoke leaves. */
const HOUSE = G.brg(VIEW - 88, 0.7);
const HOUSE_SPIN = face(VIEW - 30);
const HOUSE_S = 1.05;
const CHIMNEY = chimneyOf(HOUSE, HOUSE_S, HOUSE_SPIN);
/** The bay spills over the rim on the right. */
const FALL = VIEW - 35;
const OUTLET = { x: at2(FALL, 0.6)[0], z: at2(FALL, 0.6)[1], r: 0.07 };
/** A path from the boathouse up to the lab. */
const PATH_A = [HOUSE[0] - 0.05, HOUSE[2] - 0.12] as const;
const PATH_B = [LAB.x + 0.12, LAB.z + 0.14] as const;

const CLEAR: Clear = [
  [BAY.x, BAY.z, BAY.r + 0.1],
  [POINT.x, POINT.z, 0.17],
  [LAB.x, LAB.z, 0.26],
  [HOUSE[0], HOUSE[2], 0.16],
  [OUTLET.x, OUTLET.z, 0.1],
  [(PATH_A[0] + PATH_B[0]) / 2, (PATH_A[1] + PATH_B[1]) / 2, 0.08],
];

/** Trees: palms near the beach and the rim, round trees and pines inland, low in front. */
function grove(isle: Isle, n: number, seed: number): Item[] {
  const out: Item[] = [];
  const taken: [number, number][] = [];
  for (let i = 0; out.length < n && i < n * 12; i += 1) {
    const b = (jitter(seed, i * 3) + 1) * Math.PI;
    const rr = isle.r * (0.32 + 0.6 * ((jitter(seed, i * 3 + 1) + 1) / 2));
    const x = rr * Math.sin(b);
    const z = -rr * Math.cos(b);
    if (CLEAR.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) continue;
    if (taken.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 0.11)) continue;
    taken.push([x, z]);
    const deg = ((((b * 180) / Math.PI) % 360) + 360) % 360;
    const front = Math.abs(((deg - VIEW + 540) % 360) - 180) < 40;
    const s = 0.8 + 0.35 * ((jitter(seed, i * 3 + 2) + 1) / 2);
    const at = isle.at(x, z);
    const k = out.length % 5;
    out.push(
      front
        ? bush(at, s * 1.1, k % 2 ? 'nature.moss' : 'nature.grass')
        : rr > 0.7 || k === 0
          ? palm(at, s * 1.05, b + 0.6 * jitter(seed, i), i)
          : k === 1 || k === 3
            ? pine(at, s)
            : tree(at, s, k === 2 ? 'nature.grass' : 'nature.moss', 'nature.meadow'),
    );
  }
  return out;
}

export const fishai: Rows = [
  G.hull,
  ['buoys', FLAG.decal, ...buoys],
  ['bay', FLAG.decal, ...bay],
  [
    'jetty',
    0,
    jetty,
    bucket,
    trawler([JETTY_FROM[0] - 0.06, WATER_Y - 0.01, JETTY_FROM[1] + 0.14], JETTY_YAW + 0.1),
  ],
  ['robot', 0, robot],
  ['rod', 0, rod],
  [
    'boats',
    0,
    sailboat(
      [BAY.x + at2(VIEW + 100, 0.19)[0], WATER_Y - 0.008, BAY.z + at2(VIEW + 100, 0.19)[1]],
      0.8,
    ),
  ],
  ['lab', 0, lab],
  ['beacon-tower', 0, tower],
  ['lantern', 0, lantern],
  [
    'grove',
    0,
    ...grove(G, 28, 13),
    palm(
      G.at(BAY.x + at2(VIEW + 95, BAY.r + 0.1)[0], BAY.z + at2(VIEW + 95, BAY.r + 0.1)[1]),
      1.2,
      2.4,
      1,
    ),
    palm(
      G.at(BAY.x + at2(VIEW + 130, BAY.r + 0.09)[0], BAY.z + at2(VIEW + 130, BAY.r + 0.09)[1]),
      1,
      3.4,
      2,
    ),
    rock(G.at(POINT.x + 0.12, POINT.z + 0.06), 1.3, 1),
    rock(G.at(POINT.x - 0.1, POINT.z + 0.1), 1, 2),
    rock(G.brg(VIEW + 70, 0.86), 1.1, 3),
    rock(G.brg(VIEW - 130, 0.86), 0.9, 4),
  ],
  ['meadow', 0, ...flowers(G, 28, 13, CLEAR.slice(0, 3))],
  [
    'boathouse',
    0,
    cottage(HOUSE, HOUSE_S, 'nature.sand', 'sky.shade', HOUSE_SPIN),
    ...stones(G, PATH_A, PATH_B, 6, 'nature.flint'),
    lamppost(G.at(PATH_A[0] + 0.07, PATH_A[1] - 0.02), 1),
    lamppost(G.at(PATH_B[0] + 0.08, PATH_B[1] + 0.02), 1),
  ],
  ['falls', FLAG.decal, ...falls(G, FALL, OUTLET, 0.72)],
  ['flow', 0, flow(G, FALL, 0.72)],
  ['smoke-1', 0, puff([CHIMNEY[0], CHIMNEY[1] + 0.02, CHIMNEY[2]], 0.9)],
  ['smoke-2', 0, puff([CHIMNEY[0], CHIMNEY[1] + 0.02, CHIMNEY[2]], 1.1)],
  [
    'leaves',
    0,
    leaves(G.brg(VIEW + 110, 0.7, 0.2), ['nature.grass', 'nature.meadow', 'nature.moss']),
  ],
  ['crystals', 0, ...G.crystals],
  ['gulls', 0, ...gulls(5, 0.8, 0.68, 13)],
  ['islets', 0, islet([0.58, -0.56, -0.96], 0.9, 5), islet([-1.06, -0.5, -0.5], 1, 6)],
  ['clouds', 0, cloud([-1.2, 0.6, -0.48], 0.85), cloud([1.24, 0.66, 0.3], 0.8)],
];
