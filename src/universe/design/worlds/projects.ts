import type { Vec2 } from '../../sim/world/kit';
import { FLAG, type BodyRecipe, type Item, type Rows } from '../../sim/world/rows';
import { hardware } from './gears';
import { sunGround } from './shared';

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
    ['pix', '11', 0.04, 'coral.base', { at: [-0.07, 0, 0.2215] }],
    ['pix', '11', 0.04, 'coral.base', { at: [-0.07, 0, -0.2215], rot: [0, Math.PI, 0] }],
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
        ['star.warm', 'star.warm', 'biome.dune.low', 'coral.light'],
      ],
      { at: [-0.855, 0, 0], rot: [0, 0, Math.PI / 2] },
    ],
  ],
];

export const PROJECTS: Readonly<Record<string, BodyRecipe>> = {
  'system/hardware': { rows: hardware },
  'system/software': { rows: software },
  'project/model-rocketry': { rows: modelRocketry, still: true, faces: 'prograde' },
};
