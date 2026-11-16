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
  'project/model-rocketry': [
    ['flame', 'pos', 'y', 'sine', 0.04, 6, 0, 0],
    ['flame', 'glow', '', 'sine', 1, 3, 0, 0.25],
    ['streamer', 'rot', 'z', 'sine', 0.22, 7],
  ],
  'project/robotics': [
    ['bot', 'pos', 'x', 'sine', 0.06, 9],
    ['pose-cloud', 'scale', '*', 'hill', 1, 12, 0, 0.3],
  ],
  // The islands (islands.ts): one small life each, and the planned ones' cranes.
  'project/cyberpatriot': [['flags', 'rot', 'y', 'sine', 0.2, 7]],
  'project/canadian-fish-demo': [['leap', 'pos', 'y', 'sine', 0.06, 7]],
  'project/fishai': [['rod', 'rot', 'x', 'sine', 0.05, 6]],
  'project/fish-onboarding': [['clouds', 'pos', 'y', 'sine', 0.04, 9]],
  'project/days2meet': [['paint-cursor', 'pos', 'x', 'sine', 0.3, 8]],
  'project/fish-online': [CRANE],
  'project/sports-analysis': [CRANE, ['ball', 'pos', 'y', 'sine', 0.05, 6]],
  'project/kalshi': [
    CRANE,
    ['yes-face', 'rot', 'y', 'ramp', TAU, 20],
    ['no-face', 'rot', 'y', 'ramp', TAU, 20],
  ],
  'project/corgi': [CRANE],
  'project/hackgt-13': [['wave-ring', 'pos', 'y', 'sine', 0.04, 6]],
  // Two buses opposite each other on the ring road: their part turns about the island's middle.
  'project/hackathons-at-berkeley': [['bus', 'rot', 'y', 'ramp', TAU, 40]],
  'project/cal-hacks-13': [['clouds', 'pos', 'x', 'sine', 0.05, 10]],
};
