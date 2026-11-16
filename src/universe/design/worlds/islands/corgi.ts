import type { Vec3 } from '../../../sim/world/kit';
import type { ColorPath } from '../../../sim/world/palette';
import { chip, crane } from '../../../sim/world/planned';
import { FLAG, type Item, type PartRow, type Rows } from '../../../sim/world/rows';
import {
  AUTUMN,
  chimneyOf,
  cloud,
  cottage,
  falls,
  flow,
  flowers,
  forest,
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
  blocks,
  CLAY,
  CLAY_HI,
  CLAY_LO,
  face,
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
 * CORGI (planned: RunItBack, built in twelve hours at the Corgi Hackathon, 5th of more than
 * 1,000; the write-up is coming). RunItBack turns one photo into a 3D world, so on an autumn
 * island a giant corgi is being carved from one: the photo stands on its easel, and the dog
 * comes out of the clay head first (ears up, chest, front paws) while its back half is still a
 * rough block in its scaffold, chips of clay round its foot. A stream pours off the rim, the
 * site cottage smokes, the crane, the paint chip and the work lamp say it is not finished.
 */

const G = isle({
  seed: 47,
  hills: 0.12,
  bumps: 0.035,
  pads: [{ x: 0, z: 0, r: 0.46, dy: 0.08 }],
});

// --- The building site's kit (site.ts has what the planned islands share) ----------------------

/** A ladder leant on something, `h` long. */
const ladder = (at: Vec3, yaw: number, h: number): Item => [
  'g',
  ['box', 0.01, h, 0.01, WOOD, { at: [-0.025, h / 2, 0] }],
  ['box', 0.01, h, 0.01, WOOD, { at: [0.025, h / 2, 0] }],
  ...Array.from({ length: Math.floor(h / 0.05) }, (_, i): Item => [
    'box',
    0.05,
    0.008,
    0.008,
    WOOD,
    { at: [0, 0.04 + i * 0.05, 0] },
  ]),
  { at, rot: [-0.25, yaw, 0] },
];

/** A wheelbarrow full of chips of clay. */
const barrow = (at: Vec3, yaw: number): Item => [
  'g',
  ['cone', 0.055, 0.04, 0.035, 0.075, 4, 'nature.rust', { rot: [0, Math.PI / 4, 0] }],
  ['bead', 0.035, CLAY, { at: [0, 0.07, 0] }],
  ['box', 0.02, 0.02, 0.02, CLAY_HI, { at: [0.02, 0.09, 0.01] }],
  ['cyl', 0.025, -0.008, 0.008, 8, 'space.600', { at: [0, 0.025, 0.07], rot: [0, 0, Math.PI / 2] }],
  ['box', 0.008, 0.008, 0.12, WOOD, { at: [-0.03, 0.05, -0.06], rot: [-0.3, 0, 0] }],
  ['box', 0.008, 0.008, 0.12, WOOD, { at: [0.03, 0.05, -0.06], rot: [-0.3, 0, 0] }],
  { at, rot: [0, yaw, 0] },
];

/** The flowers' colours. */
const BLOOMS: readonly ColorPath[] = [
  'nature.rose',
  'ink.high',
  'nature.gold',
  'nature.plum',
  'lilac.light',
];

// --- The statue ------------------------------------------------------------------------------------

/** Where it stands, the bearing it looks out at, its size. */
const BASE: Vec3 = G.at(0, 0);
const LOOKS = 122;
const YAW = face(LOOKS);
const SIZE = 1.3;
/** Its plinth's top. */
const P = 0.06;

/**
 * The dog, standing, in its own frame (+Z its nose, +Y up): a corgi's own outline, a long body
 * on short legs under a head of great ears. What is carved already is its front half: chest
 * and bib a shade lighter, as a corgi's white is, the nose and eyes a shade darker.
 */
const carved: Item[] = [
  // The front of the body, and the white bib under it.
  ['box', 0.16, 0.14, 0.2, CLAY, { at: [0, P + 0.15, 0.05] }],
  ['box', 0.12, 0.05, 0.16, CLAY_HI, { at: [0, P + 0.085, 0.06] }],
  ['box', 0.11, 0.1, 0.04, CLAY_HI, { at: [0, P + 0.16, 0.16] }],
  // Front legs and paws, short.
  ...[-1, 1].flatMap((side): Item[] => [
    ['box', 0.045, 0.08, 0.045, CLAY, { at: [side * 0.048, P + 0.045, 0.11] }],
    ['box', 0.05, 0.022, 0.06, CLAY_HI, { at: [side * 0.048, P + 0.011, 0.122] }],
  ]),
  // The neck, raised, and the head: skull, cheeks, the snout and its nose, the eyes.
  ['box', 0.1, 0.1, 0.09, CLAY, { at: [0, P + 0.23, 0.15], rot: [-0.45, 0, 0] }],
  ['box', 0.13, 0.1, 0.11, CLAY, { at: [0, P + 0.3, 0.19] }],
  ['box', 0.15, 0.05, 0.08, CLAY, { at: [0, P + 0.27, 0.2] }],
  ['box', 0.065, 0.05, 0.08, CLAY_HI, { at: [0, P + 0.27, 0.27] }],
  ['box', 0.03, 0.022, 0.02, CLAY_LO, { at: [0, P + 0.29, 0.31] }],
  ...[-1, 1].flatMap((side): Item[] => [
    ['box', 0.018, 0.018, 0.012, CLAY_LO, { at: [side * 0.035, P + 0.315, 0.246] }],
    [
      'cone',
      0.045,
      0.004,
      0,
      0.1,
      4,
      CLAY,
      { at: [side * 0.05, P + 0.34, 0.17], rot: [0, Math.PI / 4, side * -0.32] },
    ],
    [
      'cone',
      0.026,
      0.002,
      0.012,
      0.08,
      4,
      CLAY_HI,
      { at: [side * 0.054, P + 0.34, 0.186], rot: [0, Math.PI / 4, side * -0.32] },
    ],
  ]),
];

/** What is not: the back half still a block, stepped where the chisel has started on it. */
const rough: Item[] = [
  ['box', 0.22, 0.22, 0.22, CLAY_LO, { at: [0, P + 0.11, -0.16] }],
  ['box', 0.18, 0.04, 0.18, CLAY, { at: [0, P + 0.24, -0.17] }],
  ['box', 0.19, 0.17, 0.06, CLAY, { at: [0, P + 0.12, -0.03] }],
  ['box', 0.05, 0.05, 0.05, CLAY_HI, { at: [-0.1, P + 0.2, -0.05], rot: [0, 0.4, 0] }],
  ['box', 0.06, 0.04, 0.05, CLAY_LO, { at: [0.09, P + 0.02, 0.0] }],
];

/** The plinth, and chips of clay fallen round the back. */
const plinth: Item[] = [
  ['box', 0.32, P, 0.56, CLAY_LO, { at: [0, P / 2, 0] }],
  ['box', 0.34, 0.012, 0.58, CLAY, { at: [0, P - 0.004, 0] }],
  ...Array.from({ length: 9 }, (_, i): Item => {
    const b = Math.PI + (i - 4) * 0.3;
    const r = 0.32 + 0.05 * Math.abs(jitter(47, i));
    const s = 0.018 + 0.012 * Math.abs(jitter(47, i + 9));
    return [
      'box',
      s,
      s,
      s,
      i % 3 ? CLAY : CLAY_HI,
      { at: [r * Math.sin(b) * 0.7, s / 2, r * Math.cos(b)], rot: [0, i, 0] },
    ];
  }),
];

/** The statue's things in the island's frame, scaled. */
const statue = (items: Item[]): Item => ['g', ...items, { at: BASE, rot: [0, YAW, 0], s: SIZE }];

/** Where the carving is being done (the dust rises there), in the island's frame. */
const CHISEL: Vec3 = place(BASE, YAW, [-0.11 * SIZE, (P + 0.22) * SIZE, -0.02 * SIZE]);

/** The photo it is carved from, on an easel: the dog on grass under a sky, in its colours. */
const easel = (at: Vec3, yaw: number): Item => [
  'g',
  ['box', 0.012, 0.3, 0.012, WOOD, { at: [-0.06, 0.14, 0.02], rot: [0.12, 0, 0.18] }],
  ['box', 0.012, 0.3, 0.012, WOOD, { at: [0.06, 0.14, 0.02], rot: [0.12, 0, -0.18] }],
  ['box', 0.012, 0.3, 0.012, WOOD, { at: [0, 0.14, -0.06], rot: [-0.3, 0, 0] }],
  ['box', 0.22, 0.012, 0.03, WOOD, { at: [0, 0.12, 0.035] }],
  // The photo: the dog on grass under the sky, inside its white border. In that order: the
  // first to reach a cube takes it, so the dog shows on the grass and the sky on the border.
  [
    'g',
    ['box', 0.1, 0.045, 0.012, 'nature.amber', { at: [-0.012, -0.022, 0.012] }],
    ['box', 0.05, 0.045, 0.012, 'nature.amber', { at: [0.058, 0.012, 0.012] }],
    ['box', 0.016, 0.026, 0.012, 'nature.amber', { at: [0.044, 0.046, 0.012] }],
    ['box', 0.016, 0.026, 0.012, 'nature.amber', { at: [0.072, 0.046, 0.012] }],
    ['box', 0.03, 0.024, 0.014, 'ink.high', { at: [0.03, -0.028, 0.013] }],
    ['box', 0.016, 0.022, 0.012, 'nature.amber', { at: [-0.048, -0.052, 0.012] }],
    ['box', 0.016, 0.022, 0.012, 'nature.amber', { at: [0.026, -0.052, 0.012] }],
    ['box', 0.2, 0.04, 0.012, 'nature.grass', { at: [0, -0.055, 0.004] }],
    ['box', 0.2, 0.11, 0.012, 'sky.light', { at: [0, 0.02, 0.004] }],
    ['box', 0.24, 0.19, 0.012, 'ink.high'],
    { at: [0, 0.22, 0.03], rot: [-0.12, 0, 0] },
  ],
  { at, rot: [0, yaw, 0] },
];

// --- Round the site --------------------------------------------------------------------------------

const HOUSE_AT = G.brg(216, 0.72);
const HOUSE_SPIN = face(186);
const CHIMNEY = chimneyOf(HOUSE_AT, 1.05, HOUSE_SPIN);
const CRANE_AT = G.brg(292, 0.72);
const CHIP_DEG = 122;
const CHIP_AT = G.brg(CHIP_DEG, 0.82);
/** The stream's pond, on the right, and the bearing it pours over the rim at. */
const POND = { x: 0.52, z: -0.08, r: 0.09 };
const FALL = 80;

/** Places the wood leaves alone. */
const CLEAR: readonly (readonly [number, number, number])[] = [
  [0, 0, 0.52],
  spot(G.brg(160, 0.76), 0.3),
  spot(HOUSE_AT, 0.18),
  spot(CRANE_AT, 0.12),
  spot(CHIP_AT, 0.1),
  [POND.x, POND.z, POND.r + 0.1],
  spot(G.brg(FALL, 0.86), 0.14),
];

/**
 * A puff of dust off the chisel, now and then (motion.ts): absent at rest, so it is a close-up
 * part (near.ts) and the everyday mesh never has a hole where it was.
 */
export const CORGI_DUST: PartRow = [
  'dust',
  0,
  [
    'g',
    ['bead', 0.03, CLAY_HI],
    ['bead', 0.022, 'ink.high', { at: [0.03, 0.02, 0.01] }],
    ['bead', 0.018, CLAY_HI, { at: [-0.025, 0.03, -0.01] }],
    { at: CHISEL },
  ],
];

export const corgi: Rows = [
  G.hull,
  [
    'earth',
    FLAG.decal,
    ['cyl', 0.42, -0.03, 0.026, 12, 'nature.loam', { at: BASE }],
    ['cyl', 0.12, -0.03, 0.028, 8, 'nature.sand', { at: G.at(0.12, 0.26) }],
    ['cyl', 0.1, -0.03, 0.028, 8, CLAY_LO, { at: G.at(-0.24, -0.2) }],
  ],
  ['plinth', 0, statue(plinth)],
  ['statue', 0, statue(carved)],
  ['block', 0, statue(rough)],
  [
    'scaffold',
    0,
    statue([
      ['g', scaffold(0.3, 0.28, 0.36, 3, { walk: 'corner', brace: 'back' }), { at: [0, P, -0.16] }],
      ladder([-0.2, P, -0.24], -Math.PI / 2, 0.32),
      ['box', 0.07, 0.012, 0.012, WOOD, { at: [-0.12, P + 0.255, -0.3], rot: [0, 0.5, 0] }],
      ['box', 0.03, 0.025, 0.03, 'space.600', { at: [-0.09, P + 0.265, -0.3] }],
    ]),
  ],
  ['crane', 0, ['g', crane('lilac'), { at: CRANE_AT, s: 0.8, rot: [0, aim(22), 0] }]],
  [
    'paint-chip',
    0,
    [
      'g',
      chip('lilac'),
      ...swatch('lilac'),
      { at: CHIP_AT, s: 0.7, rot: [0, face(CHIP_DEG + 25), 0] },
    ],
  ],
  [
    'yard',
    0,
    easel(G.brg(156, 0.5), face(150)),
    cottage(HOUSE_AT, 1.05, 'ink.high', 'nature.brick', HOUSE_SPIN),
    worklamp(G.brg(190, 0.5), face(190) + Math.PI, 0.3),
    blocks(G.brg(176, 0.64), 0.6),
    blocks(G.brg(236, 0.5), 2.0),
    planks(G.brg(136, 0.66), 1.3),
    barrow(G.brg(262, 0.52), 1.4),
    ...[0, 1, 2].map((i): Item =>
      stake(G.brg(96 + i * 14, 0.5), i % 2 ? 'nature.rust' : 'nature.rose', 0.4 * i),
    ),
    ...stones(G, [HOUSE_AT[0] * 0.8, HOUSE_AT[2] * 0.8], [-0.12, 0.34], 4),
    lamppost(G.brg(196, 0.8)),
    lamppost(G.brg(150, 0.84)),
    rock(G.brg(176, 0.9), 1, 2),
    rock(G.brg(110, 0.9), 0.8, 3),
  ],
  [
    'wood',
    0,
    ...forest(G, 28, 47, CLEAR, AUTUMN, [0.62, 0.93]),
    tree(G.brg(30, 0.7), 1.3, 'nature.rust', 'nature.amber'),
    tree(G.brg(285, 0.72), 1.2, 'nature.amber', 'nature.gold'),
    pine(G.brg(350, 0.82), 1.3),
    pine(G.brg(250, 0.86), 1.1),
  ],
  [
    'meadow',
    0,
    ...flowers(G, 22, 47, [[0, 0, 0.48], spot(HOUSE_AT, 0.15)]),
    ...rimBlooms(G, BLOOMS, 14, 115, 225, 47),
  ],
  ['falls', 0, ...falls(G, FALL, POND)],
  ['flow', 0, flow(G, FALL)],
  ['smoke-1', 0, puff([CHIMNEY[0], CHIMNEY[1] + 0.02, CHIMNEY[2]], 0.9)],
  ['smoke-2', 0, puff([CHIMNEY[0], CHIMNEY[1] + 0.02, CHIMNEY[2]], 1.1)],
  ['leaves', 0, leaves(G.brg(30, 0.7, 0.14))],
  ['crystals', 0, ...G.crystals],
  ['gulls', 0, ...gulls(3, 0.82, 0.74, 47)],
  ['islets', 0, islet([-1.1, -0.52, 0.42], 0.9, 10), islet([1.08, -0.6, -0.5], 0.75, 11)],
  ['clouds', 0, cloud([-1.22, 0.6, -0.3], 0.85), cloud([1.2, 0.66, 0.4], 0.75)],
];
