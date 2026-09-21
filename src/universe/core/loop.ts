/**
 * The fixed-timestep clock. The simulation always advances in steps of exactly `stepSec`, however
 * irregular the frames are, so flight feels the same on a 30 fps phone and a 144 Hz laptop, and a
 * recorded run replays to the same end state (docs/PLAN.md §5.5).
 *
 * What is left over after the whole steps is `alpha`: how far the frame sits between the last
 * two simulation states. Views draw `lerp(previous, current, alpha)`, which makes what is on
 * screen a smooth function of real time even when a frame runs zero steps or three.
 *
 * Pure: no DOM, no clock of its own. The engine feeds it frame durations.
 */

export interface FixedClockOptions {
  /** Length of one simulation step, in seconds. */
  readonly stepSec: number;
  /** Longest frame we account for. After a stall (tab switch, GC pause) time simply did not pass. */
  readonly maxFrameSec: number;
  /** Most steps one frame may run. Past this the backlog is dropped, not chased. */
  readonly maxStepsPerFrame: number;
}

export interface FrameSlice {
  /** Whole simulation steps to run this frame. */
  readonly steps: number;
  /** Position of the frame between the previous state (0) and the current one (1). */
  readonly alpha: number;
  /** The frame duration after clamping, in seconds: what per-frame effects should use. */
  readonly frameSec: number;
}

export class FixedClock {
  private accumulator = 0;
  private stepCount = 0;

  constructor(private readonly options: FixedClockOptions) {
    if (!(options.stepSec > 0)) throw new RangeError('FixedClock: stepSec must be positive');
    if (options.maxStepsPerFrame < 1) throw new RangeError('FixedClock: maxStepsPerFrame < 1');
  }

  /** Steps taken since the start (or the last reset). The simulation's only notion of "now". */
  get steps(): number {
    return this.stepCount;
  }

  /** Simulation time in seconds. Derived from the step count, so it never drifts. */
  get simTime(): number {
    return this.stepCount * this.options.stepSec;
  }

  advance(rawFrameSec: number): FrameSlice {
    const { stepSec, maxFrameSec, maxStepsPerFrame } = this.options;
    // NaN, negative (a clock that went backwards) and huge values all end up inside [0, max].
    const frameSec = Math.min(Math.max(rawFrameSec || 0, 0), maxFrameSec);
    this.accumulator += frameSec;

    let steps = Math.floor(this.accumulator / stepSec);
    if (steps > maxStepsPerFrame) {
      // The machine cannot keep up. Running more steps would make the next frame later still
      // (the "spiral of death"), so the world runs slow instead: keep the fraction, drop the rest.
      steps = maxStepsPerFrame;
      this.accumulator = this.accumulator % stepSec;
    } else {
      // Rounding can leave the remainder a hair below zero; the clamp keeps alpha inside [0, 1).
      this.accumulator = Math.max(0, this.accumulator - steps * stepSec);
    }

    this.stepCount += steps;
    const alpha = Math.min(this.accumulator / stepSec, 1 - Number.EPSILON);
    return { steps, alpha, frameSec };
  }

  /** Start again from step 0 (or from a snapshot's step count after a rebuild). */
  reset(steps = 0): void {
    this.accumulator = 0;
    this.stepCount = steps;
  }
}
