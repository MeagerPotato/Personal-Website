import { TAU } from '../../sim/math';
import type { Vec3 } from '../../sim/world/kit';
import type { ColorPath } from '../../sim/world/palette';
import { FLAG, type BodyRecipe, type Item, type PartRow, type Rows } from '../../sim/world/rows';
import { beacon, nth } from './shared';
import { chip, crane } from '../../sim/world/planned';
import type { ThemeKey } from '../tokens';
import { TOP, cloud, cottage, falls, isle, jitter, on, onBrg, pine, stones, tree } from './isles';

/**
 * THE PROJECT WORLDS AS ISLANDS (2026-11-16: Allen asked for "a complete design/visual refresh
 * for the entire galaxy", "extremely visually stunning", taking from his voxel turtle-island
 * reference). Each project is a floating island (isles.ts) with its story built on top, as a
 * diorama: what it is at a glance, and the life round it (water off the edge, trees, a cottage,
 * a cloud). Keyed by manifest id, as design/worlds/bodies.ts reads them.
 *
 * DESIGN SURFACE: the rows are free to change; their part names are what the motion table and
 * the tests refer to.
 */

// --- Robotics: a VEX field on the island ---------------------------------------------------------

/** The field: grey tiles inside a low wall, the stake in the middle with its rings, two goals. */
const FIELD = 0.5;
const field: Item[] = [
  ['box', FIELD * 2, 0.03, FIELD * 2, 'ink.low', { at: on(0, 0, 0.015) }],
  // The tiles' seams, a cross of darker lines.
  ['box', FIELD * 2, 0.034, 0.012, 'space.600', { at: on(0, 0, 0.015) }],
  ['box', 0.012, 0.034, FIELD * 2, 'space.600', { at: on(0, 0, 0.015) }],
  ...[-1, 1].flatMap((side): Item[] => [
    ['box', FIELD * 2 + 0.04, 0.07, 0.03, 'ink.high', { at: on(0, side * FIELD, 0.035) }],
    ['box', 0.03, 0.07, FIELD * 2, 'ink.high', { at: on(side * FIELD, 0, 0.035) }],
  ]),
];

/** A mobile goal: a hexagon base with its stake, rings stacked on it. */
const goal = (x: number, z: number, family: 'coral' | 'sky'): Item => [
  'g',
  ['cyl', 0.09, 0, 0.05, 6, 'butter.base'],
  ['cyl', 0.018, 0.05, 0.26, 6, 'ink.mid'],
  ['ring', [0.035, 0.075], 0, TAU, 6, 0.06, 0.09, `${family}.light`, `${family}.base`, 1],
  ['ring', [0.035, 0.075], 0, TAU, 6, 0.1, 0.13, `${family}.light`, `${family}.base`, 1],
  { at: on(x, z, 0.03) },
];

/** The robot: a coral chassis on four wheels, a tower and the arm that lifts the rings. */
const bot: Item = [
  'g',
  ['box', 0.2, 0.06, 0.22, 'coral.base', { at: [0, 0.07, 0] }],
  ...[-1, 1].flatMap((sx): Item[] =>
    [-1, 1].map((sz): Item => [
      'cyl',
      0.04,
      -0.02,
      0.02,
      8,
      'space.600',
      { at: [sx * 0.12, 0.04, sz * 0.07], rot: [0, 0, Math.PI / 2] },
    ]),
  ),
  ['box', 0.06, 0.16, 0.06, 'ink.high', { at: [0, 0.18, -0.05] }],
  ['box', 0.04, 0.03, 0.18, 'coral.light', { at: [0, 0.25, 0.04] }],
  ['box', 0.05, 0.03, 0.01, 'lamp.window', { at: [0, 0.1, 0.111], g: 1 }],
];

/** Where the robot stands on its field, [x, z] (its pose cloud, near.ts, gathers round it). */
export const ROBOT_AT = [0.2, 0.24] as const;

const robotics: Rows = [
  isle({ seed: 3 }),
  ['field', 0, ...field],
  [
    'stake-rings',
    0,
    ['cyl', 0.03, TOP + 0.03, TOP + 0.5, 6, 'ink.mid'],
    ...([0.04, 0.09, 0.14] as const).map((y, i): Item => [
      'ring',
      [0.05, 0.1],
      0,
      TAU,
      6,
      TOP + y,
      TOP + y + 0.04,
      i === 1 ? 'sky.light' : 'coral.light',
      i === 1 ? 'sky.base' : 'coral.base',
      1,
    ]),
    beacon(on(0, 0, 0.52)),
  ],
  ['goals', 0, goal(-0.3, 0.28, 'coral'), goal(0.3, -0.28, 'sky')],
  ['bot', 0, ['g', bot, { at: on(ROBOT_AT[0], ROBOT_AT[1], 0.03), rot: [0, -0.7, 0] }]],
  [
    'grove',
    0,
    pine(onBrg(300, 0.82), 1.1),
    pine(onBrg(318, 0.74), 0.8),
    tree(onBrg(60, 0.84), 0.9),
    cottage(onBrg(135, 0.8), 1, 'ink.high', 'coral.base', 0.6),
  ],
  ['falls', 0, ...falls(225, { x: -0.62, z: 0.62, r: 0.1 })],
  ['clouds', 0, cloud([-1.05, 0.55, -0.3], 0.9), cloud([0.95, -0.35, 0.5], 0.7)],
];

// --- CyberPatriot: a fortress on a snowy island ----------------------------------------------------

/** A crenellated wall from one corner to the next, its merlons every `step`. */
const wall = (x0: number, z0: number, x1: number, z1: number, h = 0.16): Item => {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const yaw = Math.atan2(x1 - x0, z1 - z0);
  const n = Math.max(2, Math.round(len / 0.09));
  return [
    'g',
    ['box', 0.06, h, len, 'ink.mid', { at: [0, h / 2, 0] }],
    ...Array.from({ length: n }, (_, i): Item => [
      'box',
      0.07,
      0.05,
      0.045,
      'ink.mid',
      { at: [0, h + 0.025, -len / 2 + (len * (i + 0.5)) / n] },
    ]),
    { at: [(x0 + x1) / 2, TOP, (z0 + z1) / 2], rot: [0, yaw, 0] },
  ];
};

/** A round tower with a sky roof. */
const tower = (x: number, z: number, h = 0.32): Item => [
  'g',
  ['cyl', 0.09, 0, h, 8, 'ink.high', 'ink.mid', 'ink.high'],
  ['cone', 0.11, 0, h, h + 0.14, 8, 'sky.base'],
  ['box', 0.03, 0.04, 0.01, 'lamp.window', { at: [0, h * 0.7, 0.09], g: 1 }],
  { at: on(x, z) },
];

const CASTLE = 0.42;
const cyberpatriot: Rows = [
  isle({ seed: 7, grass: 'biome.frost.high', turf: 'biome.frost.low', soil: 'biome.dune.sea' }),
  [
    'walls',
    0,
    wall(-CASTLE, -CASTLE, CASTLE, -CASTLE),
    wall(CASTLE, -CASTLE, CASTLE, CASTLE),
    wall(-CASTLE, CASTLE, -CASTLE, -CASTLE),
    // The gate's side: two walls with the gate between.
    wall(-CASTLE, CASTLE, -0.1, CASTLE),
    wall(0.1, CASTLE, CASTLE, CASTLE),
    ['box', 0.2, 0.06, 0.07, 'ink.mid', { at: on(0, CASTLE, 0.19) }],
    ['box', 0.14, 0.13, 0.02, 'biome.dune.sea', { at: on(0, CASTLE + 0.01, 0.065) }],
    ...stones([0, CASTLE + 0.06], [0, 0.9], 4, 'ink.low'),
    tower(-CASTLE, -CASTLE),
    tower(CASTLE, -CASTLE),
    tower(-CASTLE, CASTLE),
    tower(CASTLE, CASTLE),
  ],
  // The keep: the team's machine, a monitor on its roof with the checklist, two fixed (mint),
  // two still open (coral).
  [
    'keep',
    0,
    ['box', 0.3, 0.3, 0.26, 'ink.high', { at: on(0, -0.06, 0.15) }],
    ['box', 0.34, 0.03, 0.3, 'sky.base', { at: on(0, -0.06, 0.315) }],
    ['box', 0.36, 0.22, 0.03, 'space.600', { at: on(0, -0.1, 0.45) }],
    ['box', 0.04, 0.12, 0.04, 'ink.mid', { at: on(0, -0.1, 0.33) }],
  ],
  [
    'monitor-screen',
    0,
    ...(['mint', 'mint', 'coral', 'coral'] as const).map((family, i): Item => [
      'box',
      0.26,
      0.03,
      0.012,
      `${family}.base`,
      { at: on(0.01, -0.082, 0.52 - i * 0.045), g: 1 },
    ]),
  ],
  [
    'flags',
    0,
    ...([-1, 1] as const).map((s): Item => [
      'g',
      ['box', 0.015, 0.22, 0.015, 'ink.mid', { at: [0, 0.11, 0] }],
      ['box', 0.12, 0.07, 0.01, 'sky.base', { at: [0.06, 0.18, 0] }],
      { at: on(s * CASTLE, -CASTLE, 0.46) },
    ]),
  ],
  [
    'grove',
    0,
    pine(onBrg(80, 0.82), 1, 'biome.frost.sea'),
    pine(onBrg(96, 0.7), 0.8, 'biome.frost.sea'),
    pine(onBrg(250, 0.8), 0.9, 'biome.frost.sea'),
    pine(onBrg(270, 0.85), 0.7, 'biome.frost.sea'),
  ],
  ['clouds', 0, cloud([1.0, 0.6, 0.3], 0.8)],
];

// --- Canadian Fish: an island of the card game, a fish leaping from its lake -----------------------

/** A playing card standing on its edge, a standing stone of the game. */
const card = (at: Vec3, yaw: number, face: ColorPath): Item => [
  'g',
  ['box', 0.16, 0.24, 0.025, 'ink.high', { at: [0, 0.12, 0] }],
  ['box', 0.1, 0.16, 0.03, face, { at: [0, 0.12, 0] }],
  { at, rot: [0, yaw, 0] },
];

/** A fish of cubes, nose along +X: body, tail and a dorsal fin, in the sky family's stripes. */
const fish = (s = 1): Item => [
  'g',
  ['box', 0.34, 0.16, 0.12, 'sky.base'],
  ['box', 0.2, 0.1, 0.13, 'sky.light', { at: [0.04, -0.04, 0] }],
  ['box', 0.08, 0.1, 0.1, 'sky.base', { at: [0.2, 0, 0] }],
  ['box', 0.08, 0.2, 0.04, 'sky.shade', { at: [-0.21, 0, 0] }],
  ['box', 0.1, 0.07, 0.03, 'sky.shade', { at: [0, 0.11, 0] }],
  ['box', 0.03, 0.03, 0.135, 'space.900', { at: [0.17, 0.03, 0] }],
  { s },
];

const LAKE = { x: -0.1, z: 0.1, r: 0.36 };
const canadianFish: Rows = [
  isle({ seed: 11, grass: 'biome.tide.shore', turf: 'biome.tide.low', soil: 'biome.dune.shore' }),
  [
    'lake',
    0,
    ['cyl', LAKE.r, TOP - 0.03, TOP + 0.012, 12, 'biome.tide.sea', { at: [LAKE.x, 0, LAKE.z] }],
    [
      'ring',
      [LAKE.r, LAKE.r + 0.06],
      0,
      TAU,
      12,
      TOP,
      TOP + 0.02,
      'biome.dune.high',
      'biome.dune.high',
      1,
      { at: [LAKE.x, 0, LAKE.z] },
    ],
  ],
  [
    'card-fan',
    0,
    ...[-60, -36, -12, 12, 36, 60].map((deg, i): Item =>
      card(onBrg(deg + 20, 0.72), ((deg + 20) * Math.PI) / 180, i % 2 ? 'coral.base' : 'sky.base'),
    ),
  ],
  [
    'leap',
    0,
    ['g', fish(1.1), { at: [LAKE.x, TOP + 0.34, LAKE.z], rot: [0, 0.5, 0.6] }],
    // The splash it left.
    [
      'ring',
      [0.06, 0.11],
      0,
      TAU,
      8,
      TOP + 0.012,
      TOP + 0.03,
      'ink.high',
      'ink.high',
      1,
      { at: [LAKE.x - 0.16, 0, LAKE.z + 0.1] },
    ],
  ],
  [
    'grove',
    0,
    tree(onBrg(160, 0.8), 1, 'biome.tide.low', 'biome.tide.shore'),
    tree(onBrg(185, 0.68), 0.75, 'biome.tide.low', 'biome.tide.shore'),
    cottage(onBrg(300, 0.62), 1, 'ink.high', 'sky.base', 2.4),
  ],
  [
    'falls',
    0,
    ...falls(130, { x: LAKE.x + 0.25, z: LAKE.z + 0.2, r: 0.01 }, 0.7, 'biome.tide.sea'),
  ],
  ['clouds', 0, cloud([-1.0, 0.5, 0.4], 0.8)],
];

// --- FishAI: the bots' lab, a robot fishing off a jetty --------------------------------------------

const fishai: Rows = [
  isle({
    seed: 13,
    r: 0.95,
    grass: 'biome.tide.shore',
    turf: 'biome.tide.low',
    soil: 'biome.dune.shore',
  }),
  [
    'jetty',
    0,
    ['box', 0.16, 0.03, 0.5, 'biome.dune.sea', { at: on(0.35, 0.55, 0.0), rot: [0, 0.6, 0] }],
    ['cyl', 0.42, TOP - 0.03, TOP + 0.01, 12, 'biome.tide.sea', { at: [0.2, 0, 0.3] }],
  ],
  [
    'robot',
    0,
    [
      'g',
      ['box', 0.16, 0.18, 0.12, 'ink.high', { at: [0, 0.09, 0] }],
      ['box', 0.12, 0.1, 0.1, 'ink.high', { at: [0, 0.24, 0] }],
      ['box', 0.08, 0.025, 0.01, 'sky.light', { at: [0, 0.25, 0.055], g: 1 }],
      ['box', 0.01, 0.08, 0.01, 'ink.mid', { at: [0, 0.33, 0] }],
      beacon([0, 0.38, 0]),
      { at: on(-0.2, -0.1), rot: [0, 0.6, 0] },
    ],
  ],
  [
    'rod',
    0,
    ['box', 0.012, 0.012, 0.6, 'biome.dune.sea', { at: on(0.0, 0.12, 0.3), rot: [0.5, 0.6, 0] }],
    ['box', 0.004, 0.32, 0.004, 'ink.high', { at: on(0.17, 0.36, 0.2) }],
    ['bead', 0.025, 'coral.base', { at: on(0.17, 0.36, 0.03) }],
  ],
  // The simulation lab: a bank of screens, each a game's win rate.
  [
    'win-ring',
    0,
    ...[0, 1, 2].map((i): Item => [
      'g',
      ['box', 0.16, 0.12, 0.03, 'space.600', { at: [0, 0.1, 0] }],
      ['box', 0.12 * (0.5 + 0.2 * i), 0.03, 0.035, 'mint.base', { at: [-0.02, 0.1, 0], g: 1 }],
      ['box', 0.02, 0.06, 0.02, 'ink.mid', { at: [0, 0.02, 0] }],
      { at: onBrg(220 + i * 28, 0.62), rot: [0, ((220 + i * 28) * Math.PI) / 180, 0] },
    ]),
  ],
  [
    'grove',
    0,
    pine(onBrg(320, 0.75), 0.9, 'biome.tide.low'),
    tree(onBrg(20, 0.78), 0.8, 'biome.tide.low', 'biome.tide.shore'),
  ],
];

// --- Fish Onboarding: eight stepping stones up to the phone ---------------------------------------

const QR = [
  '###.#.###',
  '#.#...#.#',
  '###.#.###',
  '.........',
  '#.#.#.#.#',
  '.........',
  '###.#.#..',
  '#.#...###',
  '###.#.#.#',
];
const fishOnboarding: Rows = [
  isle({
    seed: 17,
    r: 0.95,
    grass: 'biome.bloom.low',
    turf: 'biome.bloom.shore',
    soil: 'biome.dune.sea',
  }),
  [
    'steps',
    0,
    ...Array.from({ length: 8 }, (_, i): Item => {
      const b = (200 + i * 30) * (Math.PI / 180);
      const r = 0.72 - i * 0.055;
      const checkpoint = i === 2 || i === 5;
      const h = 0.02 + i * 0.025;
      return [
        'box',
        0.12,
        h,
        0.12,
        checkpoint ? 'coral.base' : 'ink.high',
        { at: [Math.sin(b) * r, TOP + h / 2, -Math.cos(b) * r] },
      ];
    }),
  ],
  [
    'phone',
    0,
    ['box', 0.3, 0.52, 0.06, 'space.600', { at: on(0.05, -0.05, 0.36), rot: [0, -0.4, 0] }],
    ['box', 0.26, 0.44, 0.065, 'ink.high', { at: on(0.05, -0.05, 0.38), rot: [0, -0.4, 0] }],
  ],
  [
    'qr-code',
    FLAG.decal,
    // On the phone's face (it faces +Z turned by -0.4), just in front of it.
    ['pix', QR, 0.026, 'space.900', { at: on(0.036, -0.018, 0.42), rot: [0, -0.4, 0], g: 1 }],
  ],
  [
    'grove',
    0,
    tree(onBrg(90, 0.78), 0.9, 'biome.bloom.sea', 'biome.bloom.shore'),
    tree(onBrg(110, 0.66), 0.7, 'biome.bloom.sea', 'biome.bloom.shore'),
  ],
  ['clouds', 0, cloud([0.9, 0.55, -0.5], 0.7)],
];

// --- Days2Meet: a month laid out as a garden, each bed as busy as the day is free -------------------

// prettier-ignore
const HEAT = [[1, 1, 2, 1, 0, 1, 1], [2, 2, 3, 2, 1, 2, 2], [1, 2, 3, 3, 2, 2, 1], [2, 3, 3, 2, 1, 3, 3], [1, 2, 2, 1, 1, 4, 4]];
const RAMP = ['ink.low', 'sky.shade', 'sky.base', 'mint.base', 'mint.light'] as const;
const BED = 0.105;
/** The middle of the bed of day `col` in week `row`. */
const bedAt = (col: number, row: number): [number, number] => [
  (col - 3) * BED,
  (row - 2) * BED - 0.08,
];
const days2meet: Rows = [
  isle({ seed: 19 }),
  [
    'month-grid',
    0,
    ['box', BED * 7 + 0.05, 0.03, BED * 5 + 0.05, 'ink.high', { at: on(0, -0.08, 0.015) }],
    ...HEAT.flatMap((week, row) =>
      week.map((heat, col): Item => {
        const [x, z] = bedAt(col, row);
        return [
          'box',
          BED - 0.02,
          0.03 + heat * 0.018,
          BED - 0.02,
          nth(RAMP, heat),
          { at: on(x, z, 0.03 + heat * 0.009) },
        ];
      }),
    ),
  ],
  // The day everyone is free: a flag on its bed.
  [
    'best-day',
    0,
    ['box', 0.012, 0.22, 0.012, 'ink.mid', { at: on(bedAt(6, 4)[0], bedAt(6, 4)[1], 0.18) }],
    [
      'box',
      0.1,
      0.06,
      0.01,
      'butter.base',
      { at: on(bedAt(6, 4)[0] + 0.05, bedAt(6, 4)[1], 0.26) },
    ],
  ],
  // The brush that paints a respondent's free hours, sweeping a row.
  [
    'paint-cursor',
    0,
    [
      'g',
      ['box', 0.03, 0.14, 0.03, 'biome.dune.sea', { at: [0, 0.07, 0] }],
      ['box', 0.06, 0.05, 0.06, 'coral.base', { at: [0, 0.02, 0] }],
      { at: on(0, bedAt(0, 1)[1], 0.12) },
    ],
  ],
  // The clock tower that says when.
  [
    'clock-tower',
    0,
    ['box', 0.16, 0.46, 0.16, 'ink.high', { at: on(0, -0.62, 0.23) }],
    ['cone', 0.13, 0, 0.46, 0.62, 4, 'sky.base', { at: on(0, -0.62), rot: [0, Math.PI / 4, 0] }],
    [
      'cyl',
      0.055,
      -0.01,
      0.0,
      10,
      'butter.light',
      { at: on(0, -0.538, 0.36), rot: [Math.PI / 2, 0, 0] },
    ],
    ['box', 0.008, 0.045, 0.004, 'space.900', { at: on(0, -0.533, 0.375) }],
  ],
  [
    'grove',
    0,
    tree(onBrg(70, 0.8), 0.9),
    tree(onBrg(290, 0.8), 0.9),
    pine(onBrg(110, 0.78), 0.8),
    cottage(onBrg(240, 0.74), 0.9, 'ink.high', 'mint.base', 1.0),
  ],
  ['falls', 0, ...falls(160, { x: 0.32, z: 0.52, r: 0.08 })],
  ['clouds', 0, cloud([-1.0, 0.55, -0.3], 0.8)],
];

// --- Hackathons ---------------------------------------------------------------------------------

/** HackGT 13 (HEARSAY): a listening post, a dish turned to the sky, and the clip it is judging. */
const hackgt: Rows = [
  isle({ seed: 23, grass: 'biome.tide.low', turf: 'biome.tide.shore' }),
  [
    'dish',
    0,
    ['box', 0.22, 0.2, 0.22, 'ink.high', { at: on(0, 0, 0.1) }],
    ['box', 0.06, 0.16, 0.06, 'ink.mid', { at: on(0, 0, 0.28) }],
    [
      'cone',
      0.3,
      0.06,
      0.36,
      0.48,
      10,
      'ink.high',
      'ink.mid',
      'ink.high',
      { at: on(0, 0), rot: [0.4, 0, 0] },
    ],
    ['box', 0.015, 0.2, 0.015, 'ink.mid', { at: on(0, 0.05, 0.55), rot: [0.4, 0, 0] }],
    beacon(on(0, 0.09, 0.66)),
  ],
  // The clip on a big screen: its waveform as bars, the synthetic stretch in coral.
  [
    'waveform',
    0,
    ['box', 0.62, 0.3, 0.03, 'space.600', { at: on(0, 0.56, 0.2) }],
    ...Array.from({ length: 13 }, (_, i): Item => {
      const h = 0.04 + 0.17 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6));
      return [
        'box',
        0.03,
        h,
        0.035,
        i >= 8 ? 'coral.base' : 'lilac.light',
        { at: on(-0.26 + i * 0.043, 0.56, 0.2), g: 1 },
      ];
    }),
    ['box', 0.04, 0.2, 0.04, 'ink.mid', { at: on(-0.25, 0.56, -0.02) }],
    ['box', 0.04, 0.2, 0.04, 'ink.mid', { at: on(0.25, 0.56, -0.02) }],
  ],
  // The sound it hears, rings rising from the dish.
  [
    'wave-ring',
    0,
    ...[0, 1, 2].map((i): Item => [
      'ring',
      [0.18 + i * 0.09, 0.2 + i * 0.09],
      0,
      TAU,
      12,
      0,
      0.012,
      'lilac.light',
      'lilac.light',
      1,
      { at: on(0, 0.12, 0.7 + i * 0.1), rot: [0.4, 0, 0], g: 1 },
    ]),
  ],
  // What it hears goes out again: a dashed ring of signal round the island, in the ship's lane.
  [
    'signal',
    0,
    ...Array.from({ length: 12 }, (_, i): Item => [
      'ring',
      [1.3, 1.365],
      (i / 12) * TAU,
      ((i + 0.62) / 12) * TAU,
      3,
      -0.012,
      0.012,
      'lilac.light',
      'lilac.base',
      1,
    ]),
  ],
  [
    'grove',
    0,
    pine(onBrg(250, 0.8), 1, 'biome.tide.high'),
    pine(onBrg(270, 0.72), 0.7, 'biome.tide.high'),
    cottage(onBrg(110, 0.74), 0.9, 'ink.high', 'lilac.base', 2),
  ],
  ['clouds', 0, cloud([1.0, 0.5, -0.4], 0.8)],
];

/** A hacker bus, nose along +X: a rounded box, its windows, the sign and four wheels. */
const bus = (family: 'butter' | 'sky' = 'butter'): Item => [
  'g',
  ['box', 0.42, 0.16, 0.17, `${family}.base`, { at: [0, 0.11, 0] }],
  ['box', 0.36, 0.05, 0.175, 'sky.light', { at: [-0.02, 0.15, 0], g: 1 }],
  ['box', 0.01, 0.06, 0.13, 'space.600', { at: [0.211, 0.14, 0] }],
  ['box', 0.43, 0.012, 0.172, 'ink.high', { at: [0, 0.1, 0] }],
  ...[-0.13, 0.13].flatMap((x): Item[] =>
    [-1, 1].map((sz): Item => [
      'cyl',
      0.04,
      -0.015,
      0.015,
      8,
      'space.600',
      { at: [x, 0.035, sz * 0.085], rot: [Math.PI / 2, 0, 0] },
    ]),
  ),
  ['box', 0.01, 0.03, 0.02, 'butter.light', { at: [0.212, 0.06, 0.06], g: 1 }],
  ['box', 0.01, 0.03, 0.02, 'butter.light', { at: [0.212, 0.06, -0.06], g: 1 }],
];

/** Hackathons at Berkeley: logistics. A road round the island, the hacker bus on it, the food. */
const berkeley: Rows = [
  isle({ seed: 29 }),
  ['road', 0, ['ring', [0.5, 0.64], 0, TAU, 16, TOP, TOP + 0.015, 'ink.low', 'ink.low', 1]],
  [
    'bus',
    0,
    ['g', bus('butter'), { at: onBrg(0, 0.57, 0.015), rot: [0, Math.PI, 0] }],
    ['g', bus('sky'), { at: onBrg(180, 0.57, 0.015) }],
  ],
  // The catering: a food truck and a row of crates of merchandise.
  [
    'catering',
    0,
    [
      'g',
      ['box', 0.26, 0.15, 0.14, 'ink.high', { at: [0, 0.1, 0] }],
      ['box', 0.16, 0.06, 0.145, 'coral.base', { at: [0.02, 0.13, 0] }],
      ['box', 0.08, 0.08, 0.14, 'sky.light', { at: [0.1, 0.07, 0] }],
      { at: on(-0.12, 0.1), rot: [0, 0.4, 0] },
    ],
    ...[0, 1, 2].map((i): Item => [
      'box',
      0.08,
      0.08,
      0.08,
      i === 1 ? 'butter.base' : 'biome.dune.shore',
      { at: on(0.14 + i * 0.09, -0.12, 0.04) },
    ]),
    ['box', 0.08, 0.08, 0.08, 'biome.dune.shore', { at: on(0.18, -0.12, 0.12) }],
  ],
  [
    'grove',
    0,
    tree(onBrg(200, 0.84), 0.9),
    tree(onBrg(150, 0.86), 0.8),
    pine(onBrg(260, 0.85), 0.8),
  ],
  ['clouds', 0, cloud([-1.0, 0.55, 0.2], 0.8)],
];

/** Cal Hacks 13: the Campanile, a scoreboard, and the hackers' tents on the glade. */
const calHacks: Rows = [
  isle({ seed: 31 }),
  [
    'campanile',
    0,
    ['box', 0.14, 0.62, 0.14, 'ink.high', { at: on(-0.3, -0.2, 0.31) }],
    ['box', 0.16, 0.12, 0.16, 'ink.mid', { at: on(-0.3, -0.2, 0.66) }],
    [
      'cone',
      0.11,
      0,
      0.72,
      0.88,
      4,
      'mint.shade',
      { at: on(-0.3, -0.2), rot: [0, Math.PI / 4, 0] },
    ],
    [
      'cyl',
      0.04,
      -0.005,
      0.0,
      10,
      'butter.light',
      { at: on(-0.3, -0.12, 0.5), rot: [Math.PI / 2, 0, 0], g: 1 },
    ],
  ],
  [
    'scoreboard',
    0,
    ['box', 0.34, 0.18, 0.03, 'space.600', { at: on(0.25, 0.1, 0.3), rot: [0, -0.5, 0] }],
    ['box', 0.03, 0.22, 0.03, 'ink.mid', { at: on(0.25, 0.1, 0.11) }],
  ],
  [
    'score-digits',
    FLAG.decal,
    ['pix', '3000', 0.02, 'butter.light', { at: on(0.258, 0.115, 0.3), rot: [0, -0.5, 0], g: 1 }],
  ],
  [
    'tents',
    0,
    ...[0, 1, 2, 3].map((i): Item => [
      'cone',
      0.1,
      0,
      0,
      0.14,
      4,
      i % 2 ? 'lilac.base' : 'butter.base',
      { at: on(-0.05 + i * 0.13, 0.5 - (i % 2) * 0.08), rot: [0, Math.PI / 4, 0] },
    ]),
  ],
  ['grove', 0, tree(onBrg(70, 0.82), 1), tree(onBrg(90, 0.7), 0.8), pine(onBrg(300, 0.82), 0.9)],
  ['falls', 0, ...falls(200, { x: -0.48, z: 0.55, r: 0.09 })],
  ['clouds', 0, cloud([1.0, 0.55, 0.3], 0.8)],
];

// --- Planned work: islands of primer clay, a crane and a paint chip, the parts to come in clay ----

/** A planned island: primer clay, a crane at bearing `deg`, a paint chip of its family. */
const plannedIsle = (seed: number, family: ThemeKey, deg: number, r = 1): PartRow[] => [
  ['crane', 0, ['g', crane(family), { at: onBrg(deg, r * 0.7), s: 0.8 }]],
  [
    'paint-chip',
    0,
    [
      'g',
      chip(family),
      { at: onBrg(deg + 70, r * 0.75), s: 0.7, rot: [0, -((deg + 70) * Math.PI) / 180, 0] },
    ],
  ],
  [
    'debris',
    0,
    ...[0, 1, 2, 3].map((i): Item => [
      'box',
      0.06,
      0.05,
      0.06,
      'biome.primer.high',
      { at: onBrg(deg - 40 - i * 23, r * (0.6 + jitter(seed, i) * 0.1), 0.025), rot: [0, i, 0] },
    ]),
  ],
];
const PRIMER = {
  grass: 'biome.primer.high',
  turf: 'biome.primer.peak',
  soil: 'biome.primer.low',
  rock: 'biome.primer.sea',
} as const;

/** Fish Online: the six-seat table, as plan. */
const fishOnline: Rows = [
  isle({ seed: 37, r: 0.95, ...PRIMER }),
  [
    'table',
    0,
    ['cyl', 0.26, TOP + 0.08, TOP + 0.12, 10, 'ink.high', 'ink.mid', 'ink.high'],
    ['cyl', 0.04, TOP, TOP + 0.08, 6, 'ink.mid'],
    [
      'around',
      6,
      0,
      0.4,
      TOP,
      0,
      (i: number): Item => [
        'box',
        0.08,
        0.1,
        0.08,
        i % 2 ? 'sky.shade' : 'sky.light',
        { at: [0, 0.05, 0] },
      ],
    ],
  ],
  ...plannedIsle(37, 'sky', 220, 0.95),
];

/** Sports Analysis: a court, as plan, and the ball. */
const sportsAnalysis: Rows = [
  isle({ seed: 41, ...PRIMER }),
  [
    'court',
    0,
    ['box', 0.9, 0.02, 0.5, 'mint.base', { at: on(0, 0.05, 0.01) }],
    ['box', 0.012, 0.024, 0.5, 'ink.high', { at: on(0, 0.05, 0.012) }],
    ['box', 0.012, 0.18, 0.012, 'ink.mid', { at: on(-0.42, 0.05, 0.09) }],
    ['box', 0.012, 0.18, 0.012, 'ink.mid', { at: on(0.42, 0.05, 0.09) }],
  ],
  ['ball', 0, ['g', ['bead', 0.07, 'butter.base'], { at: on(0.2, 0.15, 0.25) }]],
  ...plannedIsle(41, 'mint', 300),
];

/** Kalshi: a coin of yes and no, standing on its edge, as plan. */
const kalshi: Rows = [
  isle({ seed: 43, r: 0.9, ...PRIMER }),
  [
    'yes-face',
    0,
    [
      'cyl',
      0.3,
      -0.02,
      0.0,
      14,
      'mint.base',
      'mint.shade',
      'mint.base',
      { at: on(0, 0, 0.34), rot: [Math.PI / 2, 0, 0] },
    ],
  ],
  [
    'no-face',
    0,
    [
      'cyl',
      0.3,
      0.0,
      0.02,
      14,
      'coral.base',
      'coral.shade',
      'coral.base',
      { at: on(0, 0, 0.34), rot: [Math.PI / 2, 0, 0] },
    ],
  ],
  ...plannedIsle(43, 'mint', 120, 0.9),
];

/** Corgi (RunItBack, 5th of 1,000+): a corgi of clay sitting on the island, as plan. */
const corgi: Rows = [
  isle({ seed: 47, ...PRIMER }),
  [
    'head',
    0,
    ['box', 0.42, 0.24, 0.26, 'butter.base', { at: on(0, 0, 0.16) }],
    ['box', 0.2, 0.2, 0.22, 'butter.base', { at: on(0.26, 0, 0.3) }],
    ['box', 0.1, 0.08, 0.14, 'ink.high', { at: on(0.38, 0, 0.26) }],
    ...[-1, 1].flatMap((sx): Item[] =>
      [-1, 1].map((sz): Item => [
        'box',
        0.06,
        0.08,
        0.06,
        'ink.high',
        { at: on(sx * 0.14, sz * 0.08, 0.02) },
      ]),
    ),
  ],
  [
    'ears',
    0,
    ['cone', 0.05, 0, 0.0, 0.1, 4, 'butter.shade', { at: on(0.24, -0.06, 0.4) }],
    ['cone', 0.05, 0, 0.0, 0.1, 4, 'butter.shade', { at: on(0.24, 0.06, 0.4) }],
  ],
  ['stub-tail', 0, ['box', 0.06, 0.06, 0.06, 'butter.base', { at: on(-0.24, 0, 0.26) }]],
  ...plannedIsle(47, 'lilac', 230),
];

/** Every project world that is an island, by manifest id. */
export const ISLANDS: Readonly<Record<string, BodyRecipe>> = {
  'project/robotics': { rows: robotics },
  'project/cyberpatriot': { rows: cyberpatriot },
  'project/canadian-fish-demo': { rows: canadianFish },
  'project/fishai': { rows: fishai },
  'project/fish-onboarding': { rows: fishOnboarding },
  'project/fish-online': { rows: fishOnline },
  'project/days2meet': { rows: days2meet },
  'project/hackgt-13': { rows: hackgt },
  'project/hackathons-at-berkeley': { rows: berkeley },
  'project/cal-hacks-13': { rows: calHacks },
  'project/sports-analysis': { rows: sportsAnalysis },
  'project/kalshi': { rows: kalshi },
  'project/corgi': { rows: corgi },
};
