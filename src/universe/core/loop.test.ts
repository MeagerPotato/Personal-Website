import { describe, expect, it } from 'vitest';
import { FixedClock } from './loop';

const STEP = 1 / 60;
const options = { stepSec: STEP, maxFrameSec: 0.1, maxStepsPerFrame: 5 };

/** A toy simulation with drag and thrust: its end state depends on every step it ran. */
function simulate(frameSec: number, totalSec: number): { speed: number; steps: number } {
  const clock = new FixedClock(options);
  let speed = 0;
  const frames = Math.round(totalSec / frameSec);
  for (let frame = 0; frame < frames; frame += 1) {
    const { steps } = clock.advance(frameSec);
    for (let step = 0; step < steps; step += 1) speed += (34 - 0.8 * speed) * STEP;
  }
  return { speed, steps: clock.steps };
}

describe('FixedClock', () => {
  it('runs the same simulation at 30, 60 and 144 frames per second', () => {
    const runs = [1 / 30, 1 / 60, 1 / 144].map((frameSec) => simulate(frameSec, 10));
    for (const run of runs) {
      // Frame durations do not add up to exactly 10 s in floating point, so allow one step.
      expect(Math.abs(run.steps - 600)).toBeLessThanOrEqual(1);
    }
    // The state is a function of the step count alone: same count, same bits.
    const again = simulate(1 / 144, 10);
    expect(again).toEqual(runs[2]);
  });

  it('keeps what is on screen a smooth function of real time, whatever the frame rate', () => {
    for (const frameSec of [1 / 24, 1 / 60, 1 / 90, 1 / 144, 0.0123]) {
      const clock = new FixedClock(options);
      let realTime = 0;
      for (let frame = 0; frame < 500; frame += 1) {
        const { alpha } = clock.advance(frameSec);
        realTime += frameSec;
        // Drawn time = the previous state's time + alpha of a step = real time minus one step.
        const drawnTime = (clock.steps - 1 + alpha) * STEP;
        expect(drawnTime).toBeCloseTo(realTime - STEP, 9);
        expect(alpha).toBeGreaterThanOrEqual(0);
        expect(alpha).toBeLessThan(1);
      }
    }
  });

  it('treats a five second stall as one slow frame, and does not chase the backlog', () => {
    const clock = new FixedClock(options);
    clock.advance(1 / 60);
    const before = clock.steps;

    const stall = clock.advance(5);
    expect(stall.frameSec).toBe(0.1);
    expect(stall.steps).toBe(5);
    expect(clock.steps).toBe(before + 5);

    // The very next frame is an ordinary one: nothing is owed.
    expect(clock.advance(1 / 60).steps).toBeLessThanOrEqual(1);
  });

  it('survives a clock that misbehaves', () => {
    const clock = new FixedClock(options);
    expect(clock.advance(-1)).toEqual({ steps: 0, alpha: 0, frameSec: 0 });
    expect(clock.advance(Number.NaN)).toEqual({ steps: 0, alpha: 0, frameSec: 0 });
    expect(clock.advance(Number.POSITIVE_INFINITY).steps).toBe(5);
  });

  it('reports simulation time from the step count, and can restart from a snapshot', () => {
    const clock = new FixedClock(options);
    for (let frame = 0; frame < 120; frame += 1) clock.advance(STEP * 1.0000001);
    expect(clock.simTime).toBe(clock.steps * STEP);

    clock.reset(3600);
    expect(clock.steps).toBe(3600);
    expect(clock.simTime).toBeCloseTo(60, 9);
    expect(clock.advance(0).alpha).toBe(0);
  });

  it('rejects options that could never advance', () => {
    expect(() => new FixedClock({ ...options, stepSec: 0 })).toThrow(RangeError);
    expect(() => new FixedClock({ ...options, maxStepsPerFrame: 0 })).toThrow(RangeError);
  });
});
