import { TAU } from '../../../sim/math';
import type { Vec3 } from '../../../sim/world/kit';
import type { ColorPath } from '../../../sim/world/palette';
import { chip, crane } from '../../../sim/world/planned';
import { FLAG, type Item, type Rows } from '../../../sim/world/rows';
import {
  bush,
  cloud,
  flowers,
  forest,
  gulls,
  isle,
  islet,
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
  type ScaffoldStyle,
  spot,
  stake,
  swatch,
  worklamp,
  WOOD,
} from './site';

/**
 * SPORTS ANALYSIS (planned): a stadium going up in a late-summer park. The pitch is half laid:
 * mown turf in stripes with its chalk lines at one end, bare clay at the other where the next
 * roll of turf waits. Floodlight masts rise at the corners (two lit, one in its scaffold, one a
 * stump), a stand of clay climbs the far side behind its scaffold, and the big screen that will
 * show the numbers is a clay frame with a chart roughed in. A ball floats over the turf. The
 * crane, the paint chip, the site office with its stovepipe and the work lamp say that none of
 * it is finished.
 */

/** The yard in front of the pitch: a flat patch of bare earth for the stacks of materials. */
const YARD_DEG = (165 * Math.PI) / 180;
const YARD = { x: 0.72 * Math.sin(YARD_DEG), z: -0.72 * Math.cos(YARD_DEG), r: 0.14 };
const G = isle({
  seed: 41,
  hills: 0.11,
  bumps: 0.03,
  pads: [{ x: 0, z: 0, r: 0.6, dy: 0.08 }, YARD],
});

// --- The building site's kit (site.ts has what the planned islands share) ----------------------

/** Its scaffolds: the transoms flush with the poles, one brace up the whole front. */
const SCAFFOLD: ScaffoldStyle = { overhang: 0, brace: 'one' };

/** A pallet of bricks. */
const bricks = (at: Vec3, yaw: number): Item => [
  'g',
  ['box', 0.11, 0.014, 0.09, WOOD, { at: [0, 0.007, 0] }],
  ['box', 0.1, 0.05, 0.08, 'nature.brick', { at: [0, 0.039, 0] }],
  ['box', 0.06, 0.026, 0.08, 'nature.brick', { at: [-0.02, 0.077, 0] }],
  { at, rot: [0, yaw, 0] },
];

/** A traffic cone. */
const tcone = (at: Vec3): Item => [
  'g',
  ['box', 0.042, 0.008, 0.042, 'nature.rust', { at: [0, 0.004, 0] }],
  ['cone', 0.018, 0.004, 0.008, 0.066, 6, 'nature.amber'],
  ['cyl', 0.013, 0.03, 0.04, 6, 'ink.high'],
  { at },
];

/** A heap of sand or gravel. */
const heap = (at: Vec3, r: number, color: ColorPath): Item => [
  'cone',
  r,
  r * 0.15,
  0,
  r * 0.75,
  7,
  color,
  { at },
];

/** The flowers' colours. */
const BLOOMS: readonly ColorPath[] = [
  'nature.rose',
  'ink.high',
  'nature.gold',
  'nature.plum',
  'sky.light',
];

// --- The stadium, in its own frame: the pitch long along x, its open side (+z) at bearing 160 ------

const YAW = aim(70);
const FLOOR = G.h(0, 0);
/** A place of the stadium's frame on the island, `dy` over the floor. */
const S = (x: number, z: number, dy = 0): Vec3 => place([0, FLOOR + dy, 0], YAW, [x, 0, z]);
/** The pitch's half-sizes, and where the turf stops and the clay starts (along x). */
const PX = 0.36;
const PZ = 0.2;
const SEAM = 0.04;

/**
 * Chalk on the turf half: the touchlines, the goal line, the halfway line and its circle, the
 * box. A decal, as the turf and the clay are (the first to reach a cube takes it, and the ground
 * comes first): the chalk before the turf, so that it shows on it.
 */
const chalk: Item[] = [
  ['box', PX + SEAM, 0.03, 0.014, 'ink.high', { at: [(SEAM - PX) / 2, 0.015, -PZ + 0.012] }],
  ['box', PX + SEAM, 0.03, 0.014, 'ink.high', { at: [(SEAM - PX) / 2, 0.015, PZ - 0.012] }],
  ['box', 0.014, 0.03, PZ * 2, 'ink.high', { at: [-PX + 0.012, 0.015, 0] }],
  ['box', 0.014, 0.03, PZ * 2, 'ink.high', { at: [0, 0.015, 0] }],
  ['ring', [0.072, 0.086], Math.PI, TAU, 8, 0, 0.03, 'ink.high', 'ink.high'],
  ['box', 0.09, 0.03, 0.014, 'ink.high', { at: [-PX + 0.055, 0.015, -0.11] }],
  ['box', 0.09, 0.03, 0.014, 'ink.high', { at: [-PX + 0.055, 0.015, 0.11] }],
  ['box', 0.014, 0.03, 0.234, 'ink.high', { at: [-PX + 0.1, 0.015, 0] }],
];

/** Mown turf in stripes from the west end to the seam. */
const turf: Item[] = Array.from({ length: 6 }, (_, i): Item => {
  const w = (PX + SEAM) / 6;
  return [
    'box',
    w,
    0.024,
    PZ * 2,
    i % 2 ? 'nature.meadow' : 'nature.grass',
    { at: [-PX + w * (i + 0.5), 0.012, 0] },
  ];
});

/** The other half: a bed of bare clay with patches of loam where the turf will go. */
const clayBed: Item[] = [
  ['box', 0.12, 0.05, 0.16, 'nature.loam', { at: [0.25, 0.022, 0.05] }],
  ['box', 0.08, 0.05, 0.08, 'nature.loam', { at: [0.14, 0.022, -0.11] }],
  ['box', PX - SEAM, 0.04, PZ * 2, CLAY, { at: [(PX + SEAM) / 2, 0.02, 0] }],
  ['box', 0.016, 0.044, PZ * 2 + 0.016, CLAY_HI, { at: [PX + 0.008, 0.022, 0] }],
  ['box', PX - SEAM, 0.044, 0.016, CLAY_HI, { at: [(PX + SEAM) / 2, 0.022, PZ + 0.008] }],
];

/** The goals, the string where the chalk will go, and the rolls of turf waiting at the seam. */
const pitchKit: Item[] = [
  // The goal at the turf's end: posts, bar and its net.
  ['box', 0.016, 0.1, 0.016, 'ink.high', { at: [-PX - 0.005, 0.05, -0.07] }],
  ['box', 0.016, 0.1, 0.016, 'ink.high', { at: [-PX - 0.005, 0.05, 0.07] }],
  ['box', 0.016, 0.016, 0.156, 'ink.high', { at: [-PX - 0.005, 0.1, 0] }],
  ['box', 0.06, 0.008, 0.14, 'ink.mid', { at: [-PX - 0.03, 0.07, 0], rot: [0, 0, -0.9] }],
  // The goal at the clay end is clay too, its frame roughed in.
  ['box', 0.02, 0.1, 0.02, CLAY_HI, { at: [PX + 0.005, 0.05, -0.07] }],
  ['box', 0.02, 0.1, 0.02, CLAY_HI, { at: [PX + 0.005, 0.05, 0.07] }],
  ['box', 0.02, 0.02, 0.16, CLAY_HI, { at: [PX + 0.005, 0.1, 0] }],
  ['box', PX - SEAM, 0.006, 0.006, 'ink.high', { at: [(PX + SEAM) / 2, 0.065, -PZ + 0.03] }],
  ['box', PX - SEAM, 0.006, 0.006, 'ink.high', { at: [(PX + SEAM) / 2, 0.065, PZ - 0.03] }],
  [
    'cyl',
    0.032,
    -0.18,
    0.18,
    8,
    'nature.grass',
    'nature.grass',
    'nature.loam',
    { at: [SEAM + 0.035, 0.06, 0], rot: [Math.PI / 2, 0, 0] },
  ],
  ...[0, 1, 2].map((i): Item => [
    'cyl',
    0.03,
    -0.06,
    0.06,
    8,
    'nature.moss',
    'nature.moss',
    'nature.loam',
    {
      at: [
        PX + 0.08 + (i === 2 ? 0.03 : (i % 2) * 0.06),
        0.03 + (i === 2 ? 0.055 : 0),
        PZ - 0.04 - (i === 2 ? 0 : 0.03),
      ],
      rot: [0, Math.PI / 2, Math.PI / 2],
    },
  ]),
];

/** The stand along the far side: four steps of clay, a roof over half, the rest in its scaffold. */
const SZ = -PZ - 0.09;
const stand: Item[] = [
  ...[0, 1, 2, 3].map((i): Item => [
    'box',
    0.5 - i * 0.03,
    0.05 + i * 0.05,
    0.06,
    i % 2 ? CLAY_HI : CLAY,
    { at: [-0.1, 0.025 + i * 0.025, SZ - i * 0.05] },
  ]),
  ['box', 0.02, 0.27, 0.02, CLAY, { at: [-0.32, 0.135, SZ - 0.18] }],
  ['box', 0.02, 0.27, 0.02, CLAY, { at: [-0.08, 0.135, SZ - 0.18] }],
  ['box', 0.28, 0.02, 0.24, CLAY_HI, { at: [-0.2, 0.275, SZ - 0.08], rot: [-0.2, 0, 0] }],
  ['g', scaffold(0.22, 0.22, 0.3, 3, SCAFFOLD), { at: [0.03, 0, SZ - 0.08] }],
];

/** A floodlight mast: its pole and, once it is lit, a head of six lamps tilted at the pitch. */
const mast = (x: number, z: number, h: number, lit: boolean): Item => [
  'g',
  ['box', 0.05, 0.03, 0.05, 'ink.low', { at: [0, 0.015, 0] }],
  ['box', 0.022, h, 0.022, lit ? 'ink.mid' : CLAY, { at: [0, h / 2, 0] }],
  ...(lit
    ? [
        [
          'box',
          0.13,
          0.085,
          0.016,
          'ink.low',
          { at: [0, h + 0.03, -0.006], rot: [0.35, 0, 0] },
        ] as Item,
        ...[-1, 0, 1].flatMap((i): Item[] =>
          [0, 1].map((j): Item => [
            'box',
            0.036,
            0.032,
            0.012,
            'nature.lamp',
            { at: [i * 0.038, h + 0.014 + j * 0.034, 0.008 + j * 0.012], rot: [0.35, 0, 0], g: 2 },
          ]),
        ),
      ]
    : []),
  { at: [x, 0, z], rot: [0, Math.atan2(-x, -z), 0] },
];

/** The big screen that will show the numbers: a clay frame with a bar chart and a trend roughed in. */
const screen: Item = [
  'g',
  ['box', 0.022, 0.2, 0.022, CLAY, { at: [-0.1, 0.1, 0] }],
  ['box', 0.022, 0.2, 0.022, CLAY, { at: [0.1, 0.1, 0] }],
  ['box', 0.27, 0.16, 0.026, CLAY, { at: [0, 0.27, 0] }],
  ['box', 0.24, 0.13, 0.006, CLAY_LO, { at: [0, 0.27, 0.015] }],
  ...[0.03, 0.06, 0.045, 0.085, 0.07].map((hh, i): Item => [
    'box',
    0.028,
    hh,
    0.008,
    CLAY_HI,
    { at: [-0.08 + i * 0.04, 0.215 + hh / 2, 0.019] },
  ]),
  ['box', 0.12, 0.01, 0.008, 'ink.high', { at: [0.02, 0.3, 0.023], rot: [0, 0, 0.42] }],
  { at: [0.3, 0, -0.38], rot: [0, Math.atan2(-0.3, 0.38), 0] },
];

/** The stadium's parts in the island's frame. */
const stadium = (items: Item[]): Item => ['g', ...items, { at: [0, FLOOR, 0], rot: [0, YAW, 0] }];

// --- Round the site --------------------------------------------------------------------------------

const HUT_AT = G.brg(104, 0.76);
const HUT_YAW = face(104) + 0.25;
const PIPE_AT = place(HUT_AT, HUT_YAW, PIPE);
const CRANE_AT = G.brg(285, 0.72);
const CHIP_DEG = 212;
const CHIP_AT = G.brg(CHIP_DEG, 0.84);

/** Places the park leaves alone: the stadium, the front yard, the office, the crane's foot. */
const CLEAR: readonly (readonly [number, number, number])[] = [
  [0, 0, 0.68],
  spot(G.brg(150, 0.82), 0.3),
  [YARD.x, YARD.z, YARD.r + 0.08],
  spot(G.brg(200, 0.84), 0.2),
  spot(G.brg(110, 0.84), 0.16),
  spot(HUT_AT, 0.18),
  spot(CRANE_AT, 0.12),
];
/** Late summer: gold and fresh green crowns. */
const SUMMER: readonly ColorPath[] = [
  'nature.gold',
  'nature.meadow',
  'nature.amber',
  'nature.grass',
  'nature.gold',
];

export const sportsAnalysis: Rows = [
  G.hull,
  ['chalk', FLAG.decal, stadium(chalk)],
  ['turf', FLAG.decal, stadium(turf)],
  ['clay-bed', FLAG.decal, stadium(clayBed)],
  ['pitch-kit', 0, stadium(pitchKit)],
  ['stand', 0, stadium(stand)],
  [
    'floodlights',
    0,
    stadium([
      mast(-PX - 0.05, PZ + 0.07, 0.46, true),
      mast(-PX - 0.05, -PZ - 0.07, 0.46, true),
      mast(PX + 0.05, PZ + 0.07, 0.12, false),
      mast(PX + 0.05, -PZ - 0.06, 0.24, false),
      ['g', scaffold(0.1, 0.1, 0.3, 3, SCAFFOLD), { at: [PX + 0.05, 0, -PZ - 0.06] }],
    ]),
  ],
  ['screen', 0, stadium([screen])],
  [
    'ball',
    0,
    [
      'g',
      ['bead', 0.032, 'ink.high'],
      ['box', 0.022, 0.022, 0.022, 'space.600', { at: [0.016, 0.014, 0.016] }],
      ['box', 0.018, 0.018, 0.018, 'space.600', { at: [-0.02, -0.004, -0.012] }],
      { at: S(-0.17, 0.05, 0.1) },
    ],
  ],
  ['crane', 0, ['g', crane('mint'), { at: CRANE_AT, s: 0.8, rot: [0, aim(80), 0] }]],
  [
    'paint-chip',
    0,
    [
      'g',
      chip('mint'),
      ...swatch('mint'),
      { at: CHIP_AT, s: 0.7, rot: [0, face(CHIP_DEG - 40), 0] },
    ],
  ],
  [
    'earth',
    FLAG.decal,
    ['cyl', YARD.r + 0.03, -0.02, 0.026, 10, 'nature.loam', { at: G.at(YARD.x, YARD.z) }],
    ['cyl', 0.07, -0.02, 0.028, 8, 'nature.sand', { at: G.at(YARD.x + 0.07, YARD.z + 0.05) }],
  ],
  [
    'yard',
    0,
    hut(HUT_AT, HUT_YAW, 'nature.tile', 'ink.high'),
    worklamp(G.brg(184, 0.68), face(184) + Math.PI),
    bricks(G.at(YARD.x - 0.07, YARD.z - 0.02, 0.026), 0.4),
    bricks(G.at(YARD.x - 0.03, YARD.z + 0.08, 0.026), 1.2),
    planks(G.at(YARD.x + 0.05, YARD.z - 0.06, 0.026), 1.1),
    heap(G.at(YARD.x + 0.08, YARD.z + 0.05, 0.026), 0.06, 'nature.sand'),
    heap(G.brg(190, 0.86), 0.05, 'nature.flint'),
    tcone(G.brg(128, 0.72)),
    tcone(G.brg(140, 0.66)),
    tcone(G.brg(92, 0.66)),
    ...[0, 1, 2, 3, 4].map((i): Item =>
      stake(S(PX - 0.02 - i * 0.07, PZ + 0.03), i % 2 ? 'nature.rose' : 'nature.rust', 0.3 * i),
    ),
    ...stones(G, [HUT_AT[0] * 0.8, HUT_AT[2] * 0.8], [0.32, 0.42], 3, 'nature.sand'),
    lamppost(G.brg(132, 0.9)),
    lamppost(G.brg(80, 0.86)),
    bush(G.brg(152, 0.93), 1.1),
    bush(G.brg(116, 0.93), 1),
    bush(G.brg(198, 0.93), 1.2, 'nature.grass'),
    rock(G.brg(140, 0.95), 0.8, 7),
  ],
  [
    'park',
    0,
    ...forest(G, 30, 41, CLEAR, SUMMER, [0.7, 0.94]),
    tree(G.brg(30, 0.78), 1.3, 'nature.gold', 'nature.meadow'),
    tree(G.brg(330, 0.78), 1.2, 'nature.amber', 'nature.gold'),
    pine(G.brg(250, 0.84), 1.25),
    pine(G.brg(10, 0.88), 1.15),
    rock(G.brg(60, 0.9), 1.1, 4),
    rock(G.brg(232, 0.9), 0.9, 5),
    rock(G.brg(170, 0.93), 0.8, 6),
  ],
  [
    'meadow',
    0,
    ...flowers(G, 22, 41, [[0, 0, 0.66], spot(HUT_AT, 0.16), [YARD.x, YARD.z, YARD.r + 0.05]]),
    ...rimBlooms(G, BLOOMS, 16, 95, 235, 41, { band: 0.87, first: 41 }),
  ],
  ['smoke-1', 0, puff([PIPE_AT[0], PIPE_AT[1] + 0.02, PIPE_AT[2]], 0.8)],
  ['smoke-2', 0, puff([PIPE_AT[0], PIPE_AT[1] + 0.02, PIPE_AT[2]], 1)],
  ['leaves', 0, leaves(G.brg(30, 0.78, 0.13), SUMMER)],
  ['crystals', 0, ...G.crystals],
  ['gulls', 0, ...gulls(3, 0.8, 0.7, 41)],
  ['islets', 0, islet([1.14, -0.55, 0.35], 0.9, 4), islet([-1.08, -0.5, -0.55], 0.75, 5)],
  ['clouds', 0, cloud([-1.22, 0.66, 0.35], 0.85), cloud([1.18, 0.55, -0.5], 0.7)],
];
