import { TAU } from '../../sim/math';
import { brg, type Vec2, type Vec3 } from '../../sim/world/kit';
import type { ColorPath } from '../../sim/world/palette';
import { FLAG, type Item, type PartRow } from '../../sim/world/rows';
import { CORE } from './gears';
import { rocket } from './home';
import { ROBOT_AT } from './islands';
import { on } from './isles';
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
  [70, 110, 0.1, 'mint.light'],
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

// Robotics: round the robot on its field drifts a cloud of eight guesses about where it is (Monte
// Carlo localisation), and every twelve seconds the cloud closes in on it.
// prettier-ignore
const GUESSES: readonly Vec2[] = [[0.19, 0.05], [-0.2, 0.12], [0.1, -0.22], [-0.14, -0.18], [0.24, -0.06], [-0.05, 0.25], [0.02, -0.3], [-0.27, -0.02]];
const robotics: PartRow[] = [
  [
    'pose-cloud',
    0,
    [
      'x',
      GUESSES.map(([x, z]): Vec3 => on(ROBOT_AT[0] + x * 0.8, ROBOT_AT[1] + z * 0.8, 0.12)),
      ['box', 0.035, 0.035, 0.035, 'ink.high', { g: 1 }],
    ],
  ],
];

/** A parachute pictogram on a flank: a canopy of three gores, two lines and a payload. */
const chute = (cx: number, cy: number, r: number, z: number): Item => {
  const at = (deg: number): [number, number, number] => [
    cx + r * Math.cos((deg * Math.PI) / 180),
    cy + r * Math.sin((deg * Math.PI) / 180),
    z,
  ];
  const hang = cy - 1.55 * r;
  const line = (dx: number): Item => [
    'quad',
    [cx + dx * r, cy, z],
    [cx + dx * r + 0.008, cy, z],
    [cx + 0.008, hang, z],
    [cx - 0.008, hang, z],
    'ink.low',
    [0, 0, 1],
  ];
  return [
    'g',
    ['poly', [[cx, cy, z], at(0), at(30), at(60)], 'coral.base', [0, 0, 1]],
    ['poly', [[cx, cy, z], at(60), at(90), at(120)], 'coral.light', [0, 0, 1]],
    ['poly', [[cx, cy, z], at(120), at(150), at(180)], 'coral.base', [0, 0, 1]],
    line(-1),
    line(1),
    [
      'quad',
      [cx - 0.022, hang, z],
      [cx + 0.022, hang, z],
      [cx + 0.022, hang - 0.04, z],
      [cx - 0.022, hang - 0.04, z],
      'ink.low',
      [0, 0, 1],
    ],
  ];
};
const modelRocketryNear: PartRow[] = [
  // The launch lug on the back of the payload bay, where the rail would run.
  [
    'launch-lug',
    0,
    [
      'cyl',
      0.026,
      0.37,
      0.52,
      6,
      'ink.low',
      'ink.mid',
      'ink.low',
      { at: [0, 0.2345, 0], rot: [0, 0, -Math.PI / 2] },
    ],
  ],
  // The altimeter's window on the sunlit flank, with its last reading: 3,200 ft.
  [
    'altimeter-window',
    FLAG.flat | FLAG.decal,
    [
      'quad',
      [0.245, -0.1, -0.2215],
      [0.715, -0.1, -0.2215],
      [0.715, 0.1, -0.2215],
      [0.245, 0.1, -0.2215],
      'space.900',
      [0, 0, -1],
    ],
  ],
  [
    'altimeter-digits',
    FLAG.glow | FLAG.decal,
    ['pix', '3200', 0.03, 'star.warm', { at: [0.48, 0, -0.2255], rot: [0, Math.PI, 0] }],
  ],
  // The recovery, on the shade flank: a small canopy for the drogue, a large one for the main.
  ['recovery-badges', FLAG.decal, chute(0.6, 0.04, 0.055, 0.2215), chute(0.4, 0.05, 0.085, 0.2215)],
  // A streamer tied to the dorsal fin's tip, flying behind it.
  [
    'streamer',
    FLAG.flat,
    [
      'g',
      [
        'fin',
        [
          [0, 0.035],
          [-0.28, 0.03],
          [-0.28, -0.03],
          [0, -0.035],
        ],
        0.01,
        'ink.high',
      ],
      [
        'fin',
        [
          [-0.28, 0.03],
          [-0.4, 0.026],
          [-0.4, -0.026],
          [-0.28, -0.03],
        ],
        0.01,
        'coral.base',
      ],
      { at: [-0.795, 0.58, 0] },
    ],
  ],
];

// --- Research ----------------------------------------------------------------------------------------

// Research's sun: twelve ticks make the light curve a clock of one period (the far read and the
// star map show the curve and its cursor only).
const researchSun: PartRow[] = [
  [
    'ticks',
    FLAG.hold | FLAG.flat,
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
    FLAG.hold,
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

// A stud in each of the twelve dark gaps between the gears (the cube's edge midpoints).
const stud: Item = [
  'g',
  ...Array.from({ length: 6 }, (_, i): Item => {
    const at = (k: number): Vec3 => [
      0.06 * Math.sin((k / 6) * TAU),
      0,
      -0.06 * Math.cos((k / 6) * TAU),
    ];
    return ['tri', [0, 0, 0], at(i), at(i + 1), 'coral.light', [0, 1, 0]];
  }),
];
const GAPS: readonly (readonly [lat: number, lon: number])[] = [
  [0, 45],
  [0, 135],
  [0, -45],
  [0, -135],
  [45, 0],
  [45, 90],
  [45, 180],
  [45, -90],
  [-45, 0],
  [-45, 90],
  [-45, 180],
  [-45, -90],
];

/** Every body's close-up parts, by manifest id. */
export const NEAR: Readonly<Record<string, readonly PartRow[]>> = {
  'page/about': about,
  // Hardware's studs stand 0.015 above the frame (0.955 from the centre).
  'system/hardware': [
    [
      'studs',
      FLAG.hold | FLAG.glow,
      ...GAPS.map(([lat, lon]): Item => ['s', lat, lon, { alt: CORE + 0.015 - 1 }, stud]),
    ],
  ],
  'system/research': researchSun,
  'system/hackathons': hackathonsSun,
  'project/robotics': robotics,
  'project/model-rocketry': modelRocketryNear,
};
