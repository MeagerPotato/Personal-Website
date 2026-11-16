import type { Vec3 } from '../../../sim/world/kit';
import type { ColorPath } from '../../../sim/world/palette';
import { text } from '../../../sim/world/atoms';
import type { Item, Rows } from '../../../sim/world/rows';
import {
  bush,
  cloud,
  falls,
  flow,
  forest,
  gulls,
  isle,
  islet,
  jitter,
  lamppost,
  leaves,
  puff,
  rock,
  stones,
  tree,
} from '../isles';

/**
 * CAL HACKS 13: Berkeley's campus as an island in October, its hills gone gold. The Campanile
 * stands on the summit, its clock lit and its bell swinging in the open belfry; the esplanade
 * runs down from it to Sather Gate. On the glade the hackers have pitched their tents round a
 * campfire, each one lit from inside by a laptop, and the scoreboard counts them: 3000. Blue and
 * gold banners along the walk, live oaks and tall redwoods, golden poppies, a stream that pours
 * off the rim.
 */

export const CALHACKS = isle({
  seed: 31,
  hills: 0.16,
  bumps: 0.035,
  grass: ['nature.moss', 'nature.grass', 'nature.gold'],
  crystal: 'butter.base',
  pads: [
    { x: -0.04, z: -0.2, r: 0.14 },
    { x: 0.4, z: 0.3, r: 0.22, dy: 0.04 },
  ],
});
const G = CALHACKS;

/** The yaw that turns a thing's +Z to face compass bearing `deg`. */
const facing = (deg: number): number => Math.PI - (deg * Math.PI) / 180;

/** The Campanile on the summit: shaft, clock, open belfry and its bell, the green spire. */
const TOWER: Vec3 = G.at(-0.04, -0.2);
const S = 0.9;
const SHAFT = 0.13;
const CLOCK_Y = 0.45;
const BELFRY_Y = 0.53;
const campanile: Item = [
  'g',
  ['box', 0.22, 0.05, 0.22, 'nature.flint', { at: [0, 0.025, 0] }],
  ['box', 0.17, 0.03, 0.17, 'nature.flint', { at: [0, 0.065, 0] }],
  ['box', SHAFT, 0.46, SHAFT, 'biome.frost.high', { at: [0, 0.3, 0] }],
  // The shaft's pilasters: two grooves down each face.
  ...[0, 1, 2, 3].flatMap((k): Item[] =>
    [-0.03, 0.03].map((u): Item => {
      const a = (k * Math.PI) / 2;
      const n = SHAFT / 2 + 0.001;
      return [
        'box',
        k % 2 ? 0.006 : 0.012,
        0.32,
        k % 2 ? 0.012 : 0.006,
        'ink.low',
        { at: [n * Math.sin(a) + u * Math.cos(a), 0.27, n * Math.cos(a) - u * Math.sin(a)] },
      ];
    }),
  ),
  // The clock on all four faces, lit.
  ...[0, 1, 2, 3].map((k): Item => {
    const a = (k * Math.PI) / 2;
    return [
      'cyl',
      0.045,
      0,
      0.01,
      12,
      'butter.light',
      {
        at: [(SHAFT / 2) * Math.sin(a), CLOCK_Y, (SHAFT / 2) * Math.cos(a)],
        rot: [Math.PI / 2, a, 0],
        g: 2,
      },
    ];
  }),
  ['box', 0.16, 0.025, 0.16, 'nature.flint', { at: [0, BELFRY_Y - 0.0125, 0] }],
  // The belfry: four pillars round the bell, open between them.
  ...[-1, 1].flatMap((sx): Item[] =>
    [-1, 1].map((sz): Item => [
      'box',
      0.035,
      0.12,
      0.035,
      'biome.frost.high',
      { at: [sx * 0.058, BELFRY_Y + 0.06, sz * 0.058] },
    ]),
  ),
  ['box', 0.17, 0.025, 0.17, 'nature.flint', { at: [0, BELFRY_Y + 0.13, 0] }],
  [
    'cone',
    0.125,
    0,
    BELFRY_Y + 0.14,
    BELFRY_Y + 0.32,
    4,
    'mint.shade',
    { rot: [0, Math.PI / 4, 0] },
  ],
  ['bead', 0.018, 'nature.lamp', { at: [0, BELFRY_Y + 0.34, 0], g: 2 }],
  ['box', 0.008, 0.06, 0.008, 'ink.mid', { at: [0, BELFRY_Y + 0.38, 0] }],
  { at: TOWER, s: S },
];
/** The bell, hung in the belfry (a part of its own: it swings about where it hangs). */
const bell: Item = [
  'g',
  ['cone', 0.042, 0.018, -0.075, -0.012, 8, 'nature.gold'],
  ['box', 0.012, 0.014, 0.012, 'nature.bark', { at: [0, -0.006, 0] }],
  ['bead', 0.012, 'nature.amber', { at: [0, -0.08, 0] }],
  { at: [TOWER[0], TOWER[1] + S * (BELFRY_Y + 0.115), TOWER[2]], s: S },
];

/** The scoreboard: Berkeley blue in a gold frame, and the count of hackers on it. */
const BOARD = G.at(-0.33, 0.48);
const BOARD_Y = 0.22;
const scoreboard: Item = [
  'g',
  ['box', 0.52, 0.22, 0.03, 'space.600', { at: [0, BOARD_Y, 0] }],
  ['box', 0.54, 0.02, 0.034, 'butter.base', { at: [0, BOARD_Y + 0.115, 0] }],
  ['box', 0.54, 0.02, 0.034, 'butter.base', { at: [0, BOARD_Y - 0.115, 0] }],
  ['box', 0.02, 0.24, 0.034, 'butter.base', { at: [-0.27, BOARD_Y, 0] }],
  ['box', 0.02, 0.24, 0.034, 'butter.base', { at: [0.27, BOARD_Y, 0] }],
  ['box', 0.03, 0.18, 0.03, 'ink.mid', { at: [-0.18, 0.07, -0.01] }],
  ['box', 0.03, 0.18, 0.03, 'ink.mid', { at: [0.18, 0.07, -0.01] }],
  ['bead', 0.022, 'butter.light', { at: [-0.27, BOARD_Y + 0.13, 0], g: 2 }],
  ['bead', 0.022, 'butter.light', { at: [0.27, BOARD_Y + 0.13, 0], g: 2 }],
  { at: BOARD },
];
/**
 * The count, in the pixel font: each run of lit pixels a block a little narrower than its cells
 * and standing proud of the board, so that the gaps between the strokes survive the cubes.
 */
const PX = 0.03;
const COUNT = text('3000');
const digits: Item[] = COUNT.flatMap((row, j): Item[] => {
  const out: Item[] = [];
  const w = row.length;
  for (let i = 0; i < w;) {
    if (row[i] !== '#') {
      i += 1;
      continue;
    }
    let k = i;
    while (k < w && row[k] === '#') k += 1;
    out.push([
      'box',
      (k - i) * PX - 0.01,
      PX - 0.01,
      0.016,
      'butter.light',
      {
        at: [
          BOARD[0] + ((i + k) / 2 - w / 2) * PX,
          BOARD[1] + BOARD_Y + (COUNT.length / 2 - j - 0.5) * PX,
          BOARD[2] + 0.022,
        ],
        g: 1,
      },
    ]);
    i = k;
  }
  return out;
});

/** A hacker's tent: an A-frame of two slopes, open at the front on a laptop's light. */
const tent = (at: Vec3, yaw: number, family: 'butter' | 'sky' | 'blue'): Item => {
  const cloth: ColorPath = family === 'blue' ? 'space.600' : `${family}.base`;
  const seam: ColorPath = family === 'blue' ? 'butter.base' : `${family}.shade`;
  return [
    'g',
    ['box', 0.07, 0.012, 0.13, cloth, { at: [-0.026, 0.035, 0], rot: [0, 0, -0.85] }],
    ['box', 0.07, 0.012, 0.13, cloth, { at: [0.026, 0.035, 0], rot: [0, 0, 0.85] }],
    ['box', 0.012, 0.012, 0.135, seam, { at: [0, 0.064, 0] }],
    ['box', 0.07, 0.05, 0.01, cloth, { at: [0, 0.025, -0.06] }],
    ['box', 0.024, 0.016, 0.02, 'sky.light', { at: [0, 0.01, 0.03], g: 2 }],
    { at, rot: [0, yaw, 0] },
  ];
};
/** The camp on the glade, round its fire. */
const CAMP = { x: 0.4, z: 0.3 };
const TENTS: readonly [number, number, 'butter' | 'sky' | 'blue'][] = [
  [0, 0.17, 'blue'],
  [55, 0.18, 'butter'],
  [110, 0.17, 'blue'],
  [175, 0.18, 'butter'],
  [235, 0.17, 'sky'],
  [295, 0.18, 'blue'],
];
const FIRE = G.at(CAMP.x, CAMP.z);
/** Its flames (a part of their own: they flicker). */
const flames: Item = [
  'g',
  ['cone', 0.032, 0, 0.012, 0.075, 6, 'nature.amber', { g: 2 }],
  ['cone', 0.02, 0, 0.012, 0.055, 6, 'nature.lamp', { at: [0.012, 0, 0.008], g: 2 }],
  { at: FIRE },
];
const campfire: Item = [
  'g',
  ['box', 0.08, 0.016, 0.018, 'nature.bark', { at: [0, 0.008, 0], rot: [0, 0.5, 0] }],
  ['box', 0.08, 0.016, 0.018, 'nature.bark', { at: [0, 0.008, 0], rot: [0, -0.6, 0] }],
  ...[0, 1, 2, 3, 4, 5].map((i): Item => [
    'box',
    0.026,
    0.02,
    0.026,
    i % 2 ? 'nature.flint' : 'nature.rock',
    { at: [0.06 * Math.cos(i * 1.05), 0.008, 0.06 * Math.sin(i * 1.05)] },
  ]),
  { at: FIRE },
];

/** Sather Gate at the foot of the esplanade: two piers, the bronze arch, gold on it. */
const GATE = G.brg(165, 0.66);
const sather: Item = [
  'g',
  ['box', 0.05, 0.17, 0.05, 'nature.flint', { at: [-0.11, 0.085, 0] }],
  ['box', 0.05, 0.17, 0.05, 'nature.flint', { at: [0.11, 0.085, 0] }],
  ['box', 0.06, 0.02, 0.06, 'ink.high', { at: [-0.11, 0.18, 0] }],
  ['box', 0.06, 0.02, 0.06, 'ink.high', { at: [0.11, 0.18, 0] }],
  ['box', 0.2, 0.02, 0.02, 'nature.wood', { at: [0, 0.2, 0] }],
  ['box', 0.16, 0.014, 0.016, 'nature.wood', { at: [0, 0.165, 0] }],
  ...[-0.05, 0, 0.05].map((x): Item => [
    'box',
    0.008,
    0.16,
    0.008,
    'nature.wood',
    { at: [x, 0.085, 0] },
  ]),
  ['bead', 0.018, 'nature.gold', { at: [0, 0.225, 0] }],
  { at: GATE, rot: [0, facing(165), 0] },
];

/** A banner on a pole in Berkeley blue and gold. */
const banner = (at: Vec3, yaw: number): Item => [
  'g',
  ['box', 0.014, 0.22, 0.014, 'ink.mid', { at: [0, 0.11, 0] }],
  ['box', 0.05, 0.012, 0.012, 'ink.mid', { at: [0.022, 0.21, 0] }],
  ['box', 0.044, 0.1, 0.008, 'space.600', { at: [0.03, 0.155, 0] }],
  ['box', 0.044, 0.016, 0.01, 'butter.base', { at: [0.03, 0.135, 0] }],
  ['box', 0.044, 0.01, 0.01, 'butter.base', { at: [0.03, 0.2, 0] }],
  { at, rot: [0, yaw, 0] },
];

/** A live oak: a short trunk and a wide, low crown of dark leaves. */
const oak = (at: Vec3, s: number, autumn = false): Item => [
  'g',
  ['box', 0.04, 0.1, 0.04, 'nature.bark', { at: [0, 0.05, 0] }],
  ['bead', 0.1, autumn ? 'nature.amber' : 'nature.moss', { at: [0, 0.15, 0], s: [1.25, 0.8, 1.1] }],
  ['bead', 0.07, autumn ? 'nature.gold' : 'nature.grass', { at: [0.05, 0.2, -0.03] }],
  { at, s },
];
/** A redwood: tall and narrow. */
const redwood = (at: Vec3, s: number): Item => [
  'g',
  ['box', 0.035, 0.14, 0.035, 'nature.clay', { at: [0, 0.07, 0] }],
  ['cone', 0.075, 0.04, 0.1, 0.24, 7, 'nature.fir'],
  ['cone', 0.06, 0.02, 0.22, 0.36, 7, 'nature.pine'],
  ['cone', 0.04, 0, 0.34, 0.46, 7, 'nature.pine'],
  { at, s },
];

/** California poppies, and a few white and blue flowers among them. */
const POPPIES: readonly ColorPath[] = [
  'nature.amber',
  'nature.gold',
  'nature.amber',
  'ink.high',
  'sky.light',
];
const poppies = (
  n: number,
  seed: number,
  avoid: readonly (readonly [number, number, number])[],
): Item[] => {
  const out: Item[] = [];
  for (let i = 0; out.length < n && i < n * 6; i += 1) {
    const b = (jitter(seed, i * 2) + 1) * Math.PI;
    const r = 0.9 * Math.sqrt((jitter(seed, i * 2 + 1) + 1) / 2);
    const x = r * Math.sin(b);
    const z = -r * Math.cos(b);
    if (avoid.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) continue;
    out.push([
      'box',
      0.022,
      0.022,
      0.022,
      POPPIES[out.length % POPPIES.length] ?? 'nature.amber',
      { at: G.at(x, z, 0.02) },
    ]);
  }
  return out;
};

/** The stream's pond, and the bearing it pours over the rim at. */
const POND = { x: -0.64, z: -0.06, r: 0.08 };
const FALL = 262;

const CLEAR: readonly (readonly [number, number, number])[] = [
  [TOWER[0], TOWER[2], 0.24],
  [BOARD[0], BOARD[2], 0.16],
  [BOARD[0] - 0.18, BOARD[2], 0.12],
  [BOARD[0] + 0.18, BOARD[2], 0.12],
  [CAMP.x, CAMP.z, 0.3],
  [GATE[0], GATE[2], 0.16],
  [POND.x, POND.z, 0.14],
  [-0.84, -0.1, 0.1],
  [0.66, 0.52, 0.18],
  [0.7, 0.2, 0.12],
  // The esplanade, from the gate up to the tower.
  [0.04, 0.38, 0.12],
  [0.01, 0.12, 0.1],
  // The front stays low, so the camp and the board are seen over it.
  [-0.36, 0.7, 0.2],
  [-0.62, 0.52, 0.14],
  [0.42, 0.66, 0.16],
  [0.1, 0.86, 0.12],
];
const open = (p: Vec3): boolean => !CLEAR.some(([x, z, r]) => Math.hypot(p[0] - x, p[2] - z) < r);

export const calHacks: Rows = [
  G.hull,
  ['campanile', 0, campanile],
  ['bell', 0, bell],
  ['scoreboard', 0, scoreboard],
  ['score-digits', 0, ...digits],
  [
    'tents',
    0,
    ...TENTS.map(([deg, r, family]) => {
      const p = G.at(
        CAMP.x + r * Math.sin((deg * Math.PI) / 180),
        CAMP.z - r * Math.cos((deg * Math.PI) / 180),
      );
      return tent(p, facing(deg) + Math.PI, family);
    }),
  ],
  ['campfire', 0, campfire],
  ['flames', 0, flames],
  [
    'esplanade',
    0,
    sather,
    ...stones(
      G,
      [GATE[0] * 0.92, GATE[2] * 0.92],
      [TOWER[0] + 0.02, TOWER[2] + 0.14],
      7,
      'nature.sand',
    ),
    banner(G.at(-0.04, 0.3), facing(165)),
    banner(G.at(0.12, 0.3), facing(165)),
    banner(G.at(-0.06, 0.04), facing(165)),
    banner(G.at(0.1, 0.04), facing(165)),
    lamppost(G.brg(150, 0.7), 1),
    lamppost(G.brg(180, 0.7), 1),
  ],
  [
    'grove',
    0,
    ...forest(
      G,
      8,
      31,
      CLEAR,
      ['nature.moss', 'nature.amber', 'nature.grass', 'nature.gold'],
      [0.45, 0.92],
    ),
    ...[20, 48, 75, 290, 320, 345, 120, 98, 250]
      .map((deg, i) => ({
        i,
        at: G.brg(deg + 8 * jitter(31, i), 0.62 + 0.24 * Math.abs(jitter(37, i))),
      }))
      .filter(({ at }) => open(at))
      .map(({ i, at }): Item => oak(at, 1 + 0.25 * jitter(41, i), i % 4 === 1)),
    ...[5, 35, 62, 300, 333, 270, 278]
      .map((deg, i) => ({
        i,
        at: G.brg(deg + 6 * jitter(43, i), 0.78 + 0.12 * Math.abs(jitter(47, i))),
      }))
      .filter(({ at }) => open(at))
      .map(({ i, at }): Item => redwood(at, 0.9 + 0.2 * jitter(53, i))),
    tree(G.brg(65, 0.62), 0.9, 'nature.gold', 'nature.amber'),
    rock(G.brg(185, 0.88), 1.1, 1),
    rock(G.brg(100, 0.82), 0.9, 2),
    rock(G.at(0.16, -0.18), 0.8, 3),
    rock(G.brg(232, 0.84), 0.9, 4),
    bush(G.brg(140, 0.88), 1.1, 'nature.moss'),
    bush(G.brg(196, 0.78), 1, 'nature.pine'),
    bush(G.brg(240, 0.7), 1, 'nature.moss'),
    bush(G.brg(122, 0.8), 0.9, 'nature.grass'),
  ],
  ['meadow', 0, ...poppies(32, 31, CLEAR.slice(0, 6))],
  ['falls', 0, ...falls(G, FALL, POND)],
  ['flow', 0, flow(G, FALL)],
  ['smoke-1', 0, puff([FIRE[0], FIRE[1] + 0.09, FIRE[2]], 0.9)],
  ['smoke-2', 0, puff([FIRE[0], FIRE[1] + 0.09, FIRE[2]], 1.1)],
  ['leaves', 0, leaves(G.brg(320, 0.7, 0.14), ['nature.gold', 'nature.amber', 'nature.rust'])],
  ['crystals', 0, ...G.crystals],
  ['gulls', 0, ...gulls(3, 0.84, 0.76, 31)],
  ['islets', 0, islet([1.12, -0.5, 0.3], 0.9, 9), islet([-1.04, -0.62, -0.5], 0.75, 10)],
  ['clouds', 0, cloud([1.0, 0.6, -0.78], 0.85), cloud([-1.24, 0.62, -0.36], 0.8)],
];
