import { TAU } from '../../sim/math';
import type { MotionRow } from '../../sim/world/motion';
import { GEARS, Z } from './gears';

/**
 * THE ACTS: each body's one small, slow motion (at most two, plus a planned body's crane), keyed
 * by manifest id. The rows and the driver are sim/world/motion.ts; a part named here is a part
 * of the body's rows or its close-up rows, and the tests check both that and the calm-first
 * rules. It travels with the close-up rows (the second chunk): far away every body is its still.
 *
 * DESIGN SURFACE: amounts, periods and phases are free to change.
 */

/** The planned kit's one motion: the crane's jib swings on its tower. */
const CRANE: MotionRow = ['crane', 'rot', 'y', 'sine', 0.1, 8];
/** A profile's relay: the arrow out of it nudges towards the door. */
const EXIT: MotionRow = ['exit-arrow', 'pos', 'x', 'sine', 0.08, 8];

export const MOTION: Readonly<Record<string, readonly MotionRow[]>> = {
  'page/about': [
    ['train', 'rot', 'y', 'ramp', TAU, 18],
    ['twin-rocket', 'pos', 'y', 'bump', 0.9, 40],
    ['twin-flame', 'pos', 'y', 'bump', 0.9, 40],
    ['twin-flame', 'scale', '*', 'bump', 1, 40],
  ],
  'page/resume': [['two-pages', 'rot', 'z', 'sine', 0.06, 8]],
  'page/contact': [
    ['dish', 'rot', 'z', 'sine', 0.25, 8],
    ['letter', 'pos', 'z', 'ramp', 1.5, 10, 0, 0.35],
    ['letter', 'scale', '*', 'hill', 1, 10, 0, 0.35],
  ],
  'link/github': [EXIT],
  'link/linkedin': [EXIT],
  'link/devpost': [EXIT],
  // One click every 12 s, a whole tooth each: the cogs one way, the pinions the other.
  'system/hardware': GEARS.map(([name, kind]): MotionRow => [
    name,
    'rot',
    'y',
    'step',
    kind === 'big' ? TAU / Z.big : -TAU / Z.pin,
    12,
  ]),
  'system/software': [['caret', 'glow', '', 'sine', 1, 2.4, 0, 0.25]],
  'system/research': [['cursor', 'rot', 'y', 'ramp', TAU, 12]],
  'system/hackathons': [
    ['hand', 'rot', 'y', 'ramp', -TAU, 60],
    ['confetti', 'scale', '*', 'blip', 1, 60],
  ],
  'project/model-rocketry': [['parachute', 'rot', 'z', 'sine', 0.08, 6]],
  'project/robotics': [['pose-cloud', 'scale', '*', 'hill', 1, 12, 0, 0.3]],
  'project/cyberpatriot': [['fix-tick', 'scale', '*', 'hill', 1, 20]],
  'project/canadian-fish-demo': [
    ['card-fan', 'rot', 'z', 'sine', 0.06, 6],
    ['ask-card', 'pos', 'x', 'ramp', -0.26, 10, 0, 0.4],
    ['ask-card', 'scale', '*', 'hill', 1, 10, 0, 0.4],
  ],
  'project/fishai': [
    ['athena-loop', 'rot', 'y', 'ramp', TAU, 30],
    // A turn about the axis the board's columns turn about (near.ts): west edge to east and back.
    ['scan-bar', 'rot', 'y', 'sine', 0.45, 10, 0, 0.75],
  ],
  'project/fish-onboarding': [['scan-line', 'pos', 'z', 'sine', 0.17, 8]],
  'project/days2meet': [['paint-cursor', 'pos', 'x', 'sine', 0.5, 8]],
  'project/fish-online': [CRANE],
  'project/sports-analysis': [CRANE, ['ball', 'rot', 'y', 'ramp', TAU, 30]],
  // The coin rocks as a whole ('*'), about the body's centre.
  'project/kalshi': [CRANE, ['*', 'rot', 'z', 'sine', 0.12, 12]],
  'project/corgi': [CRANE],
  // The magnifier rides with the ring, over its seam.
  'project/hackgt-13': [
    ['wave-ring', 'rot', 'y', 'ramp', TAU, 60],
    ['magnifier', 'rot', 'y', 'ramp', TAU, 60],
  ],
  'project/hackathons-at-berkeley': [['headlights', 'glow', '', 'sine', 1, 4, 0, 0.25]],
  // The four stands do the wave, a quarter period apart.
  'project/cal-hacks-13': [0, 0.25, 0.5, 0.75].map((phase, i): MotionRow => [
    `stands-${i + 1}`,
    'pos',
    'y',
    'sine',
    0.04,
    8,
    phase,
  ]),
};
