import { describe, expect, it } from 'vitest';
import { createSpring, snapSpring, stepSpring } from './spring';

describe('the critically damped spring', () => {
  it('reaches its target and never overshoots it', () => {
    const spring = createSpring(0);
    let highest = 0;
    for (let step = 0; step < 240; step += 1) {
      stepSpring(spring, 10, 14, 1 / 60);
      highest = Math.max(highest, spring.value);
    }
    expect(spring.value).toBeCloseTo(10, 6);
    expect(spring.velocity).toBeCloseTo(0, 6);
    expect(highest).toBeLessThanOrEqual(10);
  });

  it('lands in the same place at any frame rate', () => {
    const simulate = (hz: number): number => {
      const spring = createSpring(0);
      spring.velocity = 5;
      for (let step = 0; step < hz; step += 1) stepSpring(spring, 3, 12, 1 / hz);
      return spring.value;
    };
    const reference = simulate(60);
    expect(simulate(24)).toBeCloseTo(reference, 9);
    expect(simulate(144)).toBeCloseTo(reference, 9);
    expect(simulate(1)).toBeCloseTo(reference, 9); // one giant step: still exact
  });

  it('covers about 63% of a step change in 2.15 / omega seconds', () => {
    const omega = 14;
    const spring = createSpring(0);
    stepSpring(spring, 1, omega, 2.15 / omega);
    expect(spring.value).toBeGreaterThan(0.6);
    expect(spring.value).toBeLessThan(0.66);
  });

  it('trails a moving target by exactly 2 * speed / omega, at any frame rate', () => {
    const omega = 12;
    const speed = 40; // the ship at cruise, u/s
    const trailAt = (hz: number): number => {
      const spring = createSpring(0);
      let target = 0;
      for (let step = 0; step < hz * 10; step += 1) {
        target += speed / hz;
        stepSpring(spring, target, omega, 1 / hz, speed);
      }
      return target - spring.value;
    };
    expect(trailAt(60)).toBeCloseTo((2 * speed) / omega, 9);
    expect(trailAt(24)).toBeCloseTo((2 * speed) / omega, 9);
    expect(trailAt(144)).toBeCloseTo((2 * speed) / omega, 9);
  });

  it('does not care how a stretch of time is cut into frames', () => {
    // Uneven frames (a busy phone) against one long one: the same place, the same speed.
    const uneven = createSpring(0);
    let target = 0;
    for (const dt of [0.016, 0.034, 0.008, 0.05, 0.012, 0.03]) {
      target += 30 * dt;
      stepSpring(uneven, target, 14, dt, 30);
    }
    const single = stepSpring(createSpring(0), 30 * 0.15, 14, 0.15, 30);
    expect(uneven.value).toBeCloseTo(single.value, 9);
    expect(uneven.velocity).toBeCloseTo(single.velocity, 9);
  });

  it('ignores a step that could not mean anything, and can be snapped', () => {
    const spring = createSpring(2);
    expect(stepSpring(spring, 9, 0, 1 / 60).value).toBe(2);
    expect(stepSpring(spring, 9, 14, 0).value).toBe(2);
    expect(stepSpring(spring, 9, 14, Number.NaN).value).toBe(2);

    spring.velocity = 3;
    expect(snapSpring(spring, 7)).toEqual({ value: 7, velocity: 0 });
  });
});
