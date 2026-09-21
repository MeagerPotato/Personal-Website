import { describe, expect, it } from 'vitest';
import {
  TAU,
  angleDelta,
  angleOf,
  approach,
  clamp,
  lerp,
  pointAt,
  smoothstep,
  unitX,
  unitZ,
} from './math';

describe('the angle convention', () => {
  it('points along +Z at 0 and along +X after a quarter turn counter-clockwise', () => {
    expect([unitX(0), unitZ(0)]).toEqual([0, 1]);
    expect(unitX(Math.PI / 2)).toBeCloseTo(1, 12);
    expect(unitZ(Math.PI / 2)).toBeCloseTo(0, 12);
  });

  it('round-trips a direction through its angle', () => {
    for (const angle of [-3, -1.2, 0, 0.4, 2.9]) {
      expect(angleOf(unitX(angle), unitZ(angle))).toBeCloseTo(angle, 12);
    }
  });

  it('places a point on a circle around a centre', () => {
    const out = { x: 0, z: 0 };
    expect(pointAt({ x: 10, z: -5 }, 2, Math.PI / 2, out)).toBe(out);
    expect(out.x).toBeCloseTo(12, 12);
    expect(out.z).toBeCloseTo(-5, 12);
  });

  it('finds the shortest turn, whichever way round, however many laps in', () => {
    expect(angleDelta(0, 1)).toBeCloseTo(1, 12);
    expect(angleDelta(0.1, TAU - 0.1)).toBeCloseTo(-0.2, 12);
    expect(angleDelta(TAU * 40 + 3, -3)).toBeCloseTo(TAU - 6, 9);
    expect(angleDelta(0, Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(angleDelta(0, -Math.PI)).toBeCloseTo(Math.PI, 12);
  });
});

describe('scalar helpers', () => {
  it('clamps and lerps', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
  });

  it('smoothsteps between edges given in either order', () => {
    expect(smoothstep(0, 10, -1)).toBe(0);
    expect(smoothstep(0, 10, 5)).toBe(0.5);
    expect(smoothstep(0, 10, 11)).toBe(1);
    // Falling edge: 1 up close, 0 far away.
    expect(smoothstep(10, 0, 2)).toBeGreaterThan(0.8);
    expect(smoothstep(10, 0, 12)).toBe(0);
    expect(smoothstep(3, 3, 2)).toBe(0);
    expect(smoothstep(3, 3, 3)).toBe(1);
  });
});

describe('approach', () => {
  it('closes about 63% of the gap in 1 / rate seconds, and lands the same however time is cut', () => {
    expect(approach(0, 10, 4, 0.25)).toBeCloseTo(10 * (1 - Math.exp(-1)), 12);

    let value = 0;
    for (const dt of [0.016, 0.05, 0.009, 0.075]) value = approach(value, 10, 4, dt);
    expect(value).toBeCloseTo(approach(0, 10, 4, 0.15), 12);
  });

  it('never overshoots, and ignores a step that could not mean anything', () => {
    expect(approach(0, 1, 1000, 10)).toBeLessThanOrEqual(1);
    expect(approach(3, 9, 0, 1)).toBe(3);
    expect(approach(3, 9, 5, 0)).toBe(3);
    expect(approach(3, 9, 5, Number.NaN)).toBe(3);
  });
});
