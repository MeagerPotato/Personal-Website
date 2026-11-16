import { TAU } from '../../sim/math';
import { FLAG, type BodyRecipe, type Rows } from '../../sim/world/rows';
import { rad, sunGround } from './shared';

/**
 * RESEARCH: its sun (mint), Sports Analysis and its moon Kalshi, both planned. Rows
 * (sim/world/rows.ts), keyed by manifest id; the close-up parts are in near.ts, the motions in
 * motion.ts.
 *
 * DESIGN SURFACE: the rows are free to change; their part names are what the motion table and
 * the tests refer to.
 */

// The standard candle: a ring drawn as its own light curve, a polar area chart. Its outer edge
// is the brightness: a flat baseline, one sharp rise, a long taper. A cursor sweeps round it (and
// up close, twelve ticks make it a clock of one period).
const curve = (u: number): number => (u < 0.1 ? u / 0.1 : ((1 - u) / 0.9) ** 1.7);
const outer = (t: number): number => 1.24 + 0.42 * curve(((((t - 0.7) % TAU) + TAU) % TAU) / TAU);
const sun: Rows = [
  sunGround('mint'),
  [
    'light-curve',
    FLAG.hold | FLAG.flat,
    ['ring', (t) => [1.17, outer(t) - 0.04], 0, TAU, 72, 0, 0, 'mint.shade'],
    ['ring', (t) => [outer(t) - 0.04, outer(t)], 0, TAU, 72, 0.001, 0.001, 'ink.high'],
  ],
  [
    'cursor',
    FLAG.hold | FLAG.flat,
    // Over the curve (its area lies at 0, its edge at 0.001), not in either's plane.
    ['rq', rad(200), 1.02, 1.66, 0.022, 0.022, 0.002, 0.003, 'ink.high'],
  ],
];

export const RESEARCH: Readonly<Record<string, BodyRecipe>> = {
  'system/research': { rows: sun },
};
