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
/**
 * An island's life (design/worlds/isles.ts), the reference's: the water pours down its fall,
 * smoke rises from the chimney in two puffs, leaves drift down, gulls wheel round, the islets
 * bob, the clouds drift and the crystals under it breathe. Each part is the kit's, by name.
 */
const ISLE_LIFE: readonly MotionRow[] = [
  // One step of the kit's flow (isles.ts, FLOW_STEP) a period: the streaks seem to pour.
  ['flow', 'pos', 'y', 'ramp', -0.1, 1.25],
  // Two puffs half a period apart: each rises from the chimney, swells and is gone. At the
  // still both sit on the chimney (a slide's still is where it starts).
  ['smoke-1', 'pos', 'y', 'ramp', 0.24, 5],
  ['smoke-1', 'scale', '*', 'hill', 1, 5, 0, 0.5],
  ['smoke-2', 'pos', 'y', 'ramp', 0.24, 5, 0.5, 0.5],
  ['smoke-2', 'scale', '*', 'hill', 1, 5, 0.5],
  ['leaves', 'pos', 'y', 'ramp', -0.16, 6],
  ['leaves', 'scale', '*', 'hill', 1, 6, 0, 0.5],
  ['gulls', 'rot', 'y', 'ramp', TAU, 24],
  ['islets', 'pos', 'y', 'sine', 0.035, 8],
  ['clouds', 'pos', 'x', 'sine', 0.05, 12],
  ['crystals', 'glow', '', 'sine', 1, 3.5],
];

/** An island's life without the parts it lacks (an island with no waterfall has no `flow`). */
const lifeWithout = (...parts: readonly string[]): MotionRow[] =>
  ISLE_LIFE.filter(([part]) => !parts.includes(part));

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
    ...ISLE_LIFE,
  ],
  // The islands (islands.ts): one small life each, and the planned ones' cranes.
  'project/cyberpatriot': [
    ['flags', 'rot', 'y', 'sine', 0.25, 7],
    ['radar', 'rot', 'y', 'ramp', TAU, 12],
    ...ISLE_LIFE,
  ],
  // The salmon leaps over the lake, nose up on the way out and down on the way back.
  'project/canadian-fish-demo': [
    ['leap', 'pos', 'y', 'sine', 0.07, 7],
    ['leap', 'rot', 'z', 'sine', 0.3, 7, 0.25],
    ...ISLE_LIFE,
  ],
  'project/fishai': [
    ['rod', 'rot', 'x', 'sine', 0.06, 6],
    ['lantern', 'glow', '', 'sine', 1, 3],
    ...ISLE_LIFE,
  ],
  'project/fish-onboarding': [
    ['guide', 'pos', 'y', 'sine', 0.035, 6],
    ['lanterns', 'glow', '', 'sine', 1, 3],
    ...ISLE_LIFE,
  ],
  // The brush paints across the month; the clock tower's hands go round once a minute.
  'project/days2meet': [
    ['paint-cursor', 'pos', 'x', 'sine', 0.3, 8],
    ['clock-hands', 'rot', 'z', 'ramp', -TAU, 60],
    ...ISLE_LIFE,
  ],
  // The planned islands are building sites: the crane swings, and the site's one sign of life.
  'project/fish-online': [CRANE, ['signal', 'glow', '', 'sine', 1, 3], ...ISLE_LIFE],
  'project/sports-analysis': [CRANE, ['ball', 'pos', 'y', 'sine', 0.05, 6], ...lifeWithout('flow')],
  'project/kalshi': [
    CRANE,
    ['yes-face', 'rot', 'y', 'ramp', TAU, 20],
    ['no-face', 'rot', 'y', 'ramp', TAU, 20],
    ...lifeWithout('flow'),
  ],
  // Now and then a puff of dust off the carving: up, out and gone.
  'project/corgi': [
    CRANE,
    ['dust', 'scale', '*', 'bump', 1, 10],
    ['dust', 'pos', 'y', 'ramp', 0.08, 10],
    ...ISLE_LIFE,
  ],
  // The dish listens (its rings pulse along its own axis); the playhead runs along the clip.
  'project/hackgt-13': [
    ['wave-ring', 'pos', 'y', 'sine', 0.05, 6],
    ['playhead', 'pos', 'x', 'ramp', 0.44, 8],
    ...ISLE_LIFE,
  ],
  // Two buses opposite each other on the ring road: their part turns about the island's middle.
  'project/hackathons-at-berkeley': [
    ['bus', 'rot', 'y', 'ramp', TAU, 40],
    ['string-lights', 'glow', '', 'sine', 1, 3],
    ...ISLE_LIFE,
  ],
  // The Campanile's bell swings; the campfire by the tents flickers.
  'project/cal-hacks-13': [
    ['bell', 'rot', 'x', 'sine', 0.35, 8],
    ['flames', 'glow', '', 'sine', 1, 2.5],
    ...ISLE_LIFE,
  ],
};
