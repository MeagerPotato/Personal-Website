import { TAU } from '../../sim/math';
import type { PlanetShape } from '../../sim/planet';
import { add, norm, scale, type Vec2 } from '../../sim/world/kit';
import { colorOf } from '../../sim/world/palette';
import { shapeNormal, shapePoint, spinToward } from '../../sim/world/placement';
import { planned } from '../../sim/world/planned';
import { FLAG, type BodyRecipe, type Item, type Rows } from '../../sim/world/rows';
import { hardware } from './gears';
import { cutRect, rad, sunGround } from './shared';

/**
 * PROJECTS, the binary star: the Hardware sun (coral) with Model Rocketry and Robotics, and the
 * Software sun (sky) with CyberPatriot, Canadian Fish and its moons (FishAI, Fish Onboarding, and
 * Fish Online, planned) and Days2Meet. Rows (sim/world/rows.ts), keyed by manifest id; the
 * close-up parts are in near.ts, the motions in motion.ts.
 *
 * DESIGN SURFACE: the rows are free to change; their part names are what the motion table and
 * the tests refer to.
 */

// --- the suns ------------------------------------------------------------------------------------

/** One arm of a chevron, a flat slab from one point to another. */
const bracketArm = (x0: number, z0: number, x1: number, z1: number): Item => {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const l = Math.hypot(dx, dz);
  const nx = (-dz / l) * 0.09;
  const nz = (dx / l) * 0.09;
  return [
    'prism',
    [
      [x0 + nx, z0 + nz],
      [x1 + nx, z1 + nz],
      [x1 - nx, z1 - nz],
      [x0 - nx, z0 - nz],
    ],
    -0.07,
    0.07,
    'sky.light',
    'sky.base',
    'sky.base',
    1,
  ];
};

const software: Rows = [
  sunGround('sky'),
  // `<` and `>`: two chevrons of two arms each, flanking the sun; a caret glows after the `>`.
  [
    'brackets',
    FLAG.hold | FLAG.flat,
    ...[-1, 1].flatMap((s) => [
      bracketArm(s * 1.46, 0, s * 1.08, -0.55),
      bracketArm(s * 1.46, 0, s * 1.08, 0.55),
    ]),
  ],
  ['caret', FLAG.hold | FLAG.flat, ['box', 0.14, 0.14, 0.5, 'ink.high', { at: [1.6, 0, 0] }]],
];

// --- Hardware ------------------------------------------------------------------------------------

const robotics: Rows = [
  {
    seed: 'robotics',
    biome: 'coral',
    recipe: 'flat',
    paint: [
      ['band', 0, 0.2, 'ink.high'],
      ['band', 0.36, 0.4, 'coral.shade'],
      ['band', 0.2, 0.235, 'coral.light'],
    ],
  },
  // Four wheels: the planet is a rover, and from above that is all you need to see.
  [
    'wheels',
    0,
    ...(
      [
        [
          1,
          [
            [0.94, -0.04, 0.6],
            [0.94, -0.04, -0.6],
          ],
        ],
        [
          -1,
          [
            [-0.94, -0.04, 0.6],
            [-0.94, -0.04, -0.6],
          ],
        ],
      ] as const
    ).map(([sx, ats]): Item => [
      'x',
      ats,
      [
        'g',
        ['cyl', 0.29, -0.13, 0.13, 8, 'ink.mid', 'ink.low', 'ink.mid'],
        ['cyl', 0.14, 0.13, 0.145, 8, 'coral.light'],
        { rot: [0, 0, -sx * (Math.PI / 2)] },
      ],
    ]),
  ],
  // The High Stakes stake at the pole with three rings on it (red and blue, the two alliances).
  [
    'stake-rings',
    0,
    ['cyl', 0.035, 0.94, 1.5, 5, 'ink.mid'],
    ...(
      [
        [1.0, 'coral'],
        [1.075, 'sky'],
        [1.15, 'coral'],
      ] as const
    ).map(([y, family]): Item => [
      'ring',
      [0.085, 0.175],
      0,
      TAU,
      6,
      y,
      y + 0.065,
      `${family}.light`,
      `${family}.base`,
      1,
    ]),
  ],
];

/**
 * Model Rocketry: the planet IS a model rocket, flying its orbit nose first with its flame behind
 * (the recipe says `faces: 'prograde'`, `still: true`). The ground is a hull, not a ball: the
 * airframe, a twelve-sided lathe built upright and laid down so that its nose points along +X,
 * from the motor's bore to the tip of the nose, each band the colour at the same place in the list.
 */
const ROCKET: readonly Vec2[] = [
  [-0.855, 0], // the bore: the dark disc at the nozzle's exit
  [-0.855, 0.12], // the motor casing's rim...
  [-0.795, 0.12], // ...and its wall
  [-0.795, 0.22], // the tail plate, facing back
  [-0.37, 0.22], // the fin can
  [-0.35, 0.22], // a seam
  [0.21, 0.22], // the tube
  [0.73, 0.22], // the payload bay
  [0.75, 0.22], // the shoulder of the nose
  [0.879, 0.212], // the nose: a tangent ogive, 1.5 calibres long
  [1.021, 0.185],
  [1.176, 0.13],
  [1.305, 0.063],
  [1.395, 0],
];
const modelRocketry: Rows = [
  [
    [
      'lathe',
      ROCKET,
      12,
      [
        'space.800',
        'ink.low',
        'ink.mid',
        'coral.base',
        'coral.shade',
        'ink.high',
        'ink.mid',
        'coral.shade',
        'coral.base',
        'coral.base',
        'coral.base',
        'coral.base',
        'coral.base',
      ],
      Math.PI / 12,
      { rot: [0, 0, -Math.PI / 2] },
    ],
  ],
  // Four swept fins in a plus, on the fin can.
  [
    'fins',
    0,
    [
      'g',
      [
        'around',
        4,
        0,
        0,
        0,
        1,
        [
          'fin',
          [
            [0.2, -0.35],
            [0.58, -0.6],
            [0.58, -0.795],
            [0.2, -0.795],
          ],
          0.04,
          'coral.base',
        ],
      ],
      { rot: [0, 0, -Math.PI / 2] },
    ],
  ],
  // The roll number: eleven design iterations, painted on both flanks like a real airframe.
  [
    'roll-number',
    FLAG.decal,
    ['pix', '11', 0.04, 'coral.base', { at: [-0.07, 0, 0.2165] }],
    ['pix', '11', 0.04, 'coral.base', { at: [-0.07, 0, -0.2165], rot: [0, Math.PI, 0] }],
  ],
  // The motor's flame, a candy-corn cone that starts inside the casing: it glows (and blooms).
  [
    'flame',
    FLAG.glow,
    [
      'g',
      [
        'lathe',
        [
          [-0.04, 0.1],
          [0.05, 0.155],
          [0.2, 0.11],
          [0.34, 0.06],
          [0.5, 0],
        ],
        8,
        ['star.warm', 'biome.dune.low', 'coral.base', 'coral.base'],
      ],
      { at: [-0.855, 0, 0], rot: [0, 0, Math.PI / 2] },
    ],
  ],
];

// --- Software ------------------------------------------------------------------------------------

/**
 * CyberPatriot: a monitor on the pole showing the list of vulnerabilities, two closed (mint) and
 * two open (coral), and the clock as a bar that is part spent. The screen and what is written on
 * it are separate parts so that the art can layer them.
 */
export const SCR = { w: 0.9, h: 0.62, cy: 0.54 } as const;
export const tilted = (...items: Item[]): Item => [
  'g',
  ['g', ...items, { rot: [-0.3, 0, 0] }],
  { at: [0, 0.98, 0] },
];
const cyberpatriot: Rows = [
  { seed: 'cyberpatriot', biome: 'sky', recipe: { flat: -1 }, up: 'vertex' },
  [
    'monitor-stand',
    0,
    ['cyl', 0.22, 0, 0.03, 8, 'ink.low', { at: [0, 0.98, 0] }],
    ['cyl', 0.05, 0.03, 0.2, 6, 'ink.mid', { at: [0, 0.98, 0] }],
  ],
  [
    'monitor-frame',
    0,
    tilted(
      ['box', SCR.w + 0.1, 0.05, 0.05, 'space.900', { at: [0, SCR.cy + SCR.h / 2 + 0.025, 0] }],
      ['box', SCR.w + 0.1, 0.05, 0.05, 'space.900', { at: [0, SCR.cy - SCR.h / 2 - 0.025, 0] }],
      ['box', 0.05, SCR.h, 0.05, 'space.900', { at: [-SCR.w / 2 - 0.025, SCR.cy, 0] }],
      ['box', 0.05, SCR.h, 0.05, 'space.900', { at: [SCR.w / 2 + 0.025, SCR.cy, 0] }],
    ),
  ],
  [
    'monitor-screen',
    0,
    tilted(['box', SCR.w, SCR.h, 0.04, 'space.700', { at: [0, SCR.cy, -0.005] }]),
  ],
  [
    'screen-rows',
    0,
    tilted(
      ['box', SCR.w, 0.07, 0.02, 'ink.mid', { at: [0, SCR.cy + 0.27, 0.03] }],
      ...(['coral.base', 'sky.light', 'mint.base'] as const).map((color, i): Item => [
        'bead',
        0.028,
        color,
        { at: [-0.36 + i * 0.08, SCR.cy + 0.27, 0.045] },
      ]),
      ...[0.13, 0.03, -0.07, -0.17].flatMap((y, i): Item[] => [
        [
          'box',
          0.08,
          0.08,
          0.02,
          i < 2 ? 'mint.base' : 'coral.base',
          { at: [-0.34, SCR.cy + y, 0.03] },
        ],
        [
          'box',
          0.5 - (i % 2) * 0.12,
          0.04,
          0.02,
          'ink.mid',
          { at: [-0.04 - (i % 2) * 0.06, SCR.cy + y, 0.03] },
        ],
      ]),
      // The clock's track, and the spent part over it: a little taller, and from just past the
      // track's end, so that no face of one lies in a face of the other.
      ['box', 0.76, 0.045, 0.02, 'space.900', { at: [0, SCR.cy - 0.26, 0.03] }],
      ['box', 0.47, 0.051, 0.024, 'ink.high', { at: [-0.155, SCR.cy - 0.26, 0.032] }],
    ),
  ],
];

/** Canadian Fish: the planet is the fish, a flattened egg. */
export const SHAPE_FISH: PlanetShape = { p: 2, s: [1.1, 0.84, 0.92] };
const STRIPE = [colorOf('sky.base'), colorOf('sky.shade')] as const;
// A card is 0.46 long: a fan of them reaches 1.38 radii from the centre (the lane rule).
const CARD: readonly Vec2[] = [
  [0, -0.12],
  [0.04, -0.15],
  [0.42, -0.15],
  [0.46, -0.11],
  [0.46, 0.11],
  [0.42, 0.15],
  [0.04, 0.15],
  [0, 0.12],
];
const FAN = [-60, -36, -12, 12, 36, 60];
/** Each card lies on the one before it (a card is 0.035 thick), so its edge shows as a step. */
const cardY = (i: number): number => 0.04 * i;
const eye = (side: number): Item => {
  const p = shapePoint(norm([-0.78, 0.44, side * 0.5]), SHAPE_FISH);
  return [
    'n',
    p,
    shapeNormal(p, SHAPE_FISH),
    0,
    1,
    ['g', ['cyl', 0.115, 0, 0.035, 6, 'ink.high'], ['tile', 0.06, 6, 'space.900', 0.04]],
  ];
};
const canadianFish: Rows = [
  // Eight stripes, the eight half-suits of the demo's 48-card game, and a pale belly.
  {
    seed: 'canadian-fish',
    biome: 'sky',
    recipe: 'flat',
    shape: SHAPE_FISH,
    paint: [
      [
        'where',
        (o) =>
          o.pos[1] > -0.2 &&
          STRIPE[Math.floor(Math.min(0.999, Math.max(0, (o.pos[0] / 1.1) * 0.5 + 0.5)) * 8) % 2],
      ],
      ['where', (o) => o.pos[1] <= -0.2, 'ink.high'],
    ],
  },
  // The tail is a fan of six cards: one half-suit, ready to be declared. Each card's pip is on it,
  // so that the two flutter as one (motion.ts), and on the strip of it the next card leaves bare:
  // its own -Z side, away from the next card, which lies 24 degrees further round.
  [
    'card-fan',
    0,
    [
      'g',
      ...FAN.map((deg, i): Item => [
        'g',
        ['prism', CARD, cardY(i), cardY(i) + 0.035, 'ink.high', 'ink.mid', 'ink.mid', 1],
        [
          'tile',
          0.065,
          6,
          i % 2 ? 'space.800' : 'coral.base',
          cardY(i) + 0.037,
          { at: [0.38, 0, -0.073] },
        ],
        { rot: [0, -rad(deg), 0] },
      ]),
      { at: [0.9, 0.05, 0], rot: [rad(30), 0, 0] },
    ],
  ],
  // A dorsal fin and two eyes (on top, like a flounder's, so that they show from above). The fin's
  // foot is a chord under the curve of the back, so neither of its ends stands off it.
  [
    'dorsal-fin',
    0,
    [
      'fin',
      [
        [-0.5, 0],
        [0.6, 0],
        [0.3, 0.51],
        [-0.15, 0.41],
      ],
      0.06,
      'sky.shade',
      { at: [0, 0.69, 0] },
    ],
  ],
  ['eyes', 0, eye(1), eye(-1)],
];

const fishai: Rows = [
  { seed: 'fishai', biome: 'sky', recipe: { flat: -1 } },
  // The win-rate ring: 58.38% of it is lit. A tick every 30 degrees (twelve papers); a coral
  // tick at 50%, the line to beat.
  [
    'win-ring',
    FLAG.hold | FLAG.flat,
    [
      'g',
      ['ring', [1.3, 1.46], 0, TAU * 0.5838, 20, -0.03, 0.03, 'ink.high', 'sky.light', 1],
      ['ring', [1.3, 1.46], TAU * 0.5838, TAU, 14, -0.03, 0.03, 'sky.shade', 'space.700', 1],
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
          1.5,
          i === 6 ? 1.72 : 1.6,
          i === 6 ? 0.05 : 0.032,
          i === 6 ? 0.05 : 0.032,
          0,
          0.001,
          i === 6 ? 'coral.base' : 'ink.mid',
        ],
      ],
      // The needle lies over the ticks (one of them is at 210 degrees, under it), not among them.
      ['rq', TAU * 0.5838, 1.18, 1.76, 0.075, 0, 0.002, 0.004, 'star.white'],
      { rot: [rad(14), 0, rad(-6)] },
    ],
  ],
];

/** Fish Onboarding: eight steps to the phone at the pole, two of them checkpoints (raised, coral). */
// prettier-ignore
const QR = ['###.#.###', '#.#...#.#', '###.#.###', '.........', '#.#.#.#.#', '.........', '###.#.#..', '#.#...###', '###.#.#.#'];
const fishOnboarding: Rows = [
  { seed: 'fish-onboarding', biome: 'sky', recipe: { flat: 0.7 }, up: 'vertex' },
  [
    'phone',
    0,
    ['prism', cutRect(0.27, 0.44, 0.07), 1.0, 1.05, 'space.900', 'ink.mid', 'ink.mid', 1],
  ],
  ['phone-screen', 0, ['prism', cutRect(0.23, 0.39, 0.05), 1.052, 1.052, 'ink.high']],
  [
    'qr-code',
    0,
    ['pix', QR, 0.04, 'space.800', { at: [0, 1.056, 0.03], rot: [-Math.PI / 2, 0, 0] }],
  ],
  [
    'steps',
    0,
    ...Array.from({ length: 8 }, (_, i): Item => [
      's',
      4 + i * 6.4,
      -80 + i * 17.5,
      { alt: 0.05 },
      i === 3 || i === 6
        ? ['bead', 0.11, 'coral.base']
        : ['bead', 0.085, i === 7 ? 'ink.high' : 'sky.shade', i === 7 ? { g: 1 } : {}],
    ]),
  ],
];

/** Days2Meet: the planet is a rounded cube with a month on its top face. */
export const D2M = { cx: -0.72, dx: 0.24, cz: -0.56, dz: 0.28 } as const;
export const yTop = (x: number, z: number): number =>
  (0.9 ** 4 - 0.9 ** 4 * (x ** 4 + z ** 4)) ** 0.25;
// prettier-ignore
const HEAT = [[1, 1, 2, 1, 0, 1, 1], [2, 2, 3, 2, 1, 2, 2], [1, 2, 3, 3, 2, 2, 1], [2, 3, 3, 2, 1, 3, 3], [1, 2, 2, 1, 1, 4, 4]];
const RAMP = ['space.600', 'sky.shade', 'sky.base', 'mint.base', 'mint.light'] as const;
const SHAPE_D2M: PlanetShape = { p: 4, s: [1, 0.9, 1] };
const DAY: readonly Vec2[] = [
  [-0.104, -0.122],
  [0.104, -0.122],
  [0.104, 0.122],
  [-0.104, 0.122],
];
const days2meet: Rows = [
  { seed: 'days2meet', biome: 'sky', recipe: { flat: 0.6 }, shape: SHAPE_D2M, up: 'vertex' },
  // The month on the top face: seven columns (Monday first), five weeks. Colour is how many
  // people are free; the last weekend is the best window, and it stands proud. Every cell lies
  // square to the grid, its own +X along the week (spinToward), whatever its frame would do.
  [
    'month-grid',
    FLAG.decal,
    ...HEAT.flatMap((row, r) =>
      row.map((v, k): Item => {
        const x = D2M.cx + k * D2M.dx;
        const z = D2M.cz + r * D2M.dz;
        const y = yTop(x, z);
        const normal = shapeNormal([x, y, z], SHAPE_D2M);
        return [
          'n',
          [x, y + 0.004, z],
          normal,
          spinToward(normal, [1, 0, 0]),
          1,
          v === 4
            ? ['prism', DAY, 0, 0.08, 'ink.high', 'mint.base', 'mint.base', 1]
            : ['prism', DAY, 0, 0, RAMP[v] ?? 'space.600'],
        ];
      }),
    ),
  ],
];

/**
 * Fish Online (planned): the step after the Canadian Fish demo, a website for playing it. The
 * six-seat table and a hand of cards are drawn as plan; nothing is built.
 */
const TABLE_AT = norm([0.2, 0.92, 0.3]);
const fishOnline: Rows = [
  { seed: 'fish-play', biome: 'primer', recipe: 'lumpy', up: 'vertex' },
  [
    'table',
    FLAG.ghost,
    [
      'n',
      scale(TABLE_AT, 1.04),
      TABLE_AT,
      0.4,
      1,
      [
        'g',
        ['cyl', 0.36, 0.06, 0.12, 8, 'ink.high', 'ink.mid', 'ink.high'],
        ['cyl', 0.06, 0, 0.06, 5, 'ink.mid'],
        [
          'around',
          6,
          0,
          0.62,
          0,
          0,
          (i) => ['cyl', 0.075, 0, 0.13, 6, i % 2 ? 'sky.shade' : 'sky.light'],
        ],
      ],
    ],
  ],
  [
    'card-hand',
    FLAG.ghost,
    [
      'g',
      ...[-50, -30, -10, 10, 30, 50].map((deg): Item => [
        'fin',
        [
          [0, 0],
          [0.34, 0],
          [0.34, 0.5],
          [0, 0.5],
        ],
        0.02,
        'sky.light',
        { rot: [0, 0, -rad(deg)] },
      ]),
      { at: add(scale(TABLE_AT, 1.04), [0, 0.5, 0]), rot: [0, -rad(30), 0], s: 0.8 },
    ],
  ],
  ...planned('sky', { n: 6, r: [1.4, 1.48], crane: [24, 200], chip: [58, -100, 1.55], debris: 5 }),
];

export const PROJECTS: Readonly<Record<string, BodyRecipe>> = {
  'system/hardware': { rows: hardware },
  'system/software': { rows: software },
  'project/model-rocketry': { rows: modelRocketry, still: true, faces: 'prograde' },
  'project/robotics': { rows: robotics },
  'project/cyberpatriot': { rows: cyberpatriot },
  'project/canadian-fish-demo': { rows: canadianFish },
  'project/fishai': { rows: fishai },
  'project/fish-onboarding': { rows: fishOnboarding },
  'project/days2meet': { rows: days2meet },
  'project/fish-online': { rows: fishOnline, ghost: 'sky' },
};
