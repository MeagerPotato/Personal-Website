import { describe, expect, it } from 'vitest';
import { createPath, planPath, type Path } from './path';
import { bendSpeed, speedProfile, type ProfileParams, type TurnCurve } from './profile';

const PATH = { sampleStep: 4, clearance: 1.15, leadSec: 0.5, corridor: 6, squeeze: 0.6 };
const NEAR: ProfileParams = {
  cruiseSpeed: 70,
  accel: 50,
  decel: 40,
  lateralAccel: 40,
  brakeRate: 2,
  yawRate: 1.2,
  minSpeed: 6,
};

const straight = (length: number): Path => planPath(createPath(), 0, 0, length, 0, [], 0, PATH);
/** Round a big body that sits right in the way: a bend tight enough to have to slow down for. */
const round = (): Path => planPath(createPath(), 0, 0, 260, 0, [{ x: 130, z: 4, r: 80 }], 1, PATH);

function profile(path: Path, start: number, end: number, endRun = 0, params = NEAR) {
  const speeds = new Float64Array(path.x.length);
  const seconds = speedProfile(path, start, end, endRun, params, speeds);
  return { speeds: speeds.subarray(0, path.count), seconds };
}

/** Acceleration between neighbouring samples, from v² = u² + 2as. */
function accelerations(path: Path, speeds: Float64Array): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < path.count; i += 1) {
    const ds = (path.s[i + 1] ?? 0) - (path.s[i] ?? 0);
    out.push(((speeds[i + 1] ?? 0) ** 2 - (speeds[i] ?? 0) ** 2) / (2 * ds));
  }
  return out;
}

describe('speedProfile', () => {
  it('on a long straight: speeds up, cruises, slows down in time, and knows how long that takes', () => {
    const path = straight(1000);
    const { speeds, seconds } = profile(path, 0, 14);

    expect(speeds[0]).toBe(NEAR.minSpeed); // a ship at rest is asked to get going
    expect(Math.max(...speeds)).toBe(70);
    expect(speeds[speeds.length - 1]).toBe(14);
    const a = accelerations(path, speeds);
    expect(Math.max(...a)).toBeLessThanOrEqual(NEAR.accel + 1e-9);
    expect(Math.min(...a)).toBeGreaterThanOrEqual(-NEAR.decel - 1e-9);

    // By hand: 70/50 s up over 49 u, (70 - 14)/40 s down over 58.8 u, the rest at 70.
    const byHand = 70 / 50 + 56 / 40 + (1000 - 49 - 58.8) / 70;
    expect(seconds).toBeGreaterThan(byHand * 0.98);
    expect(seconds).toBeLessThan(byHand * 1.05);
  });

  it('on a short hop never reaches cruise: up, then straight down again', () => {
    const path = straight(60);
    const { speeds } = profile(path, 0, 14);
    expect(Math.max(...speeds)).toBeLessThan(60);
    expect(Math.max(...speeds)).toBeGreaterThan(40);
    expect(speeds[speeds.length - 1]).toBe(14);
  });

  it('slows for a bend so that the push sideways stays within bounds', () => {
    const path = round();
    const { speeds } = profile(path, 70, 14);
    let tightest = 0;
    for (let i = 0; i < path.count; i += 1) {
      const sideways = (speeds[i] ?? 0) ** 2 * (path.curvature[i] ?? 0);
      expect(sideways).toBeLessThanOrEqual(NEAR.lateralAccel + 1e-6);
      tightest = Math.max(tightest, path.curvature[i] ?? 0);
    }
    // The bend really is tight enough to matter, and the profile really does slow down for it.
    expect(tightest).toBeGreaterThan(NEAR.lateralAccel / 70 ** 2);
    expect(Math.min(...speeds.subarray(10, path.count - 30))).toBeLessThan(70);
    const a = accelerations(path, speeds);
    expect(Math.min(...a)).toBeGreaterThanOrEqual(-NEAR.decel - 1e-9);
  });

  it('starts from the speed the ship has, when that is possible', () => {
    const path = straight(1000);
    expect(profile(path, 45, 14).speeds[0]).toBe(45);
    // Faster than anything the profile allows: arithmetic cannot help, the brakes must.
    expect(profile(path, 200, 14).speeds[0]).toBe(70);
    // Too fast to stop in the room there is.
    const hop = straight(20);
    expect(profile(hop, 70, 14).speeds[0]).toBeLessThan(45);
  });

  it('holds the end speed over the last stretch, where someone else takes over', () => {
    const path = straight(400);
    const { speeds } = profile(path, 0, 10, 40);
    for (let i = 0; i < path.count; i += 1) {
      if ((path.s[i] ?? 0) >= 360) expect(speeds[i]).toBe(10);
    }
    expect(speeds[Math.floor(path.count / 2)]).toBe(70);
  });

  it('takes no bend faster than the ship can turn', () => {
    // Half way round a small body, from beside it to beside it: a bend of some 23 u. Plenty of
    // sideways push allowed, so what holds the speed down in the bend is the turn rate.
    const path = planPath(createPath(), 45, 0, 115, 4, [{ x: 80, z: 0, r: 20 }], 1, PATH);
    const agile = { ...NEAR, lateralAccel: 1000 };
    const { speeds } = profile(path, 70, 14, 0, agile);
    let held = 0;
    for (let i = 0; i < path.count; i += 1) {
      const turning = (speeds[i] ?? 0) * (path.curvature[i] ?? 0);
      expect(turning).toBeLessThanOrEqual(agile.yawRate + 1e-9);
      if (turning > agile.yawRate - 1e-9) held += 1;
    }
    expect(held).toBeGreaterThan(0);
  });

  it('respects a speed limit laid over the path, and brakes for it in time', () => {
    const path = straight(1000);
    const ceiling = new Float64Array(path.x.length).fill(Infinity);
    for (let i = 0; i < path.count; i += 1) {
      if ((path.s[i] ?? 0) >= 400 && (path.s[i] ?? 0) <= 600) ceiling[i] = 30;
    }
    const speeds = new Float64Array(path.x.length);
    speedProfile(path, 0, 14, 0, NEAR, speeds, ceiling);
    for (let i = 0; i < path.count; i += 1) {
      expect(speeds[i]).toBeLessThanOrEqual(ceiling[i] ?? Infinity);
    }
    // Cruising before it and after it, and never braking harder than it may to get down to it.
    expect(speeds[50]).toBe(70);
    expect(speeds[200]).toBe(70);
    const a = accelerations(path, speeds.subarray(0, path.count));
    expect(Math.min(...a)).toBeGreaterThanOrEqual(-NEAR.decel - 1e-9);
    expect(Math.max(...a)).toBeLessThanOrEqual(NEAR.accel + 1e-9);
  });

  it('knows that the brake is a drag: at low speed it asks for less than `decel`', () => {
    const path = straight(400);
    const { speeds } = profile(path, 70, 0);
    let bound = 0;
    for (let i = 0; i + 1 < path.count; i += 1) {
      const ds = (path.s[i + 1] ?? 0) - (path.s[i] ?? 0);
      const shed = (speeds[i] ?? 0) - (speeds[i + 1] ?? 0);
      // Never more u/s shed per unit of path than the brake takes off.
      expect(shed).toBeLessThanOrEqual(NEAR.brakeRate * ds + 1e-9);
      if (shed > NEAR.brakeRate * ds - 1e-9) bound += 1;
    }
    // Below decel / brakeRate = 20 u/s it is the brake that sets the pace, not `decel`.
    expect(bound).toBeGreaterThan(0);
    const a = accelerations(path, speeds);
    expect(Math.min(...a)).toBeGreaterThanOrEqual(-NEAR.decel - 1e-9);
  });

  it('never asks a ship to stand still', () => {
    const path = straight(200);
    const { speeds } = profile(path, 0, 0);
    expect(Math.min(...speeds)).toBe(NEAR.minSpeed);
  });

  it('has nothing to say about a path that is not there', () => {
    const empty = createPath();
    expect(speedProfile(empty, 10, 10, 0, NEAR, new Float64Array(4))).toBe(0);
  });
});

describe('bends, for a ship that turns faster when it is slow', () => {
  const TURN: TurnCurve = { slow: 7, fast: 4, fastSpeed: 150 };
  const rateAt = (speed: number): number =>
    speed >= TURN.fastSpeed
      ? TURN.fast
      : TURN.slow - ((TURN.slow - TURN.fast) * speed) / TURN.fastSpeed;

  it('takes a bend exactly as fast as asks for the turn rate the ship has at that speed', () => {
    for (const bend of [0.001, 0.01, 0.03, 0.05, 0.2, 1, 5]) {
      const speed = bendSpeed(bend, TURN);
      expect(speed * bend).toBeCloseTo(rateAt(speed), 9);
    }
    expect(bendSpeed(0, TURN)).toBe(Infinity);
  });

  it('lets a profile take a tight bend faster than one turn rate for every speed would', () => {
    const path = round();
    const params = { ...NEAR, cruiseSpeed: 400, accel: 1e4, decel: 1e4, lateralAccel: 1e6 };
    const plain = new Float64Array(path.x.length);
    const turning = new Float64Array(path.x.length);
    const slow = speedProfile(path, 0, 0, 0, params, plain);
    const quick = speedProfile(path, 0, 0, 0, params, turning, null, TURN);
    expect(quick).toBeLessThan(slow);
    for (let i = 0; i < path.count; i += 1) {
      expect(turning[i]).toBeGreaterThanOrEqual((plain[i] ?? 0) - 1e-9);
      // ...and never faster than the ship can turn at that speed.
      const bend = path.curvature[i] ?? 0;
      const speed = turning[i] ?? 0;
      expect(speed * bend).toBeLessThanOrEqual(Math.max(rateAt(speed), params.yawRate) + 1e-6);
    }
  });
});
