import { describe, expect, it } from 'vitest';
import type { BodyField } from './assist';
import { tuning } from '../design/tuning';
import { REFLEX_CLEAR, REFLEX_FLOOR, courseLimits, ownLimits } from './reflex';
import type { ShipState } from './types';

/** One body of `radius` at (x, z), and one more, the target, far off to the side. */
function field(x: number, z: number, radius: number): BodyField {
  return {
    count: 2,
    positions: new Float64Array([x, z, -500, 0]),
    velocities: new Float64Array(4),
    radius: new Float64Array([radius, 10]),
    ringRadius: new Float64Array([radius * 2, 20]),
  };
}

/** A ship at the origin going `speed` along `course` (radians from +Z), nose at `heading`. */
function ship(speed: number, course: number, heading = course): ShipState {
  return {
    x: 0,
    z: 0,
    vx: speed * Math.sin(course),
    vz: speed * Math.cos(course),
    heading,
    yawRate: 0,
  };
}

const GAIN = 5;
const out = new Float64Array(2);

describe('the reflex', () => {
  it('holds a ship heading at a body to gain times the way left before the danger circle', () => {
    // A moon of radius 2 straight ahead, 100 u off: the danger circle is 2 + REFLEX_CLEAR out.
    courseLimits(field(0, 100, 2), ship(400, 0), 1, 30, GAIN, 0, out);
    const toGo = 100 - 2 - REFLEX_CLEAR;
    expect(out[0]).toBeCloseTo(GAIN * toGo, 9);
    // ...and `ahead` further on, that much less.
    expect(out[1]).toBeCloseTo(GAIN * (toGo - 30), 9);
  });

  it('never asks for less than the floor, so a ship beside a moon can still set out', () => {
    courseLimits(field(0, 3, 2), ship(20, 0), 1, 0, GAIN, 0, out);
    expect(out[0]).toBe(REFLEX_FLOOR);
  });

  it('asks nothing of a course that passes clear, goes away, or runs at the target', () => {
    // Passes 10 u to the side of a body of radius 2: clear of the danger circle.
    courseLimits(field(10, 100, 2), ship(400, 0), 1, 0, GAIN, 0, out);
    expect(out[0]).toBe(Infinity);
    // The body is behind.
    courseLimits(field(0, -100, 2), ship(400, 0), 1, 0, GAIN, 0, out);
    expect(out[0]).toBe(Infinity);
    // The body ahead is where the ship is going: its own pilot brings it onto the ring.
    courseLimits(field(0, 100, 2), ship(400, 0), 0, 0, GAIN, 0, out);
    expect(out[0]).toBe(Infinity);
    // And a ship at rest has no course at all.
    courseLimits(field(0, 100, 2), ship(0, 0), 1, 0, GAIN, 0, out);
    expect(out).toEqual(new Float64Array([Infinity, Infinity]));
  });

  it('gives the body the ship is going to the plain berth, at any speed (ownLimits)', () => {
    // Head-on at 400 u/s at the body it is going to (row 0): courseLimits leaves it out...
    courseLimits(field(0, 100, 2), ship(400, 0), 0, 30, GAIN, 0.05, out);
    expect(out[0]).toBe(Infinity);
    // ...and ownLimits holds the ship to gain times the way left before REFLEX_CLEAR above it,
    // with no lead however fast it goes.
    ownLimits(field(0, 100, 2), ship(400, 0), 0, 30, GAIN, out);
    const toGo = 100 - 2 - REFLEX_CLEAR;
    expect(out[0]).toBeCloseTo(GAIN * toGo, 9);
    expect(out[1]).toBeCloseTo(GAIN * (toGo - 30), 9);
    // It only ever lowers what is there.
    out.fill(7);
    ownLimits(field(0, 100, 2), ship(400, 0), 0, 0, GAIN, out);
    expect(out[0]).toBe(7);
    // A ship on its way round the ring is never braked by it: a ring is dockMin or more above the
    // surface, beyond the berth. Here a body of radius 2 whose ring would be 8 u from its centre,
    // the ship on that ring going along it, its nose 0.5 rad in toward the body.
    expect(tuning.layout.dockMin).toBeGreaterThan(REFLEX_CLEAR + 2);
    out.fill(Infinity);
    ownLimits(field(8, 0, 2), ship(80, 0, 0.5), 0, 0, GAIN, out);
    expect(out[0]).toBe(Infinity);
    // No body, no limit.
    ownLimits(field(0, 100, 2), ship(400, 0), -1, 0, GAIN, out);
    expect(out[0]).toBe(Infinity);
  });

  it('looks where the nose points, too: a ship turning hard is about to go that way', () => {
    // Going straight up +Z, clear of a body off to the right; the nose already turned toward it.
    const toward = Math.atan2(60, 60);
    courseLimits(field(60, 60, 4), ship(300, 0), 1, 0, GAIN, 0, out);
    expect(out[0]).toBe(Infinity);
    courseLimits(field(60, 60, 4), ship(300, 0, toward), 1, 0, GAIN, 0, out);
    expect(out[0]).toBeCloseTo(GAIN * (Math.hypot(60, 60) - 4 - REFLEX_CLEAR), 9);
  });

  it('keeps a wider berth at speed for a ship with no plan (leadSec)', () => {
    // 8 u to the side of a body of radius 2: clear at REFLEX_CLEAR, not with 0.05 s at 200 u/s.
    courseLimits(field(8, 100, 2), ship(200, 0), 1, 0, GAIN, 0, out);
    expect(out[0]).toBe(Infinity);
    courseLimits(field(8, 100, 2), ship(200, 0), 1, 0, GAIN, 0.05, out);
    const danger = 2 + REFLEX_CLEAR + 200 * 0.05;
    expect(out[0]).toBeCloseTo(GAIN * (100 - Math.sqrt(danger * danger - 64)), 9);
    // Slow, the berth is what it always was.
    courseLimits(field(8, 100, 2), ship(10, 0), 1, 0, GAIN, 0.05, out);
    expect(out[0]).toBe(Infinity);
  });

  it('is braked to in time: a ship held to it by the brake is down to the floor short of the circle', () => {
    // Head-on at 700 u/s, braking as the cruise drive can (forward decays at brakeDrag +
    // forwardDrag = 6.25/s) whenever it is over the limit. By the time it is as slow as the floor
    // (which the cushion stops by itself), it has not reached the danger circle.
    const body = field(0, 400, 5);
    const state = ship(700, 0);
    const dt = 1 / 60;
    while (state.vz > REFLEX_FLOOR + 1e-9) {
      courseLimits(body, state, 1, 0, GAIN, 0, out);
      const speed = state.vz;
      const next = speed > (out[0] ?? Infinity) ? speed * Math.exp(-6.25 * dt) : speed;
      state.z += ((speed + next) / 2) * dt;
      state.vz = next;
    }
    expect(state.z).toBeLessThan(400 - 5 - REFLEX_CLEAR);
  });
});
