import { TAU } from '../math';

/**
 * THE ACT: one small, slow motion that tells a body's story, as a table (design/worlds/motion.ts)
 * and one pure driver. Calm first: a continuous motion takes 6 s or more, an event comes no more
 * often than every 10 s, nothing blinks, and every motion has a STILL (motion.test.ts checks the
 * whole table).
 *
 * A row is `[part, target, axis, shape, amount, period, phase = 0, rest = 0]`:
 *   part    the part that moves ('*': the whole body). It moves about its own pivot (rows.ts), so
 *           an axis is the part's own.
 *   target  'rot' (radians about the axis), 'pos' (a slide along it, in body radii), 'scale'
 *           (axis '*': all three), 'glow' (the brightness of a lit part, between 0.7 and 1)
 *   shape   the wave, of t = seconds / period + phase (SHAPES)
 *   rest    the t at which the still is drawn: reduced motion, the far tier, the low tier and
 *           the map all show it, so a still is always a designed picture.
 *
 * `drive` is a pure function of the row and a time, like sim/orbits.ts: nothing about motion is
 * stored, so a rebuilt engine (a lost WebGL context, a snapshot) shows the same picture. It
 * answers what to set, and the caller sets it.
 */

export type Shape = 'ramp' | 'sine' | 'bump' | 'blip' | 'hill' | 'step';
export type Axis = 'x' | 'y' | 'z';

export type MotionRow =
  | readonly [
      part: string,
      target: 'rot' | 'pos',
      axis: Axis,
      shape: Shape,
      amount: number,
      period: number,
      phase?: number,
      rest?: number,
    ]
  | readonly [
      part: string,
      target: 'scale',
      axis: Axis | '*',
      shape: Shape,
      amount: number,
      period: number,
      phase?: number,
      rest?: number,
    ]
  | readonly [
      part: string,
      target: 'glow',
      axis: '',
      shape: Shape,
      amount: number,
      period: number,
      phase?: number,
      rest?: number,
    ];

export type Target = MotionRow[1];

const fraction = (t: number): number => t - Math.floor(t);
const smooth = (x: number): number => x * x * (3 - 2 * x);

/** The six waves. Continuous: ramp, sine. Events, once a period: bump, blip, hill, step. */
export const SHAPES: Readonly<Record<Shape, (t: number) => number>> = {
  /** t: keeps going (a turn), or starts over each period (a slide). */
  ramp: (t) => t,
  /** There and back. */
  sine: (t) => Math.sin(TAU * t),
  /** 0 to 1 to 0 over the first 40% of each period, then rest: a hop. */
  bump: (t) => (fraction(t) < 0.4 ? Math.sin((fraction(t) / 0.4) * Math.PI) : 0),
  /** The same in the first 12%: a burst. */
  blip: (t) => (fraction(t) < 0.12 ? Math.sin((fraction(t) / 0.12) * Math.PI) : 0),
  /** Once a period, up and down: a thing that appears, travels and is gone. */
  hill: (t) => Math.sin(Math.PI * fraction(t)),
  /** One eased notch of size 1 per period, in its first 15%: a ratchet. */
  step: (t) => Math.floor(t) + smooth(Math.min(1, fraction(t) / 0.15)),
};

/** What to set on a part: a turn or a slide along `axis`, a scale, or a brightness. */
export interface Drive {
  readonly target: Target;
  readonly axis: Axis | '*' | '';
  readonly value: number;
}

/**
 * What a row sets at `time` seconds (simulation time), or at its still. A turn is the amount
 * times how far the wave has come since the still; a slide the same within one period (a slide
 * starts over, a turn keeps going); a scale the wave over its value at the still; a glow swells
 * between 0.7 and 1 of full brightness.
 */
export function drive(row: MotionRow, time: number | 'still'): Drive {
  const [, target, axis, shape, amount, period, phase = 0, rest = 0] = row;
  const f = SHAPES[shape];
  const r = rest + phase;
  const t = time === 'still' ? r : time / period + phase;
  let value: number;
  switch (target) {
    case 'rot':
      value = amount * (f(t) - f(r));
      break;
    case 'pos':
      value = amount * (f(fraction(t)) - f(fraction(r)));
      break;
    case 'scale':
      value = f(t) / (f(r) || 1);
      break;
    case 'glow':
      value = 0.85 + 0.15 * f(t);
      break;
  }
  return { target, axis, value };
}

/**
 * The parts that are not in the still at all: a scale row whose wave is 0 at rest (the twin
 * rocket's flame, the confetti at noon, a tick being fixed). They exist only while they play,
 * so the still (reduced motion, a body not moving) leaves them out.
 */
export function absentAtRest(rows: readonly MotionRow[]): Set<string> {
  const out = new Set<string>();
  for (const row of rows) {
    const [part, target, , shape, , , phase = 0, rest = 0] = row;
    if (target === 'scale' && SHAPES[shape](rest + phase) === 0) out.add(part);
  }
  return out;
}
