import { TAU } from '../../../sim/math';
import type { Vec3 } from '../../../sim/world/kit';
import type { ColorPath } from '../../../sim/world/palette';
import type { Item, Rows } from '../../../sim/world/rows';
import { beacon } from '../shared';
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
  type Isle,
} from '../isles';

/**
 * HACKGT 13 (HEARSAY): a listening post on a snowy hilltop. A radio dish on its lattice tower
 * turns its ear to the sky and the sound it hears rises from it in rings; on a big screen below
 * the clip it is judging plays as a waveform, its synthetic stretch in coral, a playhead reading
 * along it. Cables run down from the dish to the control hut, whose windows glow and whose stove
 * smokes. What it hears goes out again in a dashed ring of signal round the island. Snowy pines,
 * a few golden larches, a stream that pours off the rim.
 */

export const HACKGT = isle({
  seed: 23,
  hills: 0.18,
  bumps: 0.04,
  grass: ['nature.moss', 'nature.grass', 'nature.snow'],
  crystal: 'lilac.light',
  pads: [{ x: 0, z: -0.14, r: 0.15 }],
});
const G = HACKGT;

/** A straight beam of square section `w` from a to b (a strut, a cable, a leg). */
const beam = (a: Vec3, b: Vec3, w: number, color: ColorPath, g?: 1 | 2): Item => {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  const at: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const rot: Vec3 = [Math.acos(d[1] / len), Math.atan2(d[0], d[2]), 0];
  return ['box', w, len, w, color, g ? { at, rot, g } : { at, rot }];
};
/** The yaw that turns a thing's +Z to face compass bearing `deg`. */
const facing = (deg: number): number => Math.PI - (deg * Math.PI) / 180;

/** The dish on the summit: its tower, its bowl turned to the sky (towards `AIM`), its feed. */
const SUMMIT: Vec3 = G.at(0, -0.14);
const AIM = 72;
const TILT = 1.0;
const YAW = facing(AIM);
const HUB: Vec3 = [SUMMIT[0], SUMMIT[1] + 0.24, SUMMIT[2]];

const tower: Item[] = [
  ['box', 0.22, 0.04, 0.22, 'nature.flint', { at: [SUMMIT[0], SUMMIT[1] + 0.01, SUMMIT[2]] }],
  // Four legs that lean in, and a cross of braces on each side.
  ...[
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].flatMap(([sx = 1, sz = 1], i, all): Item[] => {
    const foot: Vec3 = [SUMMIT[0] + sx * 0.085, SUMMIT[1] + 0.02, SUMMIT[2] + sz * 0.085];
    const head: Vec3 = [SUMMIT[0] + sx * 0.04, SUMMIT[1] + 0.19, SUMMIT[2] + sz * 0.04];
    const [nx = 1, nz = 1] = all[(i + 1) % 4] ?? [1, 1];
    const nextHead: Vec3 = [SUMMIT[0] + nx * 0.04, SUMMIT[1] + 0.19, SUMMIT[2] + nz * 0.04];
    const nextFoot: Vec3 = [SUMMIT[0] + nx * 0.085, SUMMIT[1] + 0.02, SUMMIT[2] + nz * 0.085];
    return [
      beam(foot, head, 0.022, 'ink.mid'),
      beam(foot, nextHead, 0.012, 'ink.low'),
      beam(head, nextFoot, 0.012, 'ink.low'),
    ];
  }),
  ['box', 0.12, 0.025, 0.12, 'ink.high', { at: [SUMMIT[0], SUMMIT[1] + 0.2, SUMMIT[2]] }],
  ['cyl', 0.04, SUMMIT[1] + 0.21, HUB[1], 8, 'ink.mid', { at: [SUMMIT[0], 0, SUMMIT[2]] }],
];

/** The bowl as a lathe: its back, its rim, then the inside walked back down to the middle. */
const BOWL: [number, number][] = [
  [0, 0],
  [0, 0.07],
  [0.05, 0.17],
  [0.1, 0.25],
  [0.13, 0.29],
  [0.13, 0.27],
  [0.09, 0.2],
  [0.05, 0.1],
  [0.035, 0],
];
const dish: Item = [
  'g',
  [
    'lathe',
    BOWL,
    14,
    [
      'ink.mid',
      'ink.mid',
      'ink.mid',
      'ink.low',
      'ink.low',
      'ink.high',
      'biome.frost.low',
      'ink.high',
    ],
  ],
  // Three struts from the rim to the feed over the bowl's middle.
  ...[0, 1, 2].map((i): Item => {
    const a = (i / 3) * TAU + 0.5;
    return beam([0.25 * Math.cos(a), 0.12, 0.25 * Math.sin(a)], [0, 0.3, 0], 0.014, 'ink.mid');
  }),
  ['box', 0.05, 0.05, 0.05, 'lilac.base', { at: [0, 0.31, 0] }],
  ['cone', 0.03, 0.012, 0.335, 0.37, 6, 'lilac.light'],
  beacon([0, 0.39, 0]),
  { at: HUB, rot: [TILT, YAW, 0], s: 0.92 },
];
/**
 * What it hears, rings going out of the bowl along its axis: one group in the dish's own frame,
 * so that the part's own y is the dish's axis and the rings pulse along it.
 */
const waves: Item = [
  'g',
  ...[0, 1, 2].map((i): Item => [
    'ring',
    [0.08 + i * 0.05, 0.096 + i * 0.05],
    0,
    TAU,
    14,
    0.42 + i * 0.13,
    0.434 + i * 0.13,
    'lilac.light',
    'lilac.light',
    1,
    { g: 1 },
  ]),
  { at: HUB, rot: [TILT, YAW, 0] },
];

/** The screen the clip plays on: its waveform as bars, the synthetic stretch in coral. */
const SCREEN = G.brg(292, 0.5);
const SCREEN_YAW = facing(160);
const BARS = 15;
const SCREEN_W = 0.5;
const PANEL_Y = 0.34;
const screen: Item = [
  'g',
  ['box', SCREEN_W + 0.05, 0.3, 0.025, 'ink.mid', { at: [0, PANEL_Y, -0.012] }],
  ['box', SCREEN_W, 0.25, 0.02, 'space.900', { at: [0, PANEL_Y, 0.004], g: 1 }],
  ['box', SCREEN_W - 0.02, 0.006, 0.01, 'space.600', { at: [0, PANEL_Y, 0.016], g: 1 }],
  ...Array.from({ length: BARS }, (_, i): Item => {
    const h = 0.03 + 0.17 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6)) + (i >= 10 ? 0.03 : 0);
    return [
      'box',
      0.022,
      h,
      0.012,
      i >= 10 ? 'coral.base' : 'lilac.light',
      { at: [-SCREEN_W / 2 + 0.035 + i * ((SCREEN_W - 0.07) / (BARS - 1)), PANEL_Y, 0.018], g: 1 },
    ];
  }),
  // The verdict lamp on top: coral, synthetic.
  ['box', 0.06, 0.03, 0.03, 'coral.base', { at: [SCREEN_W / 2 - 0.05, PANEL_Y + 0.165, 0], g: 2 }],
  ['box', 0.03, 0.22, 0.03, 'ink.mid', { at: [-SCREEN_W / 2 + 0.05, 0.1, -0.02] }],
  ['box', 0.03, 0.22, 0.03, 'ink.mid', { at: [SCREEN_W / 2 - 0.05, 0.1, -0.02] }],
  ['box', 0.1, 0.04, 0.08, 'nature.flint', { at: [-SCREEN_W / 2 + 0.05, 0.0, -0.02] }],
  ['box', 0.1, 0.04, 0.08, 'nature.flint', { at: [SCREEN_W / 2 - 0.05, 0.0, -0.02] }],
  { at: SCREEN, rot: [0, SCREEN_YAW, 0] },
];
/** The playhead reading along the clip (a part of its own: it slides along the screen). */
const playhead: Item = [
  'g',
  ['box', 0.01, 0.23, 0.01, 'butter.light', { at: [-SCREEN_W / 2 + 0.03, PANEL_Y, 0.03], g: 1 }],
  { at: SCREEN, rot: [0, SCREEN_YAW, 0] },
];

/** The control hut: glowing windows, a stove's chimney, a small dish of its own on the roof. */
const HUT = G.brg(198, 0.5);
const HUT_YAW = facing(165);
const local = (x: number, y: number, z: number): Vec3 => [
  HUT[0] + x * Math.cos(HUT_YAW) + z * Math.sin(HUT_YAW),
  HUT[1] + y,
  HUT[2] - x * Math.sin(HUT_YAW) + z * Math.cos(HUT_YAW),
];
const CHIMNEY = local(0.07, 0.24, -0.04);
const hut: Item = [
  'g',
  ['box', 0.26, 0.04, 0.2, 'nature.flint', { at: [0, 0.0, 0] }],
  ['box', 0.24, 0.14, 0.18, 'ink.high', { at: [0, 0.09, 0] }],
  ['box', 0.27, 0.03, 0.21, 'nature.slate', { at: [0, 0.175, 0] }],
  ['box', 0.27, 0.02, 0.21, 'nature.snow', { at: [0, 0.195, 0] }],
  ...[-0.075, 0.075].map((x): Item => [
    'box',
    0.05,
    0.045,
    0.01,
    'lamp.window',
    { at: [x, 0.105, 0.091], g: 2 },
  ]),
  ['box', 0.01, 0.045, 0.05, 'lamp.window', { at: [0.121, 0.105, 0.02], g: 2 }],
  ['box', 0.045, 0.08, 0.01, 'sky.shade', { at: [0, 0.06, 0.091] }],
  ['box', 0.04, 0.09, 0.04, 'nature.brick', { at: [0.07, 0.2, -0.04] }],
  // A small dish of its own on a mast.
  ['box', 0.014, 0.12, 0.014, 'ink.mid', { at: [-0.08, 0.26, -0.03] }],
  ['cone', 0.02, 0.06, 0.31, 0.34, 8, 'ink.high', { at: [-0.08, 0, -0.03] }],
  { at: HUT, rot: [0, HUT_YAW, 0] },
];

/** Cables on poles, from the hut up to the dish and from the dish down to the screen. */
const poles = (from: [number, number], to: [number, number], n: number): Item[] => {
  const tops: Vec3[] = Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    return G.at(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, 0.13);
  });
  return [
    ...tops
      .slice(1, -1)
      .map((p): Item => [
        'box',
        0.016,
        0.13,
        0.016,
        'nature.bark',
        { at: [p[0], p[1] - 0.065, p[2]] },
      ]),
    ...tops.slice(1, -1).map((p): Item => ['box', 0.05, 0.012, 0.012, 'nature.bark', { at: p }]),
    ...tops.slice(0, -1).map((p, i): Item => beam(p, tops[i + 1] ?? p, 0.01, 'space.600')),
  ];
};
const cables: Item[] = [
  ...poles([HUT[0], HUT[2]], [SUMMIT[0] - 0.08, SUMMIT[2]], 3),
  ...poles([SUMMIT[0] + 0.08, SUMMIT[2] + 0.02], [SCREEN[0] - 0.05, SCREEN[2] - 0.05], 2),
];

/** A pine with snow on its tip. */
const snowPine = (at: Vec3, s: number, frosted = false): Item => [
  'g',
  pine([0, 0, 0], 1, frosted ? 'biome.frost.high' : 'nature.pine', 'nature.fir'),
  ['cone', 0.04, 0, 0.29, 0.375, 7, 'nature.snow'],
  ['cone', 0.075, 0.05, 0.155, 0.18, 7, 'nature.snow'],
  { at, s },
];
/** A rock with a cap of snow. */
const snowRock = (at: Vec3, s: number, seed: number): Item => [
  'g',
  rock([0, 0, 0], 1, seed),
  ['box', 0.06, 0.016, 0.05, 'nature.snow', { at: [0, 0.04, 0], rot: [0, jitter(seed, 1), 0.2] }],
  { at, s },
];
/** The wood: mostly snowy pines, a few golden larches and bushes, out of the places in `avoid`. */
function alpineWood(
  isle: Isle,
  n: number,
  seed: number,
  avoid: readonly (readonly [number, number, number])[],
): Item[] {
  const out: Item[] = [];
  for (let i = 0; out.length < n && i < n * 8; i += 1) {
    const b = (jitter(seed, i * 3) + 1) * Math.PI;
    const rr = isle.r * (0.3 + 0.6 * ((jitter(seed, i * 3 + 1) + 1) / 2));
    const x = rr * Math.sin(b);
    const z = -rr * Math.cos(b);
    if (avoid.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) continue;
    const s = 0.75 + 0.4 * ((jitter(seed, i * 3 + 2) + 1) / 2);
    const kind = out.length % 6;
    out.push(
      kind === 2
        ? tree(isle.at(x, z), s * 0.95, 'nature.gold', 'nature.amber')
        : kind === 5
          ? bush(isle.at(x, z), s * 1.2, 'nature.pine')
          : snowPine(isle.at(x, z), s, kind === 3),
    );
  }
  return out;
}

/** The stream's pond, and the bearing it pours over the rim at. */
const POND = { x: -0.5, z: 0.18, r: 0.08 };
const FALL = 242;

const CLEAR: readonly (readonly [number, number, number])[] = [
  [SUMMIT[0], SUMMIT[2], 0.25],
  [SCREEN[0], SCREEN[2], 0.2],
  [SCREEN[0] - 0.12, SCREEN[2] + 0.12, 0.14],
  [HUT[0], HUT[2], 0.2],
  [POND.x, POND.z, 0.14],
  [-0.7, 0.3, 0.12],
  [HUT[0] + 0.1, HUT[2] + 0.2, 0.16],
  [HUT[0] - 0.05, HUT[2] + 0.3, 0.12],
  [-0.2, -0.12, 0.08],
  [-0.38, -0.08, 0.08],
  [0.2, 0.0, 0.1],
  // The slope the dish looks out over stays open.
  [0.3, -0.24, 0.16],
];

export const hackgt: Rows = [
  G.hull,
  ['dish', 0, ...tower, dish],
  ['wave-ring', 0, waves],
  ['waveform', 0, screen],
  ['playhead', 0, playhead],
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
  ['control-hut', 0, hut, ...cables],
  [
    'wood',
    0,
    ...alpineWood(G, 28, 23, CLEAR),
    snowRock(G.brg(20, 0.86), 1.2, 1),
    snowRock(G.brg(300, 0.85), 1, 2),
    snowRock(G.brg(165, 0.84), 0.9, 3),
    snowRock(G.at(0.2, -0.3), 0.8, 4),
    // A snowman by the hut, a carrot nose and a scarf in the island's lilac.
    [
      'g',
      ['bead', 0.05, 'nature.snow', { at: [0, 0.045, 0] }],
      ['bead', 0.036, 'nature.snow', { at: [0, 0.115, 0] }],
      ['box', 0.06, 0.014, 0.06, 'lilac.base', { at: [0, 0.088, 0] }],
      ['box', 0.012, 0.012, 0.03, 'nature.amber', { at: [0, 0.118, 0.04] }],
      ['box', 0.05, 0.012, 0.05, 'space.600', { at: [0, 0.15, 0] }],
      ['box', 0.034, 0.03, 0.034, 'space.600', { at: [0, 0.17, 0] }],
      { at: G.at(HUT[0] + 0.2, HUT[2] + 0.16), rot: [0, facing(160), 0] },
    ],
  ],
  ['meadow', 0, ...flowers(G, 22, 23, CLEAR.slice(0, 4))],
  [
    'path',
    0,
    ...stones(G, [HUT[0] + 0.1, HUT[2] - 0.02], [SUMMIT[0] - 0.12, SUMMIT[2] + 0.06], 4),
    ...stones(G, [HUT[0] + 0.04, HUT[2] + 0.14], [HUT[0] + 0.12, 0.86], 3),
    lamppost(G.at(HUT[0] + 0.17, HUT[2] + 0.06), 1),
    lamppost(G.at(-0.12, 0.06), 1),
  ],
  ['falls', 0, ...falls(G, FALL, POND)],
  ['flow', 0, flow(G, FALL)],
  ['smoke-1', 0, puff([CHIMNEY[0], CHIMNEY[1] + 0.02, CHIMNEY[2]], 0.9)],
  ['smoke-2', 0, puff([CHIMNEY[0], CHIMNEY[1] + 0.02, CHIMNEY[2]], 1.1)],
  ['leaves', 0, leaves(G.at(-0.1, 0.3, 0.3), ['ink.high', 'nature.snow', 'biome.frost.low'])],
  ['crystals', 0, ...G.crystals],
  ['gulls', 0, ...gulls(3, 0.86, 0.72, 23)],
  ['islets', 0, islet([1.08, -0.55, -0.42], 0.9, 5), islet([-1.05, -0.6, 0.45], 0.75, 6)],
  ['clouds', 0, cloud([-1.22, 0.58, -0.42], 0.9), cloud([1.24, 0.6, 0.3], 0.75)],
];
