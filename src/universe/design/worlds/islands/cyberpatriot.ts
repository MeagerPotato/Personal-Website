import type { Vec3 } from '../../../sim/world/kit';
import type { ColorPath } from '../../../sim/world/palette';
import { FLAG, type Item, type Rows } from '../../../sim/world/rows';
import { beacon } from '../shared';
import {
  chimneyOf,
  cloud,
  cottage,
  falls,
  flow,
  gulls,
  isle,
  jitter,
  lamppost,
  leaves,
  puff,
  rock,
  stones,
  type Isle,
} from '../isles';

/**
 * CYBERPATRIOT: a fortress on a hill in the snow. Defending a computer is holding a castle: the
 * walls and towers stand round the keep, the gate is shut, and on the keep's roof the team's
 * monitor shows the checklist of the round (two holes fixed in mint, two still open in coral).
 * The banner waves, the radar on the back tower turns, the guard's lodge smokes in the snowy
 * pines, a spring runs off the rim between icicles, and snow drifts down.
 */

/** The castle's middle (it stands on the hilltop, a little back from the path). */
const CX = 0;
const CZ = -0.1;

const G = isle({
  seed: 7,
  hills: 0.16,
  bumps: 0.03,
  pads: [{ x: CX, z: CZ, r: 0.42, dy: 0.2 }],
  grass: ['biome.frost.shore', 'biome.frost.high', 'nature.snow'],
  soil: ['nature.loam', 'nature.clay'],
  rock: ['nature.rock', 'nature.slate'],
  roots: false,
  crystal: 'sky.light',
});

// --- The fortress ---------------------------------------------------------------------------------

/** The castle's half-side, and the height of the hilltop it stands on. */
const W = 0.26;
const H0 = G.h(CX, CZ);
const WALL_H = 0.13;
const STONE: ColorPath = 'nature.flint';
const DARK: ColorPath = 'nature.rock';

/** A crenellated stretch of wall from (x0, z0) to (x1, z1), snow along its walk. */
const wall = (x0: number, z0: number, x1: number, z1: number): Item => {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const yaw = Math.atan2(x1 - x0, z1 - z0);
  const n = Math.max(2, Math.round(len / 0.07));
  return [
    'g',
    ['box', 0.055, WALL_H, len, STONE, { at: [0, WALL_H / 2, 0] }],
    // A darker course of stones at the foot and one under the walk.
    ['box', 0.058, 0.022, len, DARK, { at: [0, 0.011, 0] }],
    ['box', 0.058, 0.012, len, DARK, { at: [0, WALL_H - 0.02, 0] }],
    ['box', 0.05, 0.012, len, 'nature.snow', { at: [0, WALL_H + 0.006, 0] }],
    ...Array.from({ length: n }, (_, i): Item => [
      'box',
      0.06,
      0.04,
      0.035,
      i % 2 ? STONE : 'biome.frost.high',
      { at: [0, WALL_H + 0.02, -len / 2 + (len * (i + 0.5)) / n] },
    ]),
    { at: [(x0 + x1) / 2, H0, (z0 + z1) / 2], rot: [0, yaw, 0] },
  ];
};

/** A round tower: crenellated, a pointed roof with snow on its tip, lit windows round it. */
const tower = (x: number, z: number, h: number, roof: ColorPath, r = 0.068): Item => [
  'g',
  ['cyl', r, 0, h, 8, STONE, STONE, 'nature.snow'],
  ['cyl', r + 0.005, 0, 0.03, 8, DARK],
  ['cyl', r + 0.008, h - 0.03, h, 8, DARK, DARK, 'nature.snow'],
  ['around', 5, 0.3, r, h + 0.02, 1, ['box', 0.03, 0.04, 0.025, STONE]],
  ['cone', r + 0.02, 0, h + 0.03, h + 0.2, 8, roof],
  ['cone', 0.036, 0, h + 0.15, h + 0.21, 8, 'nature.snow'],
  ['around', 2, 0.6, r + 0.002, h * 0.62, 1, ['box', 0.022, 0.036, 0.008, 'lamp.window', { g: 1 }]],
  { at: [x, H0, z] },
];

/** A little still pennant on a tower's tip. */
const pennant = (x: number, z: number, y: number, color: ColorPath): Item => [
  'g',
  ['box', 0.01, 0.09, 0.01, 'ink.mid', { at: [0, 0.045, 0] }],
  ['box', 0.06, 0.035, 0.008, color, { at: [0.03, 0.07, 0] }],
  { at: [x, y, z] },
];

const TOWER_H = 0.26;
/** The gate's half-width, in the front wall (+Z, the side the path comes up). */
const GATE = 0.07;
const FRONT = CZ + W;

const fortress: Item[] = [
  wall(CX - W, CZ - W, CX + W, CZ - W),
  wall(CX + W, CZ - W, CX + W, CZ + W),
  wall(CX - W, CZ + W, CX - W, CZ - W),
  wall(CX - W, FRONT, CX - GATE - 0.02, FRONT),
  wall(CX + GATE + 0.02, FRONT, CX + W, FRONT),
  tower(CX - W, CZ - W, TOWER_H + 0.05, 'sky.base'),
  tower(CX + W, CZ - W, TOWER_H, 'sky.base'),
  tower(CX - W, CZ + W, TOWER_H, 'sky.base'),
  tower(CX + W, CZ + W, TOWER_H, 'sky.base'),
  pennant(CX - W, CZ - W, H0 + TOWER_H + 0.26, 'coral.base'),
  pennant(CX - W, CZ + W, H0 + TOWER_H + 0.21, 'mint.base'),
  pennant(CX + W, CZ + W, H0 + TOWER_H + 0.21, 'coral.base'),
  // The gatehouse: two squat towers either side of the gate, an arch over it, the doors shut
  // behind a portcullis, a banner over it and a lantern each side.
  tower(CX - GATE - 0.035, FRONT + 0.015, 0.19, 'coral.base', 0.05),
  tower(CX + GATE + 0.035, FRONT + 0.015, 0.19, 'coral.base', 0.05),
  ['box', GATE * 2 + 0.04, 0.05, 0.07, STONE, { at: [CX, H0 + 0.135, FRONT + 0.01] }],
  ['box', GATE * 2 + 0.04, 0.012, 0.072, 'nature.snow', { at: [CX, H0 + 0.166, FRONT + 0.01] }],
  ['box', GATE * 2, 0.11, 0.03, 'nature.wood', { at: [CX, H0 + 0.055, FRONT - 0.01] }],
  ...[-2, -1, 0, 1, 2].map((i): Item => [
    'box',
    0.01,
    0.11,
    0.01,
    'space.600',
    { at: [CX + i * 0.026, H0 + 0.055, FRONT + 0.012] },
  ]),
  ['box', GATE * 2, 0.01, 0.01, 'space.600', { at: [CX, H0 + 0.07, FRONT + 0.012] }],
  // The banner over the gate: the team's shield.
  ['box', 0.08, 0.1, 0.012, 'sky.base', { at: [CX, H0 + 0.11, FRONT + 0.05] }],
  ['box', 0.036, 0.045, 0.014, 'ink.high', { at: [CX, H0 + 0.115, FRONT + 0.05] }],
  ['box', 0.018, 0.024, 0.016, 'sky.shade', { at: [CX, H0 + 0.11, FRONT + 0.05] }],
  ['box', 0.08, 0.014, 0.014, 'butter.base', { at: [CX, H0 + 0.166, FRONT + 0.05] }],
  ...[-1, 1].map((s): Item => [
    'g',
    ['box', 0.024, 0.03, 0.024, 'space.600'],
    ['bead', 0.017, 'nature.lamp', { at: [0, 0.004, 0.008], g: 2 }],
    { at: [CX + s * (GATE + 0.035), H0 + 0.11, FRONT + 0.07] },
  ]),
];

/** The keep: a tall block in the yard with lit windows in rows, its roof a fighting top. */
const KEEP = { x: CX, z: CZ - 0.06, w: 0.24, d: 0.18, h: 0.28 };
const KEEP_TOP = H0 + KEEP.h;
const keep: Item[] = [
  ['box', KEEP.w, KEEP.h, KEEP.d, STONE, { at: [KEEP.x, H0 + KEEP.h / 2, KEEP.z] }],
  ['box', KEEP.w + 0.006, 0.02, KEEP.d + 0.006, DARK, { at: [KEEP.x, H0 + 0.1, KEEP.z] }],
  ['box', KEEP.w + 0.02, 0.025, KEEP.d + 0.02, DARK, { at: [KEEP.x, KEEP_TOP, KEEP.z] }],
  [
    'box',
    KEEP.w + 0.01,
    0.01,
    KEEP.d + 0.01,
    'nature.snow',
    { at: [KEEP.x, KEEP_TOP + 0.015, KEEP.z] },
  ],
  ...[-1, 0, 1].flatMap((i): Item[] =>
    [0.17, 0.23].map((y): Item => [
      'box',
      0.026,
      0.04,
      0.01,
      'lamp.window',
      { at: [KEEP.x + i * 0.07, H0 + y, KEEP.z + KEEP.d / 2 + 0.002], g: 1 },
    ]),
  ),
  ...[-1, 1].map((s): Item => [
    'box',
    0.01,
    0.04,
    0.026,
    'lamp.window',
    { at: [KEEP.x + s * (KEEP.w / 2 + 0.002), H0 + 0.2, KEEP.z], g: 1 },
  ]),
];

/**
 * The team's monitor on the keep's roof, facing the path: a dark frame and screen, and on it the
 * round's checklist, one row a vulnerability: a box and a line, mint where it is fixed, coral
 * where it is still open.
 */
const MON = { x: KEEP.x, y: KEEP_TOP + 0.22, z: KEEP.z + 0.02, w: 0.44, h: 0.32 };
const monitor: Item = [
  'g',
  ['box', 0.05, 0.1, 0.04, 'space.600', { at: [0, -MON.h / 2 - 0.03, -0.02] }],
  ['box', 0.18, 0.02, 0.1, 'space.600', { at: [0, -MON.h / 2 - 0.08, -0.02] }],
  ['box', MON.w + 0.035, MON.h + 0.035, 0.035, 'space.600'],
  ['box', MON.w, MON.h, 0.01, 'space.900', { at: [0, 0, 0.018], g: 1 }],
  // A title bar in sky, a shield's white on it.
  ['box', MON.w, 0.04, 0.012, 'sky.shade', { at: [0, MON.h / 2 - 0.02, 0.02], g: 1 }],
  [
    'box',
    0.024,
    0.024,
    0.014,
    'ink.high',
    { at: [-MON.w / 2 + 0.03, MON.h / 2 - 0.02, 0.022], g: 1 },
  ],
  ...(['mint', 'mint', 'coral', 'coral'] as const).flatMap((family, i): Item[] => {
    const y = MON.h / 2 - 0.085 - i * 0.062;
    return [
      ['box', 0.04, 0.04, 0.012, `${family}.base`, { at: [-MON.w / 2 + 0.05, y, 0.022], g: 1 }],
      [
        'box',
        0.24 - (i % 2) * 0.06,
        0.034,
        0.012,
        `${family}.light`,
        { at: [-0.04 - (i % 2) * 0.03, y, 0.022], g: 1 },
      ],
    ];
  }),
  // The round's score in the corner, two bars of four lit.
  ...[0, 1, 2, 3].map((i): Item => [
    'box',
    0.016,
    0.03 + i * 0.016,
    0.012,
    i < 2 ? 'butter.base' : 'ink.low',
    { at: [MON.w / 2 - 0.09 + i * 0.024, -MON.h / 2 + 0.035 + i * 0.008, 0.022], g: 1 },
  ]),
  { at: [MON.x, MON.y, MON.z], rot: [-0.12, 0, 0] },
];

/** The banner on its pole over the keep's back corner: it swings in the wind ('flags'). */
const FLAG_AT: Vec3 = [KEEP.x - KEEP.w / 2 + 0.02, KEEP_TOP + 0.02, KEEP.z - KEEP.d / 2 + 0.02];
const flag: Item = [
  'g',
  ['box', 0.014, 0.42, 0.014, 'ink.mid', { at: [0, 0.21, 0] }],
  ['bead', 0.016, 'butter.base', { at: [0, 0.425, 0] }],
  ['box', 0.17, 0.1, 0.01, 'sky.base', { at: [0.09, 0.35, 0] }],
  ['box', 0.17, 0.022, 0.012, 'ink.high', { at: [0.09, 0.35, 0] }],
  ['box', 0.036, 0.05, 0.014, 'coral.base', { at: [0.06, 0.35, 0] }],
  { at: FLAG_AT },
];

/** The radar on the back right tower: a dish on a mast, turning as it watches ('radar'). */
const RADAR_AT: Vec3 = [CX + W, H0 + TOWER_H + 0.035, CZ - W];
const radar: Item = [
  'g',
  ['cyl', 0.012, 0, 0.12, 6, 'ink.mid'],
  ['box', 0.03, 0.03, 0.03, 'space.600', { at: [0, 0.12, 0] }],
  [
    'cone',
    0.08,
    0.02,
    0.0,
    0.04,
    8,
    'ink.high',
    'ink.high',
    'ink.mid',
    { at: [0, 0.16, 0.02], rot: [1.2, 0, 0] },
  ],
  ['box', 0.008, 0.008, 0.06, 'ink.mid', { at: [0, 0.16, 0.05] }],
  beacon([0, 0.16, 0.085]),
  { at: RADAR_AT },
];

// --- The snowy wood and the life round it ----------------------------------------------------------

/** A pine dusted with snow: three tiers, white over the top two. */
const snowPine = (at: Vec3, s = 1): Item => [
  'g',
  ['box', 0.03, 0.08, 0.03, 'nature.bark', { at: [0, 0.04, 0] }],
  ['cone', 0.105, 0.035, 0.06, 0.17, 7, 'nature.fir'],
  ['cone', 0.082, 0.02, 0.15, 0.26, 7, 'nature.pine'],
  ['cone', 0.06, 0.016, 0.205, 0.265, 7, 'nature.snow'],
  ['cone', 0.056, 0, 0.24, 0.37, 7, 'nature.pine'],
  ['cone', 0.032, 0, 0.3, 0.375, 7, 'nature.snow'],
  { at, s },
];

/** A round tree under a cap of snow. */
const frostTree = (at: Vec3, s = 1, leaf: ColorPath = 'nature.moss'): Item => [
  'g',
  ['box', 0.032, 0.15, 0.032, 'nature.bark', { at: [0, 0.075, 0] }],
  ['bead', 0.09, leaf, { at: [0, 0.19, 0] }],
  ['bead', 0.062, leaf, { at: [0.055, 0.16, 0.035] }],
  ['bead', 0.07, 'nature.snow', { at: [-0.01, 0.245, -0.01] }],
  { at, s },
];

/** A holly bush: dark leaves and red berries. */
const holly = (at: Vec3, s = 1): Item => [
  'g',
  ['bead', 0.05, 'nature.fir', { at: [0, 0.03, 0] }],
  ['bead', 0.028, 'nature.snow', { at: [-0.005, 0.07, 0] }],
  ['box', 0.018, 0.018, 0.018, 'nature.rust', { at: [0.035, 0.05, 0.03] }],
  ['box', 0.018, 0.018, 0.018, 'nature.brick', { at: [-0.03, 0.04, 0.035] }],
  { at, s },
];

/** A rock with snow on its back. */
const snowRock = (at: Vec3, s = 1, seed = 0): Item => [
  'g',
  rock([0, 0, 0], 1, seed),
  ['box', 0.06, 0.014, 0.05, 'nature.snow', { at: [0, 0.04, 0], rot: [0, jitter(seed, 1), 0.2] }],
  { at, s },
];

/** A snowman with a scarf and a carrot nose. */
const snowman = (at: Vec3, spin: number): Item => [
  'g',
  ['bead', 0.055, 'nature.snow', { at: [0, 0.05, 0] }],
  ['bead', 0.042, 'nature.snow', { at: [0, 0.13, 0] }],
  ['bead', 0.032, 'ink.high', { at: [0, 0.195, 0] }],
  ['cyl', 0.04, 0.155, 0.17, 8, 'coral.base'],
  ['box', 0.02, 0.05, 0.012, 'coral.base', { at: [0.025, 0.13, 0.035] }],
  ['box', 0.012, 0.012, 0.04, 'nature.amber', { at: [0, 0.195, 0.045] }],
  ['box', 0.01, 0.01, 0.01, 'space.900', { at: [-0.014, 0.205, 0.028] }],
  ['box', 0.01, 0.01, 0.01, 'space.900', { at: [0.014, 0.205, 0.028] }],
  ['cyl', 0.03, 0.22, 0.26, 8, 'space.600'],
  ['cyl', 0.045, 0.22, 0.228, 8, 'space.600'],
  { at, rot: [0, spin, 0] },
];

type Clear = readonly (readonly [number, number, number])[];

/** A snowy wood round the castle, kept out of `avoid`: mostly pines, a few round trees, holly. */
function snowWood(isle: Isle, n: number, seed: number, avoid: Clear): Item[] {
  const out: Item[] = [];
  const taken: [number, number][] = [];
  for (let i = 0; out.length < n && i < n * 12; i += 1) {
    const b = (jitter(seed, i * 3) + 1) * Math.PI;
    const rr = isle.r * (0.5 + 0.42 * ((jitter(seed, i * 3 + 1) + 1) / 2));
    const x = rr * Math.sin(b);
    const z = -rr * Math.cos(b);
    if (avoid.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) continue;
    if (taken.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 0.12)) continue;
    taken.push([x, z]);
    const s = 0.75 + 0.4 * ((jitter(seed, i * 3 + 2) + 1) / 2);
    // The front, where the path climbs to the gate, keeps to low things: the castle shows.
    const deg = ((b * 180) / Math.PI) % 360;
    const low = (deg > 125 && deg < 215 && rr < 0.8) || (deg > 140 && deg < 200);
    const kind = low ? 5 : out.length % 6;
    const at = isle.at(x, z);
    out.push(
      kind === 2
        ? frostTree(at, s * 0.95, out.length % 4 === 2 ? 'nature.pine' : 'nature.moss')
        : kind === 5
          ? holly(at, s * 1.1)
          : snowPine(at, s * (kind === 0 ? 1.15 : 1)),
    );
  }
  return out;
}

/** The guards' campfire: crossed logs, glowing coals, stones round it and a log to sit on. */
const campfire = (at: Vec3): Item => [
  'g',
  ['around', 7, 0, 0.055, 0.008, 0, ['box', 0.022, 0.018, 0.022, 'nature.rock']],
  ['box', 0.09, 0.018, 0.018, 'nature.bark', { at: [0, 0.012, 0], rot: [0, 0.5, 0] }],
  ['box', 0.09, 0.018, 0.018, 'nature.bark', { at: [0, 0.02, 0], rot: [0, -0.6, 0] }],
  ['bead', 0.028, 'nature.amber', { at: [0, 0.035, 0], g: 2 }],
  ['bead', 0.018, 'nature.gold', { at: [0.008, 0.06, 0.004], g: 2 }],
  ['box', 0.12, 0.03, 0.035, 'nature.bark', { at: [0.02, 0.015, 0.1], rot: [0, 0.2, 0] }],
  { at },
];

/** A wooden watch post at the foot of the path: four legs, a deck, a snowy roof, a lantern. */
const watchPost = (at: Vec3, spin: number): Item => [
  'g',
  ...[-1, 1].flatMap((sx): Item[] =>
    [-1, 1].map((sz): Item => [
      'box',
      0.016,
      0.2,
      0.016,
      'nature.bark',
      { at: [sx * 0.04, 0.1, sz * 0.04] },
    ]),
  ),
  ['box', 0.11, 0.016, 0.11, 'nature.wood', { at: [0, 0.14, 0] }],
  ['box', 0.11, 0.03, 0.008, 'nature.wood', { at: [0, 0.165, 0.052] }],
  ['box', 0.008, 0.03, 0.11, 'nature.wood', { at: [0.052, 0.165, 0] }],
  ['cone', 0.09, 0, 0.2, 0.27, 4, 'nature.snow', { rot: [0, Math.PI / 4, 0] }],
  ['box', 0.02, 0.026, 0.02, 'space.600', { at: [0.03, 0.17, 0.03] }],
  ['bead', 0.014, 'nature.lamp', { at: [0.03, 0.172, 0.04], g: 2 }],
  { at, rot: [0, spin, 0] },
];

/** A stack of firewood with snow on it. */
const woodpile = (at: Vec3): Item => [
  'g',
  ...[0, 1, 2].flatMap((row): Item[] =>
    [0, 1, 2 - row]
      .slice(0, 3 - row)
      .map((i): Item => [
        'cyl',
        0.016,
        -0.05,
        0.05,
        6,
        'nature.bark',
        'nature.bark',
        'nature.wood',
        { at: [(i - (2 - row) / 2) * 0.034, 0.016 + row * 0.03, 0], rot: [Math.PI / 2, 0, 0] },
      ]),
  ),
  ['box', 0.08, 0.012, 0.09, 'nature.snow', { at: [0, 0.095, 0] }],
  { at, rot: [0, 0.8, 0] },
];

/** Winter flowers and berries scattered in the snow, kept out of `avoid`. */
const WINTER: readonly ColorPath[] = [
  'nature.rust',
  'sky.light',
  'nature.rose',
  'lilac.light',
  'nature.brick',
  'nature.plum',
];
function winterBlooms(isle: Isle, n: number, seed: number, avoid: Clear): Item[] {
  const out: Item[] = [];
  for (let i = 0; out.length < n && i < n * 8; i += 1) {
    const b = (jitter(seed, i * 2) + 1) * Math.PI;
    const rr = isle.r * 0.9 * Math.sqrt((jitter(seed, i * 2 + 1) + 1) / 2);
    const x = rr * Math.sin(b);
    const z = -rr * Math.cos(b);
    if (avoid.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) continue;
    out.push([
      'box',
      0.022,
      0.022,
      0.022,
      WINTER[out.length % WINTER.length] ?? 'ink.high',
      { at: isle.at(x, z, 0.018) },
    ]);
  }
  return out;
}

/** Icicles under the rim's lip, all the way round but where the water falls. */
const icicles = (skip: number): Item[] =>
  Array.from({ length: 20 }, (_, i): Item | null => {
    const deg = (i / 20) * 360 + 6 * jitter(9, i);
    if (Math.abs(((deg - skip + 540) % 360) - 180) < 14) return null;
    const b = (deg * Math.PI) / 180;
    const len = 0.05 + 0.06 * Math.abs(jitter(9, i + 40));
    return [
      'cone',
      0.02,
      0,
      0.0,
      -len,
      5,
      i % 3 ? 'sky.light' : 'ink.high',
      { at: [0.965 * Math.sin(b), 0.0, -0.965 * Math.cos(b)] },
    ];
  }).filter((x): x is Item => x !== null);

/** The frozen pond: ice with its cracks, a rim of drifted snow, and a hole for fishing. */
const ICE = { x: 0.3, z: 0.5, r: 0.14 };
const ICE_Y = G.h(ICE.x, ICE.z);
const ice: Item[] = [
  [
    'cyl',
    ICE.r * 1.2,
    ICE_Y - 0.04,
    ICE_Y + 0.004,
    12,
    'biome.frost.low',
    { at: [ICE.x, 0, ICE.z] },
  ],
  [
    'cyl',
    ICE.r,
    ICE_Y - 0.03,
    ICE_Y + 0.014,
    12,
    'biome.frost.sea',
    'biome.frost.sea',
    'sky.base',
    { at: [ICE.x, 0, ICE.z] },
  ],
  [
    'box',
    0.15,
    0.004,
    0.01,
    'sky.light',
    { at: [ICE.x - 0.01, ICE_Y + 0.016, ICE.z + 0.03], rot: [0, 0.5, 0] },
  ],
  [
    'box',
    0.1,
    0.004,
    0.01,
    'sky.light',
    { at: [ICE.x + 0.03, ICE_Y + 0.016, ICE.z - 0.04], rot: [0, -0.8, 0] },
  ],
  [
    'cyl',
    0.028,
    ICE_Y + 0.01,
    ICE_Y + 0.018,
    8,
    'space.600',
    { at: [ICE.x - 0.05, 0, ICE.z + 0.04] },
  ],
];

/** The guard's lodge in the pines on the right, its roof deep in snow, and where its smoke leaves. */
const LODGE = G.brg(98, 0.66);
const SPIN = -0.5;
const LODGE_S = 1.25;
const CHIMNEY = chimneyOf(LODGE, LODGE_S, SPIN);
/** A spring by the rim on the front left, and the bearing it pours over at. */
const SPRING = { x: -0.45, z: 0.5, r: 0.08 };
const FALL = 222;
/** The path from the gate down to the rim. */
const PATH_END: readonly [number, number] = [0.03, 0.92];

/** Places the wood leaves alone: the hilltop, the path, the lodge, the ponds, the snowman. */
const CLEAR: Clear = [
  [CX, CZ, 0.48],
  [0, 0.42, 0.16],
  [0.02, 0.62, 0.16],
  [0.03, 0.82, 0.14],
  [LODGE[0], LODGE[2], 0.2],
  [SPRING.x, SPRING.z, 0.15],
  [-0.6, 0.66, 0.12],
  [ICE.x, ICE.z, 0.24],
  [-0.2, 0.62, 0.08],
  [-0.3, 0.36, 0.12],
  [-0.12, 0.8, 0.1],
  [-0.4, 0.3, 0.08],
];

export const cyberpatriot: Rows = [
  G.hull,
  ['fortress', 0, ...fortress],
  ['keep', 0, ...keep],
  ['monitor', 0, monitor],
  ['flags', 0, flag],
  ['radar', 0, radar],
  [
    'wood',
    0,
    ...snowWood(G, 25, 7, CLEAR),
    snowRock(G.brg(200, 0.86), 1.2, 1),
    snowRock(G.brg(30, 0.86), 1, 2),
    snowRock(G.brg(300, 0.72), 0.9, 3),
    snowRock(G.brg(160, 0.88), 0.8, 4),
    snowman(G.at(-0.2, 0.62), -0.3),
    campfire(G.at(-0.3, 0.36)),
    watchPost(G.at(-0.12, 0.8), 0.2),
    woodpile(G.at(-0.4, 0.3)),
    holly(G.at(0.14, 0.82), 1.1),
    holly(G.at(-0.12, 0.38), 0.9),
    snowRock(G.at(0.2, 0.3), 0.8, 5),
  ],
  ['blooms', 0, ...winterBlooms(G, 26, 7, CLEAR.slice(0, 2))],
  ['pond', FLAG.decal, ...ice],
  [
    'lodge',
    0,
    cottage(LODGE, LODGE_S, 'nature.wood', 'nature.brick', SPIN),
    ...stones(G, [0.02, FRONT + 0.1], PATH_END, 7, 'ink.low'),
    lamppost(G.at(-0.08, 0.48), 1),
    lamppost(G.at(0.1, 0.74), 1),
  ],
  ['falls', FLAG.decal, ...falls(G, FALL, SPRING, 0.7)],
  ['icicles', 0, ...icicles(FALL)],
  ['flow', 0, flow(G, FALL, 0.7)],
  ['smoke-1', 0, puff([CHIMNEY[0], CHIMNEY[1] + 0.02, CHIMNEY[2]], 0.9)],
  ['smoke-2', 0, puff([CHIMNEY[0], CHIMNEY[1] + 0.02, CHIMNEY[2]], 1.1)],
  ['leaves', 0, leaves(G.brg(300, 0.6, 0.3), ['nature.snow', 'ink.high', 'biome.frost.high'])],
  ['crystals', 0, ...G.crystals],
  ['gulls', 0, ...gulls(3, 0.85, 0.7, 7)],
  ['islets', 0, snowIslet([1.1, -0.66, -0.42], 1, 1), snowIslet([-1.04, -0.7, 0.5], 0.8, 2)],
  ['clouds', 0, cloud([-1.22, 0.66, -0.4], 0.9), cloud([1.2, 0.56, 0.5], 0.75)],
];

/** A snowy islet: a lump of rock, a cap of snow and a little pine. */
function snowIslet(at: Vec3, s: number, seed: number): Item {
  return [
    'g',
    ['cone', 0.09, 0, 0, -0.14, 6, 'nature.slate'],
    ['cyl', 0.095, -0.03, 0, 6, 'nature.clay'],
    ['cyl', 0.095, 0, 0.02, 6, 'nature.snow'],
    [
      'g',
      ['cone', 0.08, 0, 0.03, 0.2, 6, 'nature.pine'],
      ['cone', 0.04, 0, 0.13, 0.21, 6, 'nature.snow'],
      { at: [0.02 * jitter(seed, 1), 0.02, 0.02 * jitter(seed, 2)] },
    ],
    { at, s },
  ];
}
