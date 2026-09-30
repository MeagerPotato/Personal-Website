import { TAU } from '../../sim/math';
import { add, brg, cross, norm, scale, sub, type Vec2, type Vec3 } from '../../sim/world/kit';
import type { ColorPath } from '../../sim/world/palette';
import { dirOf, shapeNormal, shapePoint } from '../../sim/world/placement';
import type { Item, PartRow } from '../../sim/world/rows';
import type { ThemeKey } from '../tokens';
import { BUS, WAVE } from './hackathons';
import { rocket } from './home';
import { D2M, SCR, SHAPE_FISH, tilted, yTop } from './projects';
import { COIN_TILT } from './research';
import { nth, rad } from './shared';

/**
 * THE CLOSE-UP PARTS: what a body adds when the ship is within reach of it (never on the star map
 * and never far away): the same rows as the far ones (sim/world/rows.ts), keyed by manifest id.
 * This module is the second chunk: the engine loads it with import(), at idle or when the ship
 * first comes near anything, so nothing the first frame needs may live here.
 *
 * DESIGN SURFACE: the rows are free to change; their part names are what the motion table and
 * the tests refer to.
 */

// --- Home --------------------------------------------------------------------------------------------

// About Me: the launch pad with the ship's twin (it lifts off every 40 s), and a few lit houses.
const house = (roof: ColorPath): Item => [
  'g',
  ['box', 0.08, 0.06, 0.08, 'ink.high', { at: [0, 0.03, 0] }],
  ['cone', 0.075, 0, 0.06, 0.115, 4, roof],
];
const HOUSES: readonly (readonly [number, number, number, ColorPath])[] = [
  [66, 10, 0.3, 'butter.base'],
  [62, 60, 1, 'coral.light'],
  [70, 110, 0.1, 'butter.base'],
  [60, 165, 0.7, 'sky.light'],
];
const about: PartRow[] = [
  ['launch-pad', 0, ['s', 80, 30, {}, ['tile', 0.19, 8, 'ink.mid', 0.004, 0.4]]],
  [
    'twin-rocket',
    0,
    ['s', 80, 30, {}, rocket(0.1, 'ink.high', 'coral.base', { at: [0, 0.004, 0], s: 0.3 })],
  ],
  [
    'twin-flame',
    0,
    [
      's',
      80,
      30,
      {},
      ['cone', 0.006, 0.055, 0, 0.14, 6, 'star.warm', { at: [0, -0.136, 0], g: 2 }],
    ],
  ],
  [
    'houses',
    0,
    ...HOUSES.map(([lat, lon, spin, roof]): Item => ['s', lat, lon, { spin }, house(roof)]),
  ],
];

// --- Projects ----------------------------------------------------------------------------------------

// Robotics: the pit. Seven bots on the bench; round the first one drifts a cloud of eight guesses
// about where it is (Monte Carlo localisation), and every twelve seconds the cloud closes in.
const BOT: Item = [
  'g',
  ['box', 0.13, 0.05, 0.17, 'coral.light'],
  ['box', 0.05, 0.035, 0.07, 'sky.light', { at: [0, 0.04, 0.02] }],
];
// prettier-ignore
const GUESSES: readonly Vec2[] = [[0.19, 0.05], [-0.2, 0.12], [0.1, -0.22], [-0.14, -0.18], [0.24, -0.06], [-0.05, 0.25], [0.02, -0.3], [-0.27, -0.02]];
const robotics: PartRow[] = [
  [
    'pit',
    0,
    ...Array.from({ length: 7 }, (_, i): Item => [
      's',
      38,
      -36 + i * 12,
      { spin: 0.3, alt: 0.02 },
      BOT,
    ]),
  ],
  [
    'pose-cloud',
    0,
    [
      's',
      38,
      -36,
      { spin: 0.3, alt: 0.02 },
      ['x', GUESSES.map(([x, z]): Vec3 => [x, 0.07, z]), ['bead', 0.032, 'ink.high']],
    ],
  ],
];

// Canadian Fish: the game table on the flank (the same six-seat table Fish Online will bring to
// the web): two teams of three, and a card in flight between two neighbouring seats, the ask.
const seat = (i: number): Vec2 => [0.26 * Math.cos((i / 6) * TAU), 0.26 * Math.sin((i / 6) * TAU)];
const FISH_AT = shapePoint(norm([0.05, 0.62, 0.78]), SHAPE_FISH);
const FISH_UP = shapeNormal(FISH_AT, SHAPE_FISH);
const onTable = (item: Item): Item => [
  'n',
  add(FISH_AT, scale(FISH_UP, 0.02)),
  FISH_UP,
  0.3,
  1,
  item,
];
const canadianFish: PartRow[] = [
  [
    'game-table',
    0,
    onTable([
      'g',
      ['cyl', 0.17, 0.04, 0.075, 6, 'ink.high', 'ink.high', 'sky.shade'],
      ['cyl', 0.025, 0, 0.04, 5, 'ink.mid'],
      ...Array.from({ length: 6 }, (_, i): Item => [
        'cyl',
        0.04,
        0,
        0.075,
        5,
        i % 2 ? 'sky.light' : 'ink.high',
        { at: [seat(i)[0], 0, seat(i)[1]] },
      ]),
    ]),
  ],
  [
    'ask-card',
    0,
    onTable([
      'g',
      ['box', 0.09, 0.008, 0.06, 'ink.high'],
      ['tile', 0.018, 4, 'coral.base', 0.005, Math.PI / 4],
      { at: [seat(1)[0] - 0.26 * 0.4, 0.14, seat(1)[1]], s: Math.sin(Math.PI * 0.4) },
    ]),
  ],
];

// FishAI: ATHENA in training, a bead running a dashed outer loop; the solver board, 54 cells (nine
// half-suits of six cards) all settled; and a scan bar that sweeps across it: the constraint
// solver propagating to its fixed point.
const BOARD = dirOf(64, 20);
const EAST = norm(cross([0, 1, 0], BOARD));
const SOUTH = cross(EAST, BOARD);
const BAR = norm(add(BOARD, scale(EAST, -0.42)));
const fishai: PartRow[] = [
  [
    'solver-board',
    0,
    ...Array.from({ length: 54 }, (_, k): Item => {
      const col = k % 9;
      const row = Math.floor(k / 9);
      const d = norm(
        add(BOARD, add(scale(EAST, (col - 4) * 0.105), scale(SOUTH, (row - 2.5) * 0.105))),
      );
      return [
        'n',
        scale(d, 1.012),
        d,
        0,
        1,
        ['tile', 0.064, 4, col % 2 ? 'sky.light' : 'ink.high', 0, Math.PI / 4],
      ];
    }),
  ],
  ['scan-bar', 1, ['n', scale(BAR, 1.03), BAR, 0, 1, ['box', 0.012, 0.03, 0.66, 'coral.base']]],
  [
    'athena-loop',
    3,
    [
      'g',
      ...Array.from({ length: 16 }, (_, i): Item => [
        'ring',
        [1.72, 1.77],
        (i / 16) * TAU,
        (i / 16) * TAU + 0.26,
        1,
        0,
        0,
        'sky.light',
      ]),
      ['bead', 0.09, 'ink.high', { at: [brg(rad(120), 1.745)[0], 0, brg(rad(120), 1.745)[1]] }],
      { rot: [rad(14), 0, rad(-6)] },
    ],
  ],
];

// Days2Meet: the press-and-hold cursor, painting the next cell, and the binder rings of a desk
// calendar along the north edge.
const CURSOR_X = D2M.cx + 3 * D2M.dx;
const CURSOR_Z = D2M.cz + 3 * D2M.dz;
const days2meet: PartRow[] = [
  [
    'paint-cursor',
    0,
    [
      'n',
      [CURSOR_X, yTop(CURSOR_X, CURSOR_Z) + 0.05, CURSOR_Z],
      [0, 1, 0],
      0,
      1,
      [
        'g',
        ['ring', [0.07, 0.12], 0, TAU, 10, 0, 0, 'ink.high'],
        ['tile', 0.045, 6, 'ink.high', 0],
      ],
    ],
  ],
  [
    'binder-rings',
    0,
    [
      'x',
      [-0.4, 0.4].map((x): Vec3 => [x, yTop(x, -0.86) * 0.98, -0.86]),
      [
        'ring',
        [0.115, 0.15],
        -Math.PI / 2,
        Math.PI / 2,
        8,
        0,
        0,
        'ink.mid',
        'ink.low',
        2,
        { rot: [Math.PI / 2, 0, 0] },
      ],
    ],
  ],
];

// Model Rocketry. Recovery: the parachute and its payload, hanging off the flank (it does not turn
// with the ground). And Cal Aero SAE, Allen's current aero team: a propeller thrust stand (a jig
// that measures thrust to choose the RC plane's motor: no flame) and an ESP32 telemetry board.
const atAngle = (a: number, r: number, y: number): Vec3 => [r * Math.cos(a), y, r * Math.sin(a)];
const GORES = Array.from({ length: 6 }, (_, i): Item => {
  const a0 = (i / 6) * TAU;
  const a1 = ((i + 1) / 6) * TAU;
  const color: ColorPath = i % 2 ? 'ink.high' : 'coral.base';
  return [
    'g',
    [
      'quad',
      atAngle(a0, 0.34, 0),
      atAngle(a1, 0.34, 0),
      atAngle(a1, 0.24, 0.13),
      atAngle(a0, 0.24, 0.13),
      color,
      [0, 0.4, 0],
    ],
    ['tri', atAngle(a0, 0.24, 0.13), atAngle(a1, 0.24, 0.13), [0, 0.2, 0], color, [0, 1, 0]],
  ];
});
const SHROUDS = Array.from({ length: 6 }, (_, i): Item => {
  const a = (i / 6) * TAU;
  const rim: Vec3 = [0.34 * Math.cos(a), 0, 0.34 * Math.sin(a)];
  const tangent: Vec3 = [-Math.sin(a) * 0.012, 0, Math.cos(a) * 0.012];
  return [
    'quad',
    add(rim, tangent),
    sub(rim, tangent),
    [-0.004, -0.55, 0],
    [0.004, -0.55, 0],
    'ink.mid',
    rim,
  ];
});
const JIG = { spin: 0.6, alt: 0.02 } as const;
const modelRocketry: PartRow[] = [
  [
    'parachute',
    1,
    [
      'g',
      ...GORES,
      ...SHROUDS,
      ['bead', 0.09, 'ink.high', { at: [0, -0.6, 0], s: [1, 1.3, 1] }],
      { at: [brg(rad(62), 1.5)[0], 1.15, brg(rad(62), 1.5)[1]] },
    ],
  ],
  [
    'thrust-stand',
    0,
    [
      's',
      24,
      40,
      JIG,
      [
        'g',
        ['box', 0.3, 0.03, 0.2, 'ink.low'],
        ['box', 0.05, 0.1, 0.05, 'ink.mid', { at: [0, 0.065, 0] }],
        ['box', 0.09, 0.04, 0.05, 'coral.base', { at: [0, 0.135, 0] }],
        ['cyl', 0.04, 0.155, 0.27, 8, 'ink.high', 'ink.mid', 'ink.high'],
        ['cyl', 0.008, 0.27, 0.31, 4, 'ink.mid'],
      ],
    ],
  ],
  [
    'propeller',
    0,
    [
      's',
      24,
      40,
      JIG,
      [
        'g',
        ['cyl', 0.022, 0, 0.03, 6, 'ink.high'],
        ['box', 0.3, 0.012, 0.05, 'ink.high', { at: [0.165, 0.015, 0], rot: [0.25, 0, 0] }],
        ['box', 0.3, 0.012, 0.05, 'ink.high', { at: [-0.165, 0.015, 0], rot: [-0.25, 0, 0] }],
        { at: [0, 0.31, 0] },
      ],
    ],
  ],
  [
    'esp32',
    0,
    [
      's',
      18,
      66,
      { spin: 0.2, alt: 0.02 },
      [
        'g',
        ['box', 0.16, 0.012, 0.1, 'space.600', { at: [0, 0.006, 0] }],
        ['box', 0.055, 0.016, 0.05, 'ink.mid', { at: [0.01, 0.018, 0] }],
        ...[-1, 1].map((s): Item => [
          'box',
          0.14,
          0.01,
          0.008,
          'ink.high',
          { at: [0, 0.013, s * 0.04] },
        ]),
        ...[0, 1, 2].map((i): Item => [
          'box',
          0.02,
          0.008,
          0.008,
          'coral.base',
          { at: [0.1, 0.013, (i - 1) * 0.022] },
        ]),
      ],
    ],
  ],
];

// CyberPatriot: a vulnerability closing. A mint tick appears on the third row, open in the still,
// every twenty seconds, and goes again.
const cyberpatriot: PartRow[] = [
  [
    'fix-tick',
    0,
    tilted(['box', 0.1, 0.1, 0.02, 'mint.base', { at: [-0.34, SCR.cy - 0.07, 0.046] }]),
  ],
];

// Fish Onboarding: your nine cards (the deal is 54 cards between six players), and "scan me": a
// thin coral line sweeping to and fro across the code on the phone.
const fishOnboarding: PartRow[] = [
  [
    'nine-cards',
    0,
    [
      's',
      34,
      40,
      { spin: 0.2, alt: 0.012 },
      [
        'g',
        ...Array.from({ length: 9 }, (_, i): Item => [
          'g',
          ['box', 0.09, 0.004, 0.13, i % 2 ? 'ink.high' : 'sky.light', { at: [0, 0, 0.065] }],
          [
            'tile',
            0.02,
            4,
            i % 3 ? 'coral.base' : 'space.800',
            0.0045,
            Math.PI / 4,
            { at: [0, 0, 0.09] },
          ],
          { rot: [0, (i - 4) * 0.17, 0], at: [0, i * 0.0045, 0] },
        ]),
      ],
    ],
  ],
  ['scan-line', 0, ['box', 0.4, 0.004, 0.012, 'coral.base', { at: [0, 1.062, 0.03] }]],
];

// --- Research ----------------------------------------------------------------------------------------

// Research's sun: twelve ticks make the light curve a clock of one period (the far read and the
// star map show the curve and its cursor only).
const researchSun: PartRow[] = [
  [
    'ticks',
    3,
    [
      'around',
      12,
      0,
      0,
      0,
      1,
      (i) => ['rq', 0, 1.04, i % 3 ? 1.1 : 1.15, 0.035, 0.035, 0, 0.001, 'mint.light'],
    ],
  ],
];

// Sports Analysis: the first analysis, a bar chart with its axes standing on the surface, as plan.
const sportsAnalysis: PartRow[] = [
  [
    'bar-chart',
    16,
    [
      's',
      14,
      -30,
      { spin: 0.1, alt: 0.01 },
      [
        'g',
        ['box', 0.44, 0.012, 0.1, 'ink.mid'],
        ...[0.1, 0.17, 0.13, 0.24, 0.33].map((h, i): Item => [
          'box',
          0.05,
          h,
          0.05,
          'mint.base',
          { at: [(i - 2) * 0.075, 0.012 + h / 2, 0] },
        ]),
      ],
    ],
  ],
];

// Kalshi: a price chart and an order table on the coin's face, as plan.
const onCoinFace = (item: Item, at: Vec3): Item => ['g', ['g', item, { at }], COIN_TILT];
const segment = (p0: Vec2, p1: Vec2): Item => [
  'box',
  Math.hypot(p1[0] - p0[0], p1[1] - p0[1]),
  0.012,
  0.03,
  'mint.base',
  {
    at: [(p0[0] + p1[0]) / 2, 0.006, (p0[1] + p1[1]) / 2],
    rot: [0, Math.atan2(-(p1[1] - p0[1]), p1[0] - p0[0]), 0],
  },
];
const kalshi: PartRow[] = [
  [
    'price-chart',
    17,
    onCoinFace(
      [
        'g',
        ['box', 0.46, 0.012, 0.02, 'mint.base', { at: [0, 0.006, 0.17] }],
        ['box', 0.02, 0.012, 0.34, 'mint.base', { at: [-0.22, 0.006, 0] }],
        segment([-0.2, 0.1], [-0.1, -0.02]),
        segment([-0.1, -0.02], [0, 0.06]),
        segment([0, 0.06], [0.1, -0.12]),
        segment([0.1, -0.12], [0.2, -0.06]),
      ],
      [0.4, 0.128, 0.45],
    ),
  ],
  [
    'order-table',
    17,
    onCoinFace(
      [
        'g',
        ...[0, 1, 2].flatMap((r) =>
          [0, 1].map((c): Item => [
            'box',
            0.13,
            0.012,
            0.06,
            'mint.base',
            { at: [c * 0.16 - 0.08, 0.006, r * 0.08] },
          ]),
        ),
      ],
      [-0.42, 0.128, -0.5],
    ),
  ],
];

// --- Hackathons --------------------------------------------------------------------------------------

// The Hackathons sun: when the hand reaches noon, demo time, a burst of confetti off the crown
// (absent from the still: it exists only while it plays).
const CONFETTI: readonly ColorPath[] = [
  'lilac.light',
  'ink.high',
  'mint.light',
  'sky.light',
  'coral.light',
];
const hackathonsSun: PartRow[] = [
  [
    'confetti',
    1,
    [
      'x',
      Array.from({ length: 10 }, (_, i): Vec3 => {
        const [x, z] = brg(rad(-52 + i * 11.5), 1.5 + ((i * 37) % 5) * 0.03);
        return [x, 0, z];
      }),
      (i) => ['tile', 0.06, 4, nth(CONFETTI, i % 5), 0, i],
    ],
  ],
];

// HackGT 13: four detector dishes round the north pole; sixteen evidence markers on the ground,
// one per forensic expert; a magnifier over the seam where the smooth wave turns to steps; and
// the report, two bars lying on the ground (minDCF .076 and .153, lower is better) with their
// numbers in cells of 0.028 (2.3 px on a 360 px phone).
const DISH: Item = [
  'g',
  ['cyl', 0.03, 0, 0.14, 5, 'ink.mid'],
  ['dome', 0.13, 8, 2, 'lilac.light', { at: [0, 0.16, 0], rot: [0.7, 0, 0], s: [1, 0.6, 1] }],
];
const LENS = brg(Math.PI, WAVE.r);
const hackgt: PartRow[] = [
  [
    'detector-dishes',
    0,
    ...[0, 90, 180, 270].map((deg): Item => [
      's',
      48,
      deg + 45,
      { spin: rad(deg), alt: 0.01 },
      DISH,
    ]),
  ],
  [
    'evidence-markers',
    0,
    ...Array.from({ length: 16 }, (_, i): Item => [
      's',
      34,
      i * 22.5,
      { alt: 0.005 },
      [
        'fin',
        [
          [-0.065, 0],
          [0.065, 0],
          [0, 0.14],
        ],
        0.04,
        'lilac.light',
      ],
    ]),
  ],
  [
    'magnifier',
    1,
    [
      'g',
      ['ring', [0.15, 0.22], 0, TAU, 14, -0.02, 0.035, 'ink.high', 'ink.mid', 1],
      ['box', 0.42, 0.06, 0.09, 'ink.mid', { at: [0.41, 0, 0] }],
      { at: [LENS[0], 0.46, LENS[1]], rot: [0.5, 0, 0] },
    ],
  ],
  [
    'report',
    0,
    [
      's',
      22,
      75,
      { spin: 0.3, alt: 0.01 },
      [
        'g',
        ['box', 0.88, 0.014, 0.5, 'space.800'],
        ['box', 0.1, 0.076, 0.1, 'mint.base', { at: [-0.21, 0.045, 0.12] }],
        ['box', 0.1, 0.153, 0.1, 'coral.base', { at: [0.21, 0.083, 0.12] }],
        ['pix', '.076', 0.028, 'ink.high', { at: [-0.21, 0.008, -0.1], rot: [-Math.PI / 2, 0, 0] }],
        ['pix', '.153', 0.028, 'ink.high', { at: [0.21, 0.008, -0.1], rot: [-Math.PI / 2, 0, 0] }],
      ],
    ],
  ],
];

// Hackathons at Berkeley: the roof rack, merch crates and the catering.
const rackRod = (p0: Vec2, p1: Vec2, y: number): Item => [
  'box',
  Math.hypot(p1[0] - p0[0], p1[1] - p0[1]),
  0.03,
  0.03,
  'ink.mid',
  {
    at: [(p0[0] + p1[0]) / 2, y, (p0[1] + p1[1]) / 2],
    rot: [0, Math.atan2(-(p1[1] - p0[1]), p1[0] - p0[0]), 0],
  },
];
const crate = (family: ThemeKey, at: Vec3, spin: number, s = 1): Item => [
  'g',
  ['box', 0.34, 0.24, 0.3, `${family}.light`],
  ['box', 0.06, 0.246, 0.306, 'ink.high'],
  { at, rot: [0, spin, 0], ...(s === 1 ? {} : { s }) },
];
const PIZZA: Item = [
  'g',
  ['box', 0.34, 0.05, 0.34, 'ink.high'],
  ['tile', 0.12, 8, 'biome.dune.high', 0.026],
];
const ROOF = BUS.SH - 0.03;
const berkeley: PartRow[] = [
  [
    'roof-rack',
    0,
    rackRod([-0.85, -0.28], [0.78, -0.28], ROOF + 0.02),
    rackRod([-0.85, 0.28], [0.78, 0.28], ROOF + 0.02),
    crate('coral', [-0.68, ROOF + 0.12, 0.02], 0.08),
    ...[0, 1, 2].map((k): Item => [
      'g',
      PIZZA,
      { at: [-0.26, ROOF + 0.025 + k * 0.052, -0.02], rot: [0, 0.1 * k, 0] },
    ]),
    crate('lilac', [0.16, ROOF + 0.12, -0.03], -0.06),
    crate('coral', [0.56, ROOF + 0.12, 0.03], 0.05),
    crate('sky', [0.56, ROOF + 0.36, 0.03], -0.15, 0.85),
  ],
];

// Cal Hacks 13.0: four floodlight masts round the stadium, their lamps unlit and bright.
const calHacks: PartRow[] = [
  [
    'floodlights',
    0,
    [
      'around',
      4,
      rad(45),
      0.99,
      0.2,
      1,
      [
        'g',
        ['cyl', 0.022, 0, 1.3, 4, 'ink.mid'],
        ['box', 0.24, 0.15, 0.05, 'star.warm', { at: [0, 1.34, 0.02], rot: [0.35, 0, 0], g: 2 }],
      ],
    ],
  ],
];

// Corgi: RunItBack, one photo becoming a room (as plan), and the 5th-place block with its numeral.
const corgi: PartRow[] = [
  [
    'photo',
    16,
    [
      's',
      16,
      -52,
      { spin: 0.3, alt: 0.16 },
      ['box', 0.28, 0.21, 0.02, 'lilac.base', { rot: [-0.2, 0, 0] }],
    ],
  ],
  [
    'room',
    16,
    [
      's',
      12,
      -8,
      { spin: 0.2, alt: 0.01 },
      [
        'g',
        ['box', 0.26, 0.015, 0.26, 'lilac.base', { at: [0, 0.008, 0] }],
        ['box', 0.26, 0.2, 0.015, 'lilac.base', { at: [0, 0.115, -0.12] }],
        ['box', 0.015, 0.2, 0.26, 'lilac.base', { at: [-0.12, 0.115, 0] }],
      ],
    ],
  ],
  [
    'fifth-block',
    16,
    [
      's',
      6,
      30,
      { spin: 0.1, alt: 0.01 },
      ['box', 0.34, 0.22, 0.16, 'lilac.base', { at: [0, 0.11, 0] }],
    ],
  ],
  [
    'fifth-numeral',
    0,
    [
      's',
      6,
      30,
      { spin: 0.1, alt: 0.01 },
      ['pix', '5', 0.04, 'ink.high', { at: [0, 0.11, 0.083] }],
    ],
  ],
];

/** Every body's close-up parts, by manifest id. */
export const NEAR: Readonly<Record<string, readonly PartRow[]>> = {
  'page/about': about,
  'system/research': researchSun,
  'system/hackathons': hackathonsSun,
  'project/robotics': robotics,
  'project/canadian-fish-demo': canadianFish,
  'project/fishai': fishai,
  'project/days2meet': days2meet,
  'project/hackgt-13': hackgt,
  'project/hackathons-at-berkeley': berkeley,
  'project/cal-hacks-13': calHacks,
  'project/model-rocketry': modelRocketry,
  'project/sports-analysis': sportsAnalysis,
  'project/kalshi': kalshi,
  'project/corgi': corgi,
  'project/fish-onboarding': fishOnboarding,
  'project/cyberpatriot': cyberpatriot,
};
