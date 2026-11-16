import { TAU } from '../../sim/math';
import { brg } from '../../sim/world/kit';
import { FLAG, type BodyRecipe, type Rows } from '../../sim/world/rows';
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
    FLAG.hold | FLAG.flat,
    // The bezel is a raised case, its side showing as the art draws it.
    ['ring', [1.2, 1.34], 0, TAU, 24, -0.03, 0.03, 'lilac.light', 'lilac.base'],
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
    FLAG.hold | FLAG.flat,
    ['rq', rad(-6), 0, 1.5, 0.06, 0.012, 1.02, 1.02, 'star.white'],
    ['cyl', 0.07, 1.0, 1.05, 6, 'star.white'],
  ],
];

export const HACKATHONS: Readonly<Record<string, BodyRecipe>> = {
  'system/hackathons': { rows: sun },
};
