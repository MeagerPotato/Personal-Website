import { TAU } from '../../sim/math';
import { brg, type Vec2, type Vec3 } from '../../sim/world/kit';
import { planned } from '../../sim/world/planned';
import type { BodyRecipe, Item, PartRow, Rows } from '../../sim/world/rows';
import { rad, sunGround } from './shared';

/**
 * HACKATHONS: its sun (lilac), HackGT 13, Hackathons at Berkeley, Cal Hacks 13.0 and Corgi
 * (planned). Rows (sim/world/rows.ts), keyed by manifest id; the close-up parts (evidence
 * markers, the roof rack, the floodlights...) are in near.ts, the motions in motion.ts.
 *
 * DESIGN SURFACE: the rows are free to change; their part names are what the motion table and
 * the tests refer to.
 */

// --- the sun -------------------------------------------------------------------------------------

// A stopwatch: bezel, twelve hour marks, a crown on the north side and a side button. The hand is
// a long white blade held just above the face, parked one tick (six degrees) short of noon.
const sun: Rows = [
  sunGround('lilac'),
  [
    'stopwatch',
    3,
    ['ring', [1.2, 1.34], 0, TAU, 24, 0, 0.001, 'lilac.light', 'lilac.base'],
    [
      'around',
      12,
      0,
      0,
      0,
      1,
      (i) => [
        'rq',
        0,
        1.4,
        i % 3 ? 1.5 : 1.56,
        i % 3 ? 0.04 : 0.06,
        i % 3 ? 0.04 : 0.06,
        0,
        0.001,
        'lilac.light',
        'lilac.base',
      ],
    ],
    ['cyl', 0.1, 0, 0.3, 6, 'lilac.base', { at: [0, 0, -1.3], rot: [-Math.PI / 2, 0, 0] }],
    ['cyl', 0.16, 0, 0.1, 6, 'lilac.light', { at: [0, 0, -1.54], rot: [-Math.PI / 2, 0, 0] }],
    [
      'cyl',
      0.07,
      0,
      0.22,
      6,
      'lilac.base',
      { at: [brg(rad(48), 1.3)[0], 0, brg(rad(48), 1.3)[1]], rot: [-Math.PI / 2, -rad(48), 0] },
    ],
  ],
  [
    'hand',
    3,
    ['rq', rad(-6), 0, 1.5, 0.06, 0.012, 1.02, 1.02, 'star.white'],
    ['cyl', 0.07, 1.0, 1.05, 6, 'star.white'],
  ],
];

// --- HackGT 13 -------------------------------------------------------------------------------------

// The ground is the tide biome with its highland bands switched off (stops [0.12, 9, 9]), so the
// world is blue and teal only: a spectrogram, and nothing the colour of a school's gold.
// The wave ring is one utterance, twice: on the east the real voice, smooth; on the west the same
// words as a synthesiser would say them, quantised into steps, in coral. It stays inside 1.35
// radii (the lane rule, vocabulary.md section 9).
export const WAVE = { r: 1.22, amp: 0.085, step: 0.045, half: 0.045 } as const;
const signal = (t: number): number =>
  WAVE.amp * Math.sin(t) ** 0.7 * (0.65 * Math.sin(5 * t) + 0.35 * Math.sin(9 * t + 1));
const real = (t: number): Vec2 => [WAVE.r + signal(t) - WAVE.half, WAVE.r + signal(t) + WAVE.half];
const fake = (t: number): Vec2 => {
  const q = Math.round(signal(t - Math.PI) / WAVE.step) * WAVE.step;
  return [WAVE.r + q - WAVE.half, WAVE.r + q + WAVE.half];
};
const hackgt: Rows = [
  { seed: 'hackgt-13', biome: 'tide', recipe: 'isles', stops: [0.12, 9, 9] },
  [
    'wave-ring',
    1,
    ['ring', real, 0, Math.PI, 36, 0, 0, 'ink.high'],
    ['ring', fake, Math.PI, TAU, 36, 0, 0, 'coral.base'],
  ],
];

// --- Hackathons at Berkeley ------------------------------------------------------------------------

// The planet IS the hacker bus: a rounded box with windows and wheels. SL, SH and SW are its half
// length, height and width; `front(z, y)` is where its front is at a height and a distance from
// its middle.
export const BUS = { SL: 1.3, SH: 0.74, SW: 0.76 } as const;
const { SL, SH, SW } = BUS;
const front = (z: number, y: number): number => SL * (1 - (z / SW) ** 4 - (y / SH) ** 4) ** 0.25;
const pane = (x: number, side: number): Item => {
  const z = side * (SW * (1 - (x / SL) ** 4 - (0.18 / SH) ** 4) ** 0.25 + 0.008);
  return [
    'quad',
    [x - 0.11, 0.03, z],
    [x + 0.11, 0.03, z],
    [x + 0.11, 0.33, z],
    [x - 0.11, 0.33, z],
    'space.800',
    [0, 0, side],
  ];
};
const SIGN = front(0, 0.56) + 0.02;
const berkeley: Rows = [
  {
    seed: 'hackathons-at-berkeley',
    biome: 'lilac',
    recipe: { flat: 0.5 },
    shape: { p: 4, s: [SL, SH, SW] },
    up: 'vertex',
    paint: [
      ['where', (o) => o.pos[1] > 0.56, 'ink.high'],
      ['where', (o) => Math.abs(o.pos[1] + 0.2) < 0.09 && Math.abs(o.d[2]) > 0.55, 'lilac.shade'],
    ],
  },
  // Windows are props (crisp at any facet size): seven panes a side and a two-part windshield.
  [
    'windows',
    8,
    ...[-1, 1].flatMap((side) => Array.from({ length: 7 }, (_, i) => pane(-0.84 + i * 0.28, side))),
    ...(
      [
        [-0.52, 0],
        [0, 0.52],
      ] as const
    ).map(([z0, z1]): Item => [
      'quad',
      [front(z0, 0.3) - 0.004, -0.02, z0],
      [front(z1, 0.3) - 0.004, -0.02, z1],
      [front(z1, 0.3) - 0.004, 0.42, z1],
      [front(z0, 0.3) - 0.004, 0.42, z0],
      'space.800',
      [1, 0, 0],
    ]),
  ],
  [
    'wheels',
    0,
    [
      'x',
      [
        [0.84, -0.63, 0.62],
        [0.84, -0.63, -0.62],
        [-0.84, -0.63, 0.62],
        [-0.84, -0.63, -0.62],
      ],
      [
        'g',
        ['cyl', 0.26, -0.08, 0.08, 6, 'ink.low'],
        ['cyl', 0.13, 0.08, 0.092, 6, 'ink.high'],
        ['cyl', 0.13, -0.092, -0.08, 6, 'ink.high'],
        { rot: [Math.PI / 2, 0, 0] },
      ],
    ],
  ],
  // The destination sign says 13.0 in cells of 0.034 (2.7 px on a 390 px phone: the legibility
  // floor is 2 px); the headlights are on. Both are real light, so both bloom.
  ['destination-sign', 0, ['box', 0.04, 0.2, 0.62, 'space.900', { at: [SIGN, 0.56, 0] }]],
  [
    'sign-digits',
    4,
    ['pix', '13.0', 0.034, 'star.warm', { at: [SIGN + 0.024, 0.56, 0], rot: [0, Math.PI / 2, 0] }],
  ],
  [
    'headlights',
    0,
    [
      'x',
      [
        [1.25, -0.12, 0.44],
        [1.25, -0.12, -0.44],
      ],
      ['bead', 0.07, 'star.warm', { g: 2 }],
    ],
  ],
];

// --- Cal Hacks 13.0 --------------------------------------------------------------------------------

// The pitch at the pole, mown in six stripes. The stands are a ring wall with four gates; the
// crowd is a two-colour wave (cream and the family's lilac), four sections of three stands so
// that the wave can run round them.
const stand = (i: number): Item => [
  'ring',
  [0.56, 0.84],
  (i / 16) * TAU,
  ((i + 1) / 16) * TAU,
  1,
  0.55,
  1.14,
  i % 4 < 2 ? 'ink.high' : 'lilac.light',
  i % 4 < 2 ? 'lilac.light' : 'lilac.base',
  1,
];
const CAMPANILE_AT: Vec3 = [brg(rad(300), 1.12)[0], 0.16, brg(rad(300), 1.12)[1]];
const calHacks: Rows = [
  {
    seed: 'cal-hacks-13',
    biome: 'bloom',
    recipe: 'calm',
    up: 'vertex',
    paint: [['grid', 1, 6, ['biome.terra.low', 'biome.terra.high'], 0, 0.19]],
  },
  ...[0, 1, 2, 3].map((section): PartRow => [
    `stands-${section + 1}`,
    0,
    ...[1, 2, 3].map((k) => stand(section * 4 + k)),
  ]),
  // The scoreboard on the north side, facing the pitch: it reads 13.0, in cells of 0.04.
  [
    'scoreboard',
    0,
    [
      'g',
      ['cyl', 0.02, 0, 1.15, 4, 'ink.mid', { at: [-0.3, 0, 0] }],
      ['cyl', 0.02, 0, 1.15, 4, 'ink.mid', { at: [0.3, 0, 0] }],
      ['box', 0.78, 0.34, 0.04, 'space.900', { at: [0, 1.32, 0] }],
      { at: [0, 0.16, -0.98] },
    ],
  ],
  ['score-digits', 4, ['pix', '13.0', 0.04, 'star.warm', { at: [0, 1.48, -0.956] }]],
  // The Campanile, Berkeley's own tower, beside the stadium: a needle over a lit lantern.
  [
    'campanile',
    0,
    [
      'g',
      [
        'lathe',
        [
          [0, 0],
          [0, 0.07],
          [1.02, 0.05],
          [1.14, 0.07],
          [1.3, 0.035],
          [1.4, 0],
        ],
        4,
        ['ink.high', 'ink.mid', 'ink.high', 'ink.mid', 'ink.high'],
        Math.PI / 4,
      ],
      ['bead', 0.05, 'star.warm', { at: [0, 1.46, 0], g: 2 }],
      ['cone', 0.022, 0.004, 1.5, 1.72, 4, 'ink.mid'],
      { at: CAMPANILE_AT },
    ],
  ],
];

// --- Corgi (planned) -------------------------------------------------------------------------------

// RunItBack, built in twelve hours and 5th of more than 1,000; the write-up is coming. A long low
// loaf of primer clay with a head and a snout (still clay); its finished-size ring is the
// animal's own outline (twelve dashes, one an hour), and the ears and the stub tail, the parts
// that say "corgi", are plan.
const LOAF = { p: 2, s: [1.05, 0.72, 0.8] } as const;
const loafRing = (b: number): Vec2 => {
  const r = 1 / Math.hypot(Math.sin(b) / 1.5, Math.cos(b) / 1.0);
  return [r - 0.04, r + 0.04];
};
const corgi: Rows = [
  { seed: 'corgi', biome: 'primer', recipe: 'lumpy', shape: LOAF },
  [
    'head',
    0,
    [
      'lathe',
      [
        [-0.34, 0],
        [-0.24, 0.24],
        [0, 0.34],
        [0.24, 0.24],
        [0.34, 0],
      ],
      8,
      'biome.primer.low',
      { at: [1.02, 0.24, 0] },
    ],
    [
      'cone',
      0.17,
      0.09,
      0,
      0.34,
      7,
      'biome.primer.shore',
      { at: [1.2, 0.16, 0], rot: [0, 0, -Math.PI / 2] },
    ],
  ],
  [
    'ears',
    16,
    ...[1, -1].map((side): Item => [
      'fin',
      [
        [-0.12, 0],
        [0.12, 0],
        [0.03, 0.46],
      ],
      0.05,
      'lilac.base',
      { at: [1.0, 0.5, side * 0.2], rot: [side * 0.4, 0, -0.15] },
    ]),
  ],
  [
    'stub-tail',
    16,
    ['cone', 0.11, 0.02, 0, 0.26, 6, 'lilac.base', { at: [-1.04, 0.14, 0], rot: [0, 0, 1.15] }],
  ],
  ...planned('lilac', { n: 12, r: loafRing, crane: [30, 235], chip: [66, 60, 4.45] }),
];

export const HACKATHONS: Readonly<Record<string, BodyRecipe>> = {
  'system/hackathons': { rows: sun },
  'project/hackgt-13': { rows: hackgt },
  'project/hackathons-at-berkeley': { rows: berkeley },
  'project/cal-hacks-13': { rows: calHacks },
  'project/corgi': { rows: corgi },
};
