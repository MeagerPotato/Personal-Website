import { TAU } from '../../sim/math';
import { brg, type Vec2, type Vec3 } from '../../sim/world/kit';
import type { ColorPath } from '../../sim/world/palette';
import { FLAG, type BodyRecipe, type Item, type Mod, type Rows } from '../../sim/world/rows';
import type { ThemeKey } from '../tokens';
import { WINDOW, beacon, cutRect, nth, rad } from './shared';

/**
 * HOME: About Me (the home planet), the Resume station, the Contact satellite and the relays of
 * Allen's profiles elsewhere, as rows (sim/world/rows.ts). Keyed by manifest id. Their close-up
 * parts are in near.ts, their motions in motion.ts.
 *
 * DESIGN SURFACE: the rows are free to change; their part names are what the motion table and
 * the tests refer to.
 */

/** A layout bearing (degrees from +X toward +Z, as data/layout.ts states it) on the route ring. */
const onLine = (deg: number, r: number, y: number): Vec3 => {
  const [x, z] = brg(rad(deg + 90), r);
  return [x, y, z];
};

/** A tiny rocket, 1 u tall, +Y up: the ship's twin, on the home pad (and a resume pod's icon). */
export const rocket = (
  r = 0.1,
  body: ColorPath = 'ink.high',
  accent: ColorPath = 'coral.base',
  mod: Mod = {},
): Item => [
  'g',
  ['cyl', r, 0.05, 0.62, 6, body],
  ['cone', r, 0, 0.62, 1, 6, accent],
  ['cone', r * 0.7, r * 0.9, 0, 0.06, 6, 'ink.low'],
  [
    'around',
    3,
    0,
    0,
    0,
    1,
    [
      'fin',
      [
        [r, 0.32],
        [r * 2.7, 0.06],
        [r * 2.7, -0.02],
        [r, 0.06],
      ],
      0.028,
      accent,
    ],
  ],
  mod,
];

// --- About Me ------------------------------------------------------------------------------------

/**
 * The Circle Line, an equatorial route round home. Its stops wear the glyph of the system they
 * point at, at the honeycomb's true bearings: Hardware's square and Software's diamond either
 * side of slot 1 (135 degrees), Research at 255, Hackathons at 15. The hollow ring at 75 marks the
 * free slot 5. (The concept set also has the Blog's bookmark at 195, slot 4: it waits for the
 * Blog. Stage 2 will read the stops from the manifest's systems and free slots instead.)
 */
const STOPS: readonly (readonly [ThemeKey, number])[] = [
  ['coral', 144],
  ['sky', 126],
  ['mint', 255],
  ['lilac', 15],
];

const about = ({ map }: { readonly map: boolean }): Rows => [
  {
    seed: 'about-me',
    biome: 'terra',
    recipe: 'continents',
    paint: [['band', 0, 0.07, 'biome.terra.shore']],
  },
  [
    'circle-line',
    FLAG.hold,
    map
      ? ['ring', [1.27, 1.43], 0, TAU, 12, 0, 0, ['butter.light', 'ink.mid']]
      : [
          'g',
          ['ring', [1.27, 1.32], 0, TAU, 30, 0, 0, 'ink.mid'],
          ['ring', [1.32, 1.38], 0, TAU, 30, 0, 0, ['butter.light', 'ink.mid']],
          ['ring', [1.38, 1.43], 0, TAU, 30, 0, 0, 'ink.mid'],
        ],
  ],
  [
    'stops',
    FLAG.hold,
    [
      'x',
      STOPS.map(([, deg]) => onLine(deg, 1.35, 0.004)),
      (j) => ['glyph', nth(STOPS, j)[0], map ? 0.24 : 0.19, 0, 0.05],
    ],
    [
      'ring',
      map ? [0.11, 0.22] : [0.1, 0.17],
      0,
      TAU,
      10,
      0,
      0,
      'ink.low',
      { at: onLine(75, 1.35, 0.004) },
    ],
  ],
  // Parked at layout bearing 340, clear of every stop (Hackathons' is the nearest, 35 degrees on).
  ['train', FLAG.hold, ['bead', 0.075, 'ink.high', { at: onLine(340, 1.35, 0.06) }]],
];

// --- Resume ----------------------------------------------------------------------------------------

// The wheel station: rim, hub, spokes and mast are its hull; five pods wear a pictogram each
// (education, experience, leadership, skills, awards), in the page's own order; two pages on
// the mast are the two-page PDF.
const flag = (color: ColorPath): Item => [
  'g',
  ['tri', [0, 0.3, 0], [0.15, 0.255, 0], [0, 0.21, 0], color, [0, 0, 1]],
  ['tri', [0, 0.3, 0], [0.15, 0.255, 0], [0, 0.21, 0], color, [0, 0, -1]],
];
const ICONS: readonly Item[] = [
  ['dome', 0.12, 6, 2, 'ink.high'],
  rocket(0.1, 'ink.high', 'coral.base', { s: 0.34 }),
  ['g', ['cyl', 0.008, 0, 0.3, 4, 'ink.mid'], flag('coral.base')],
  [
    'g',
    ['box', 0.22, 0.012, 0.15, 'ink.mid', { at: [0, 0.006, 0] }],
    ['box', 0.22, 0.15, 0.012, 'sky.light', { at: [0, 0.085, -0.07], rot: [-0.3, 0, 0] }],
  ],
  [
    'g',
    ['bead', 0.07, 'butter.base', { at: [0, 0.13, 0] }],
    ['tri', [0, 0.07, 0], [0.05, -0.02, 0.01], [-0.02, -0.02, 0.01], 'coral.base', [0, 0, 1]],
    ['tri', [0, 0.07, 0], [-0.05, -0.02, 0.01], [0.02, -0.02, 0.01], 'coral.base', [0, 0, 1]],
  ],
];
const page = (color: ColorPath): Item => [
  'g',
  ['box', 0.44, 0.58, 0.03, color],
  [
    'x',
    [0.16, 0.06, -0.04, -0.14].map((y): Vec3 => [-0.03, y, 0.02]),
    (j) => ['box', j === 3 ? 0.18 : 0.3, 0.025, 0.006, 'ink.low'],
  ],
];

const resume: Rows = [
  [
    [
      'lathe',
      [
        [-0.1, 0.76],
        [-0.1, 1],
        [0.1, 1],
        [0.1, 0.76],
        [-0.1, 0.76],
      ],
      12,
      ['ink.high', 'butter.base', 'ink.high', 'ink.mid'],
    ],
    [
      'lathe',
      [
        [-0.28, 0],
        [-0.28, 0.2],
        [0.28, 0.2],
        [0.28, 0],
      ],
      8,
      ['ink.low', 'ink.high', 'coral.base'],
    ],
    [
      'x',
      [
        [0.48, 0, 0],
        [-0.48, 0, 0],
      ],
      ['box', 0.58, 0.07, 0.07, 'ink.low'],
    ],
    [
      'x',
      [
        [0, 0, 0.48],
        [0, 0, -0.48],
      ],
      ['box', 0.07, 0.07, 0.58, 'ink.low'],
    ],
    ['box', 0.04, 0.44, 0.04, 'ink.low', { at: [0, 0.5, 0] }],
  ],
  [
    'stop-pods',
    0,
    [
      'around',
      5,
      0.3,
      1,
      0.02,
      1,
      (i) => [
        'g',
        ['box', 0.22, 0.2, 0.22, 'butter.light'],
        // One lit pane on its outer wall (a pod looks out along its own -Z).
        ['box', 0.13, 0.09, 0.01, WINDOW, { at: [0, 0.01, -0.111], g: 1 }],
        ['g', nth(ICONS, i), { at: [0, 0.1, 0] }],
      ],
    ],
  ],
  // A beacon on the mast, under the two pages it holds up.
  ['beacon', 0, beacon([0, 0.74, 0])],
  [
    'two-pages',
    FLAG.hold,
    ['g', page('ink.high'), { at: [-0.14, 1.05, 0.02], rot: [0, 0.32, 0] }],
    ['g', page('ink.mid'), { at: [0.14, 1.02, -0.02], rot: [0, -0.32, 0] }],
  ],
];

// --- Contact -----------------------------------------------------------------------------------------

const contact: Rows = [
  [['box', 0.98, 0.16, 0.66, 'ink.high']],
  [
    'envelope-flap',
    0,
    [
      'poly',
      [
        [-0.49, 0.083, -0.33],
        [0.49, 0.083, -0.33],
        [0, 0.083, 0.06],
      ],
      'ink.mid',
      [0, 1, 0],
    ],
    [
      'quad',
      [-0.49, 0.083, 0.33],
      [-0.475, 0.083, 0.33],
      [0.01, 0.083, 0.05],
      [-0.01, 0.083, 0.06],
      'ink.low',
      [0, 1, 0],
    ],
    [
      'quad',
      [0.49, 0.083, 0.33],
      [0.475, 0.083, 0.33],
      [-0.01, 0.083, 0.05],
      [0.01, 0.083, 0.06],
      'ink.low',
      [0, 1, 0],
    ],
    ['tile', 0.065, 6, 'coral.base', 0.086],
  ],
  [
    'solar-wings',
    0,
    [
      'x',
      [
        [0.98, 0, 0],
        [-0.98, 0, 0],
      ],
      ['g', ['box', 0.66, 0.035, 0.5, 'sky.base'], ['box', 0.05, 0.05, 0.52, 'sky.shade']],
    ],
    [
      'x',
      [
        [0.62, 0, 0],
        [-0.62, 0, 0],
      ],
      ['box', 0.24, 0.05, 0.05, 'ink.low'],
    ],
  ],
  [
    'dish',
    0,
    [
      'g',
      ['cyl', 0.03, 0.08, 0.36, 5, 'ink.low'],
      ['dome', 0.2, 8, 2, 'ink.high', { at: [0, 0.4, 0], rot: [0.5, 0, 0], s: [1, 0.8, 1] }],
      // A beacon where the dish gathers what it hears.
      beacon([0, 0.55, 0.08]),
      { at: [0, 0, -0.2] },
    ],
  ],
  // The letter is caught in flight at 35 percent of a 1.5 radius path; the trail and the path stay
  // inside 2.2 radii (the lane rule, vocabulary.md section 9).
  [
    'letter',
    FLAG.hold,
    [
      'g',
      ['box', 0.24, 0.014, 0.17, 'ink.high'],
      [
        'poly',
        [
          [-0.12, 0.009, -0.085],
          [0.12, 0.009, -0.085],
          [0, 0.009, 0],
        ],
        'ink.mid',
        [0, 1, 0],
      ],
      { at: [0, 0.16, 0.5 + 1.5 * 0.35], s: Math.sin(Math.PI * 0.35) },
    ],
  ],
  [
    'trail',
    FLAG.hold,
    [
      'x',
      [0, 1, 2, 3, 4].map((i): Vec3 => [0, 0.16, 0.5 + i * 0.36]),
      ['box', 0.03, 0.006, 0.09, 'ink.low'],
    ],
  ],
];

// --- the relays --------------------------------------------------------------------------------------

// A profile elsewhere, on the Contact satellite's ring, never docked at: a plinth, a mast, a mark
// and an exit arrow that points away from home. The three differ in FOOTPRINT, which is all a
// 7 px symbol keeps: GitHub a round plinth with a forked exit (a branch), LinkedIn a wide
// square-cornered plate with a barred exit (a signpost), Devpost a round plinth with two round
// ears (a trophy's handles) and a diamond exit.
const shaft = (x0: number, x1: number, top: ColorPath, side: ColorPath): Item => [
  'prism',
  [
    [x0, -0.075],
    [x1, -0.075],
    [x1, 0.075],
    [x0, 0.075],
  ],
  0.14,
  0.2,
  top,
  side,
  side,
  1,
];
const head = (points: readonly Vec2[], top: ColorPath, side: ColorPath): Item => [
  'prism',
  points,
  0.14,
  0.2,
  top,
  side,
  side,
  1,
];
// An arm of a fork, from x 0.85. It lies a hundredth lower than the shaft it forks from, which
// runs on over its root: two tops in one plane would fight for every pixel where they overlap.
const arm = (a: number, top: ColorPath, side: ColorPath): Item => [
  'g',
  shaft(0, 0.5, top, side),
  head(
    [
      [0.48, -0.2],
      [0.86, 0],
      [0.48, 0.2],
    ],
    top,
    side,
  ),
  { at: [0.85, -0.01, 0], rot: [0, a, 0] },
];
const relay = (plinth: Item, exit: readonly Item[], ...mark: Item[]): Rows => [
  [plinth],
  ['mast', 0, ['cyl', 0.05, 0.14, 0.62, 5, 'ink.mid']],
  ['exit-arrow', 0, ...exit],
  ['mark', 0, ...mark],
];
const DISC: Item = ['cyl', 0.5, 0, 0.14, 12, 'sky.base', 'sky.shade', 'sky.base'];
const rod = (x0: number, y0: number, x1: number, y1: number): Item => [
  'box',
  Math.hypot(x1 - x0, y1 - y0),
  0.05,
  0.05,
  'ink.mid',
  { at: [(x0 + x1) / 2, (y0 + y1) / 2, 0], rot: [0, 0, Math.atan2(y1 - y0, x1 - x0)] },
];

const github = relay(
  DISC,
  [
    // The trunk ends just past the fork, over the arms' roots.
    shaft(0.4, 0.88, 'coral.light', 'coral.base'),
    arm(0.6, 'sky.light', 'sky.base'),
    arm(-0.6, 'sky.light', 'sky.base'),
  ],
  rod(0, 0.7, 0, 1.18),
  rod(0, 0.86, 0.3, 1.02),
  ['bead', 0.12, 'coral.base', { at: [0, 0.68, 0] }],
  ['bead', 0.12, 'coral.base', { at: [0, 1.2, 0] }],
  ['bead', 0.12, 'sky.base', { at: [0.32, 1.03, 0] }],
);

const linkedin = relay(
  ['prism', cutRect(0.62, 0.46, 0.14), 0, 0.14, 'sky.base', 'sky.shade', 'sky.shade'],
  [
    shaft(0.6, 1.15, 'ink.mid', 'ink.low'),
    head(
      [
        [1.12, -0.4],
        [1.26, -0.4],
        [1.26, 0.4],
        [1.12, 0.4],
      ],
      'ink.mid',
      'ink.low',
    ),
  ],
  ['box', 0.56, 0.36, 0.22, 'ink.mid', { at: [0, 0.82, 0] }],
  ['box', 0.575, 0.03, 0.235, 'ink.low', { at: [0, 0.84, 0] }],
  ['box', 0.09, 0.09, 0.24, 'coral.base', { at: [0, 0.84, 0] }],
  ['box', 0.24, 0.045, 0.05, 'ink.low', { at: [0, 1.08, 0] }],
  ['box', 0.045, 0.1, 0.05, 'ink.low', { at: [0.1, 1.03, 0] }],
  ['box', 0.045, 0.1, 0.05, 'ink.low', { at: [-0.1, 1.03, 0] }],
);

const devpost = relay(
  [
    'g',
    DISC,
    [
      'x',
      [
        [0, 0, 0.6],
        [0, 0, -0.6],
      ],
      ['cyl', 0.17, 0, 0.14, 8, 'sky.base', 'sky.shade', 'sky.base'],
    ],
  ],
  [
    shaft(0.4, 0.95, 'lilac.light', 'lilac.base'),
    head(
      [
        [0.92, 0],
        [1.16, -0.2],
        [1.4, 0],
        [1.16, 0.2],
      ],
      'lilac.light',
      'lilac.base',
    ),
  ],
  ['cyl', 0.17, 0.62, 0.68, 6, 'ink.mid'],
  ['cyl', 0.05, 0.68, 0.84, 5, 'lilac.shade'],
  // The cup is open: its rim, then its inside in shade (a lid on it would make it a bucket).
  [
    'lathe',
    [
      [0.84, 0],
      [0.84, 0.09],
      [0.93, 0.19],
      [1.2, 0.27],
      [1.2, 0.23],
      [1.13, 0.23],
      [1.13, 0],
    ],
    6,
    ['lilac.shade', 'lilac.base', 'lilac.light', 'lilac.base', 'lilac.shade', 'lilac.shade'],
  ],
  // The handles touch the bowl (0.23 across at their height).
  [
    'x',
    [
      [0.27, 1.08, 0],
      [-0.27, 1.08, 0],
    ],
    ['box', 0.08, 0.2, 0.05, 'lilac.base'],
  ],
);

export const HOME: Readonly<Record<string, BodyRecipe>> = {
  'page/about': { rows: about },
  'page/resume': { rows: resume },
  'page/contact': { rows: contact },
  'link/github': { rows: github },
  'link/linkedin': { rows: linkedin },
  // Devpost has no body until its address is in site.socials (src/config/site.ts); its relay is
  // ready for that day. tests/worlds.test.ts allows a relay whose profile is not configured yet.
  'link/devpost': { rows: devpost },
};
