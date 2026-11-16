import type { Vec3 } from '../../../sim/world/kit';
import type { ColorPath } from '../../../sim/world/palette';
import { FLAG, type Item, type Rows } from '../../../sim/world/rows';
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
  jitter,
  leaves,
  pine,
  puff,
  rock,
  tree,
  type Isle,
} from '../isles';

/**
 * FISH ONBOARDING: a blossom island in spring, where a newcomer learns the game. Through a gate
 * at the rim, eight stepping stones wind up the hill to a giant phone with the guide's QR code on
 * its screen; the two checkpoints, where you make the move yourself, are coral stones by glowing
 * lanterns ('lanterns'), and a marker bobs over the next one ('guide'). Cherry trees in pink and
 * lilac, a koi pond spilling over the rim, a tea house smoking, petals drifting down.
 */

/** Where the island is seen from first (the lab's turntable, and a ship coming in to dock). */
const VIEW = 135;
const at2 = (deg: number, r: number): readonly [number, number] => [
  r * Math.sin((deg * Math.PI) / 180),
  -r * Math.cos((deg * Math.PI) / 180),
];
/** A bearing in degrees to the turn that makes a thing's +Z face out along it. */
const face = (deg: number): number => Math.PI - (deg * Math.PI) / 180;

/** The hill the phone stands on, at the back; the koi pond on the left. */
const HILL = { x: at2(VIEW + 180, 0.3)[0], z: at2(VIEW + 180, 0.3)[1] };
const POND = { x: at2(VIEW + 78, 0.55)[0], z: at2(VIEW + 78, 0.55)[1], r: 0.12 };

const G = isle({
  seed: 17,
  hills: 0.14,
  bumps: 0.03,
  pads: [
    { x: HILL.x, z: HILL.z, r: 0.19, dy: 0.25 },
    { x: POND.x, z: POND.z, r: POND.r + 0.03, dy: 0.05 },
  ],
  grass: ['nature.grass', 'nature.meadow', 'biome.bloom.high'],
  soil: ['nature.loam', 'nature.clay'],
  crystal: 'lilac.light',
});

// --- The phone and its code -----------------------------------------------------------------------

// prettier-ignore
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
const PX = 0.032;
const PHONE = { w: 0.34, h: 0.56, d: 0.05 };
const HILL_Y = G.h(HILL.x, HILL.z);
/**
 * The phone stands upright on the hilltop facing +Z, square to the cubes, so that its code lands
 * on them cell for cell (a face turned off the grid comes out in steps). The screen is listed
 * before the case: the first to reach a cube takes it.
 */
const PHONE_AT: Vec3 = [HILL.x, HILL_Y + PHONE.h / 2 + 0.05, HILL.z];
const PHONE_ROT: Vec3 = [0, 0, 0];
const phone: Item = [
  'g',
  // The guide's header in coral over the code, and a step counter under it: two of eight lit.
  [
    'box',
    PHONE.w - 0.03,
    0.05,
    0.012,
    'coral.base',
    { at: [0, PHONE.h / 2 - 0.06, PHONE.d / 2 + 0.002], g: 1 },
  ],
  ...Array.from({ length: 8 }, (_, i): Item => [
    'box',
    0.018,
    0.018,
    0.012,
    i < 2 ? 'coral.base' : 'lilac.light',
    { at: [-0.0735 + i * 0.021, -PHONE.h / 2 + 0.065, PHONE.d / 2 + 0.002], g: 1 },
  ]),
  ['box', 0.06, 0.01, 0.012, 'space.600', { at: [0, PHONE.h / 2 - 0.016, PHONE.d / 2 + 0.002] }],
  ['box', 0.08, 0.012, 0.012, 'ink.low', { at: [0, -PHONE.h / 2 + 0.03, PHONE.d / 2 + 0.002] }],
  [
    'box',
    PHONE.w - 0.03,
    PHONE.h - 0.05,
    0.014,
    'ink.high',
    { at: [0, -0.005, PHONE.d / 2], g: 1 },
  ],
  ['box', PHONE.w, PHONE.h, PHONE.d, 'space.600'],
  // Its stand behind it and a rim of lilac on its edge.
  ['box', 0.12, 0.3, 0.03, 'space.600', { at: [0, -0.15, -0.09], rot: [0.5, 0, 0] }],
  [
    'box',
    PHONE.w + 0.012,
    0.02,
    PHONE.d + 0.012,
    'lilac.base',
    { at: [0, -PHONE.h / 2 + 0.01, 0] },
  ],
  { at: PHONE_AT, rot: PHONE_ROT },
];
/** The code, on the phone's face (a decal: it takes the screen's cubes). */
const qr: Item = [
  'g',
  ['pix', QR, PX, 'space.900', { at: [0, 0.0, PHONE.d / 2 + 0.008], g: 1 }],
  { at: PHONE_AT, rot: PHONE_ROT },
];

// --- The path of eight stones ---------------------------------------------------------------------

/** The path: from the gate at the rim, round to the left and up the hill to the phone's foot. */
const START = at2(VIEW, 0.8);
const BEND = at2(VIEW + 62, 0.42);
const END = [HILL.x + at2(VIEW, 0.17)[0], HILL.z + at2(VIEW, 0.17)[1]] as const;
const along = (t: number): readonly [number, number] => {
  const u = 1 - t;
  return [
    u * u * START[0] + 2 * u * t * BEND[0] + t * t * END[0],
    u * u * START[1] + 2 * u * t * BEND[1] + t * t * END[1],
  ];
};
/** The two stones where you make the move yourself. */
const CHECKPOINTS = new Set([2, 5]);
const STONES = Array.from({ length: 8 }, (_, i) => along(i / 7));
const steps: Item[] = STONES.map(([x, z], i): Item => {
  const check = CHECKPOINTS.has(i);
  return [
    'g',
    [
      'cyl',
      check ? 0.068 : 0.058,
      -0.02,
      0.02,
      9,
      'nature.flint',
      'nature.flint',
      check ? 'coral.base' : 'ink.high',
    ],
    { at: G.at(x, z, 0.004), rot: [0, i * 0.7, 0] },
  ];
});

/** The gravel the stones are set in, from the gate to the phone (after the stones: they win). */
const gravel: Item[] = Array.from({ length: 14 }, (_, i): Item => {
  const [x0, z0] = along(i / 14 - 0.04);
  const [x1, z1] = along((i + 1) / 14 + 0.04);
  const x = (x0 + x1) / 2;
  const z = (z0 + z1) / 2;
  return [
    'box',
    0.1,
    0.03,
    Math.hypot(x1 - x0, z1 - z0),
    i % 2 ? 'nature.sand' : 'biome.dune.peak',
    { at: G.at(x, z, -0.008), rot: [0, Math.atan2(x1 - x0, z1 - z0), 0] },
  ];
});

/** A stone lantern: a foot, a post, a lit box with its windows, a roof. Its light is apart. */
const lanternStone = (at: Vec3, s = 1): Item => [
  'g',
  ['box', 0.06, 0.02, 0.06, 'nature.flint', { at: [0, 0.01, 0] }],
  ['box', 0.026, 0.07, 0.026, 'nature.flint', { at: [0, 0.055, 0] }],
  ['box', 0.06, 0.012, 0.06, 'nature.rock', { at: [0, 0.095, 0] }],
  ['box', 0.05, 0.05, 0.05, 'nature.flint', { at: [0, 0.125, 0] }],
  ['cone', 0.06, 0.0, 0.15, 0.2, 4, 'coral.shade', { rot: [0, Math.PI / 4, 0] }],
  ['bead', 0.012, 'coral.shade', { at: [0, 0.205, 0] }],
  { at, s },
];
const lanternLight = (at: Vec3, s = 1): Item => [
  'g',
  ['box', 0.066, 0.034, 0.03, 'nature.lamp', { at: [0, 0.125, 0], g: 2 }],
  ['box', 0.03, 0.034, 0.066, 'nature.lamp', { at: [0, 0.125, 0], g: 2 }],
  { at, s },
];
/** A lantern beside each checkpoint, on the side of the path away from the bend. */
const LANTERNS: Vec3[] = [...CHECKPOINTS].map((i): Vec3 => {
  const [x, z] = STONES[i] ?? [0, 0];
  const [nx, nz] = STONES[i + 1] ?? [0, 0];
  const dx = nx - x;
  const dz = nz - z;
  const n = Math.hypot(dx, dz) || 1;
  return G.at(x - (dz / n) * 0.1, z + (dx / n) * 0.1);
});

/** The marker over the next checkpoint: a coral pin, point down ('guide' bobs it). */
const NEXT = STONES[2] ?? [0, 0];
const guide: Item = [
  'g',
  ['cone', 0.035, 0.0, 0.0, -0.06, 8, 'coral.base'],
  ['bead', 0.036, 'coral.base', { at: [0, 0.012, 0] }],
  ['bead', 0.014, 'ink.high', { at: [0, 0.016, 0.03] }],
  { at: G.at(NEXT[0], NEXT[1], 0.2) },
];

/** The gate at the rim where the path starts: two coral posts and two beams, a lilac plaque. */
const gate: Item = [
  'g',
  ['box', 0.025, 0.24, 0.025, 'coral.base', { at: [-0.09, 0.12, 0] }],
  ['box', 0.025, 0.24, 0.025, 'coral.base', { at: [0.09, 0.12, 0] }],
  ['box', 0.26, 0.025, 0.035, 'coral.shade', { at: [0, 0.245, 0] }],
  ['box', 0.29, 0.015, 0.04, 'space.600', { at: [0, 0.264, 0] }],
  ['box', 0.2, 0.018, 0.025, 'coral.base', { at: [0, 0.19, 0] }],
  ['box', 0.05, 0.045, 0.03, 'lilac.light', { at: [0, 0.22, 0] }],
  ['box', 0.04, 0.03, 0.04, 'nature.flint', { at: [-0.09, 0.012, 0] }],
  ['box', 0.04, 0.03, 0.04, 'nature.flint', { at: [0.09, 0.012, 0] }],
  {
    at: G.at(...along(-0.08)),
    rot: [0, Math.atan2(BEND[0] - START[0], BEND[1] - START[1]), 0],
  },
];

// --- Blossom and the life round it ----------------------------------------------------------------

/** The blossom: cherry pinks, lilac, a white plum. [crown, top]. */
const BLOSSOM: readonly (readonly [ColorPath, ColorPath])[] = [
  ['nature.rose', 'biome.bloom.high'],
  ['biome.bloom.high', 'ink.high'],
  ['nature.plum', 'lilac.light'],
  ['nature.rose', 'coral.light'],
  ['lilac.light', 'ink.high'],
];

/** A cherry tree: a dark trunk with a branch, a crown of three blobs of blossom. */
const cherry = (at: Vec3, s: number, crown: ColorPath, top: ColorPath): Item => [
  'g',
  ['box', 0.034, 0.15, 0.034, 'nature.clay', { at: [0, 0.075, 0] }],
  ['box', 0.07, 0.02, 0.018, 'nature.clay', { at: [0.035, 0.13, 0], rot: [0, 0, 0.6] }],
  ['box', 0.06, 0.018, 0.018, 'nature.clay', { at: [-0.03, 0.14, 0.01], rot: [0, 0.5, -0.6] }],
  ['bead', 0.095, crown, { at: [0, 0.2, 0] }],
  ['bead', 0.07, crown, { at: [0.07, 0.17, 0.03] }],
  ['bead', 0.065, top, { at: [-0.03, 0.27, -0.02] }],
  { at, s },
];

type Clear = readonly (readonly [number, number, number])[];

/** The tea house on the right, and where its smoke leaves. */
const HOUSE = G.brg(VIEW - 78, 0.64);
const HOUSE_SPIN = face(VIEW - 30);
const HOUSE_S = 1.1;
const CHIMNEY = chimneyOf(HOUSE, HOUSE_S, HOUSE_SPIN);
const FALL = VIEW + 78;

const CLEAR: Clear = [
  [HILL.x, HILL.z, 0.26],
  [POND.x, POND.z, POND.r + 0.08],
  [HOUSE[0], HOUSE[2], 0.18],
  ...Array.from({ length: 15 }, (_, i): readonly [number, number, number] => [
    ...along(i / 14),
    0.13,
  ]),
  ...LANTERNS.map((p): readonly [number, number, number] => [p[0], p[2], 0.08]),
  [START[0], START[1], 0.16],
  [at2(FALL, 0.8)[0], at2(FALL, 0.8)[1], 0.1],
];

/** Blossom trees all round, a few dark pines among them, low azaleas in front of the path. */
function orchard(isle: Isle, n: number, seed: number): Item[] {
  const out: Item[] = [];
  const taken: [number, number][] = [];
  for (let i = 0; out.length < n && i < n * 12; i += 1) {
    const b = (jitter(seed, i * 3) + 1) * Math.PI;
    const rr = isle.r * (0.3 + 0.62 * ((jitter(seed, i * 3 + 1) + 1) / 2));
    const x = rr * Math.sin(b);
    const z = -rr * Math.cos(b);
    if (CLEAR.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) continue;
    if (taken.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 0.11)) continue;
    taken.push([x, z]);
    const deg = ((((b * 180) / Math.PI) % 360) + 360) % 360;
    const front = Math.abs(((deg - VIEW + 540) % 360) - 180) < 38;
    const s = 0.8 + 0.35 * ((jitter(seed, i * 3 + 2) + 1) / 2);
    const at = isle.at(x, z);
    const k = out.length;
    const [crown, top] = BLOSSOM[k % BLOSSOM.length] ?? ['nature.rose', 'ink.high'];
    out.push(
      front
        ? bush(at, s * 1.15, k % 2 ? 'nature.rose' : 'nature.moss')
        : k % 6 === 4
          ? pine(at, s * 0.95)
          : k % 6 === 1
            ? tree(at, s, 'nature.moss', 'nature.grass')
            : cherry(at, s, crown, top),
    );
  }
  return out;
}

/** The koi pond: a ring of stones, the water, two koi and a lily. */
const POND_Y = G.h(POND.x, POND.z);
const koi: Item[] = [
  [
    'box',
    0.05,
    0.012,
    0.02,
    'coral.base',
    { at: [POND.x + 0.03, POND_Y + 0.008, POND.z - 0.02], rot: [0, 0.7, 0] },
  ],
  [
    'box',
    0.045,
    0.012,
    0.02,
    'ink.high',
    { at: [POND.x - 0.04, POND_Y + 0.008, POND.z + 0.03], rot: [0, -0.4, 0] },
  ],
  [
    'box',
    0.016,
    0.012,
    0.016,
    'coral.base',
    { at: [POND.x - 0.03, POND_Y + 0.009, POND.z + 0.04] },
  ],
  [
    'cyl',
    0.028,
    POND_Y + 0.002,
    POND_Y + 0.01,
    8,
    'nature.moss',
    { at: [POND.x - 0.05, 0, POND.z - 0.05] },
  ],
];
const pondRim: Item = [
  'around',
  11,
  0.2,
  POND.r + 0.02,
  POND_Y,
  1,
  (i: number): Item => ['box', 0.04, 0.03, 0.035, i % 2 ? 'nature.flint' : 'nature.rock'],
  { at: [POND.x, 0, POND.z] },
];

export const fishOnboarding: Rows = [
  G.hull,
  ['phone', 0, phone],
  ['qr-code', FLAG.decal, qr],
  ['steps', FLAG.decal, ...steps],
  ['gravel', FLAG.decal, ...gravel],
  ['lanterns', 0, ...LANTERNS.map((p) => lanternLight(p))],
  ['lantern-stones', 0, ...LANTERNS.map((p) => lanternStone(p))],
  ['guide', 0, guide],
  ['gate', 0, gate],
  [
    'orchard',
    0,
    ...orchard(G, 28, 17),
    cherry(G.brg(VIEW + 150, 0.55), 1.3, 'nature.rose', 'biome.bloom.high'),
    cherry(G.brg(VIEW - 140, 0.6), 1.25, 'nature.plum', 'lilac.light'),
    rock(G.brg(VIEW + 40, 0.86), 1.1, 1),
    rock(G.brg(VIEW - 110, 0.84), 0.9, 2),
    rock(G.at(HILL.x + 0.16, HILL.z - 0.08), 1, 3),
  ],
  ['meadow', 0, ...flowers(G, 30, 17, CLEAR.slice(0, 3))],
  ['koi', FLAG.decal, ...koi],
  ['pond', 0, pondRim],
  ['tea-house', 0, cottage(HOUSE, HOUSE_S, 'ink.high', 'lilac.base', HOUSE_SPIN)],
  ['falls', FLAG.decal, ...falls(G, FALL, POND, 0.7)],
  ['flow', 0, flow(G, FALL, 0.7)],
  ['smoke-1', 0, puff([CHIMNEY[0], CHIMNEY[1] + 0.02, CHIMNEY[2]], 0.9)],
  ['smoke-2', 0, puff([CHIMNEY[0], CHIMNEY[1] + 0.02, CHIMNEY[2]], 1.1)],
  [
    'leaves',
    0,
    leaves(G.brg(VIEW + 150, 0.55, 0.16), ['nature.rose', 'biome.bloom.high', 'ink.high']),
  ],
  ['crystals', 0, ...G.crystals],
  ['gulls', 0, ...gulls(3, 0.82, 0.7, 17)],
  [
    'islets',
    0,
    blossomIslet([1.1, -0.52, 0.4], 0.95, 1),
    blossomIslet([-1.05, -0.6, -0.48], 0.8, 2),
  ],
  ['clouds', 0, cloud([-1.2, 0.62, 0.45], 0.85), cloud([1.22, 0.55, -0.45], 0.8)],
];

/** An islet with a little cherry tree on it. */
function blossomIslet(at: Vec3, s: number, seed: number): Item {
  return [
    'g',
    ['cone', 0.09, 0, 0, -0.14, 6, 'nature.slate'],
    ['cyl', 0.095, -0.03, 0, 6, 'nature.soil'],
    ['cyl', 0.095, 0, 0.02, 6, 'nature.grass'],
    cherry(
      [0.02 * jitter(seed, 1), 0.02, 0.02 * jitter(seed, 2)],
      0.5,
      'nature.rose',
      'biome.bloom.high',
    ),
    { at, s },
  ];
}
