import { TAU } from '../../sim/math';
import { brg, type Vec2 } from '../../sim/world/kit';
import { crane, chip, dashes, pebbles, planned } from '../../sim/world/planned';
import { FLAG, type BodyRecipe, type Item, type Mod, type Rows } from '../../sim/world/rows';
import { rad, sunGround } from './shared';

/**
 * RESEARCH: its sun (mint), Sports Analysis and its moon Kalshi, both planned. Rows
 * (sim/world/rows.ts), keyed by manifest id; the close-up parts are in near.ts, the motions in
 * motion.ts.
 *
 * DESIGN SURFACE: the rows are free to change; their part names are what the motion table and
 * the tests refer to.
 */

// The standard candle: a ring drawn as its own light curve, a polar area chart. Its outer edge
// is the brightness: a flat baseline, one sharp rise, a long taper. A cursor sweeps round it (and
// up close, twelve ticks make it a clock of one period).
const curve = (u: number): number => (u < 0.1 ? u / 0.1 : ((1 - u) / 0.9) ** 1.7);
const outer = (t: number): number => 1.24 + 0.42 * curve(((((t - 0.7) % TAU) + TAU) % TAU) / TAU);
const sun: Rows = [
  sunGround('mint'),
  [
    'light-curve',
    FLAG.hold | FLAG.flat,
    ['ring', (t) => [1.17, outer(t) - 0.04], 0, TAU, 72, 0, 0, 'mint.shade'],
    ['ring', (t) => [outer(t) - 0.04, outer(t)], 0, TAU, 72, 0.001, 0.001, 'ink.high'],
  ],
  [
    'cursor',
    FLAG.hold | FLAG.flat,
    ['rq', rad(200), 1.02, 1.66, 0.022, 0.022, 0, 0.001, 'ink.high'],
  ],
];

// Sports Analysis: research that has not started. A plain ball (no sport is chosen), a court
// staked out on its north cap with survey string (a rectangle, a halfway line and a centre
// circle: every court and pitch has them), and the dashed ring that is also the third of
// Newton's cannonball shots, the one fast enough to come back round, with the ball on it.
const COURT = { x: 0.42, z: 0.28, y: 1.02 } as const;
const stakeAt = (x: number, z: number): Item => [
  'cyl',
  0.012,
  Math.sqrt(1 - x * x - z * z) - 0.02,
  COURT.y,
  4,
  'ink.mid',
  { at: [x, 0, z] },
];
const string = (x0: number, z0: number, x1: number, z1: number): Item => [
  'box',
  Math.hypot(x1 - x0, z1 - z0),
  0.012,
  0.012,
  'mint.base',
  { at: [(x0 + x1) / 2, COURT.y, (z0 + z1) / 2], rot: [0, Math.atan2(-(z1 - z0), x1 - x0), 0] },
];
const sportsAnalysis: Rows = [
  { seed: 'sports-analysis', biome: 'primer', recipe: { flat: 0.5 }, up: 'vertex' },
  [
    'court',
    0,
    ...(
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const
    ).map(([a, b]) => stakeAt(a * COURT.x, b * COURT.z)),
    string(-COURT.x, -COURT.z, COURT.x, -COURT.z),
    string(COURT.x, -COURT.z, COURT.x, COURT.z),
    string(COURT.x, COURT.z, -COURT.x, COURT.z),
    string(-COURT.x, COURT.z, -COURT.x, -COURT.z),
    string(0, -COURT.z, 0, COURT.z),
    ['ring', [0.1, 0.115], 0, TAU, 12, COURT.y, COURT.y, 'mint.base'],
  ],
  ...planned('mint', { n: 16, r: [1.42, 1.5], crane: [50, 232], chip: [78, 120, 3.65] }),
  [
    'ball',
    FLAG.hold,
    ['bead', 0.1, 'ink.high', { at: [brg(rad(300), 1.46)[0], 0.02, brg(rad(300), 1.46)[1]] }],
  ],
];

// Kalshi: a prediction market that grows out of the sports analysis. A coin lying nearly flat,
// in primer grey: two outcomes, one price. Both faces are plan (a half disc with a tick for yes,
// a cross for no), and both arcs of its ring are dashed.
export const COIN_TILT: Mod = { rot: [rad(-16), rad(20), rad(12)] };
const ARC = Array.from({ length: 10 }, (_, i): Vec2 => {
  const a = -Math.PI / 2 + (i / 9) * Math.PI;
  return [0.94 * Math.cos(a), 0.94 * Math.sin(a)];
});
/** A bar on the coin's face from one point to another. */
export const faceBar = (p0: Vec2, p1: Vec2, w: number, h: number, y: number): Item => [
  'box',
  Math.hypot(p1[0] - p0[0], p1[1] - p0[1]),
  h,
  w,
  'mint.base',
  {
    at: [(p0[0] + p1[0]) / 2, y, (p0[1] + p1[1]) / 2],
    rot: [0, Math.atan2(-(p1[1] - p0[1]), p1[0] - p0[0]), 0],
  },
];
/** An item placed on the coin's face, and tilted with the coin. */
export const onCoin = (item: Item, at: Mod['at'], s = 1): Item => [
  'g',
  ['g', item, { at, s }],
  COIN_TILT,
];
const kalshi: Rows = [
  [
    [
      'cyl',
      1,
      -0.11,
      0.11,
      18,
      'biome.primer.low',
      'biome.primer.shore',
      'biome.primer.low',
      COIN_TILT,
    ],
  ],
  [
    'yes-face',
    FLAG.hold | FLAG.ghost,
    [
      'g',
      ['prism', ARC, 0.11, 0.128, 'mint.light', 'mint.base', 'mint.base', 1],
      faceBar([0.14, -0.02], [0.36, 0.24], 0.13, 0.03, 0.142),
      faceBar([0.36, 0.24], [0.8, -0.4], 0.13, 0.03, 0.142),
      COIN_TILT,
    ],
  ],
  [
    'no-face',
    FLAG.hold | FLAG.ghost,
    [
      'g',
      faceBar([-0.72, -0.4], [-0.2, 0.36], 0.12, 0.03, 0.125),
      faceBar([-0.72, 0.36], [-0.2, -0.4], 0.12, 0.03, 0.125),
      COIN_TILT,
    ],
  ],
  [
    'outcome-ring',
    FLAG.hold,
    [
      'g',
      ...dashes('mint', [1.32, 1.4], 6, -Math.PI / 2, Math.PI / 2),
      ...dashes('mint', [1.32, 1.4], 6, Math.PI / 2, (3 * Math.PI) / 2),
      COIN_TILT,
    ],
  ],
  ['crane', 0, onCoin(crane('mint'), [0.3, 0.128, -0.55], 0.8)],
  ['paint-chip', 0, onCoin(chip('mint'), [-0.5, 0.128, 0.42])],
  ['debris', FLAG.hold, ['g', pebbles(5, 1.05, 0.14), COIN_TILT]],
];

export const RESEARCH: Readonly<Record<string, BodyRecipe>> = {
  'system/research': { rows: sun },
  'project/sports-analysis': { rows: sportsAnalysis, ghost: 'mint' },
  // The coin never turns with a planet's spin: it rocks, as a whole (motion.ts).
  'project/kalshi': { rows: kalshi, still: true, ghost: 'mint' },
};
