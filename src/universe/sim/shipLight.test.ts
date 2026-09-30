import { describe, expect, it } from 'vitest';
import { lightClaims, turnToward, type Direction, type LitBodies } from './shipLight';

// Four bodies by hand, lit by two lights: a sun (light 1) with its planet and the planet's moon,
// all three lit by the sun, and a relay (light 0, the key light) that nothing docks at.
/** Bodies let go of the ship this many ring radii out (tuning.world.shipLightClaimRadii). */
const LET_GO = 2;
const bodies: LitBodies = {
  count: 4,
  positions: Float64Array.from([0, 0, 100, 0, 130, 0, -150, 0]),
  ringRadius: Float64Array.from([38, 15, 7, 7]),
  docks: Uint8Array.from([1, 1, 1, 0]),
  light: Int32Array.from([1, 1, 1, 0]),
};
const claims = new Float64Array(2);
/** The claim of the one light that claims at all (the sun's), at (x, z). */
function sunClaim(x: number, z: number): number {
  const firmest = lightClaims(bodies, x, z, LET_GO, claims);
  expect(claims[0]).toBe(0);
  expect(claims[1]).toBe(firmest);
  return firmest;
}

describe('lightClaims: the light of the body the ship is near', () => {
  it('claims the ship fully on a ring and inside it, and not at all two rings out', () => {
    // The planet's ring (15) all round, and inside it.
    for (let k = 0; k < 16; k += 1) {
      const a = (k / 16) * Math.PI * 2;
      expect(sunClaim(100 + 15 * Math.sin(a), 15 * Math.cos(a))).toBe(1);
    }
    expect(sunClaim(100, 3)).toBe(1);
    // Past where the planet lets go (2 rings: 30 u), and the moon (14 u round 130), and the sun
    // (76 u): nothing near, nothing claimed.
    expect(sunClaim(100, 30.01)).toBe(0);
    expect(sunClaim(100, -40)).toBe(0);
    expect(sunClaim(0, 76.01)).toBe(0);
  });

  it('lets go smoothly between the ring and two rings out', () => {
    let last = 1;
    for (let d = 15; d <= 30; d += 0.25) {
      const claim = sunClaim(100, d);
      expect(claim).toBeLessThanOrEqual(last);
      // Never more than a step's worth at a time: no edge to pop at.
      expect(last - claim).toBeLessThan(0.05);
      last = claim;
    }
    expect(last).toBe(0);
    // Half way out, half claimed (a smoothstep).
    expect(sunClaim(100, 22.5)).toBeCloseTo(0.5, 12);
  });

  it('counts each light once, by its firmest body: a moon beside its planet adds nothing', () => {
    // Between the planet (100) and its moon (130), both claim for the sun: the firmer one counts.
    const firmest = lightClaims(bodies, 118, 0, LET_GO, claims);
    const planet = 1 - smooth((18 - 15) / (30 - 15));
    const moon = 1 - smooth((12 - 7) / (14 - 7));
    expect(firmest).toBeCloseTo(Math.max(planet, moon), 12);
    expect(claims[1]).toBe(firmest);
  });

  it('gives a body nothing docks at no claim, however near', () => {
    const firmest = lightClaims(bodies, -150, 7, LET_GO, claims);
    expect(firmest).toBe(0);
    expect([...claims]).toEqual([0, 0]);
  });

  it('keeps two lights apart when bodies of both are near', () => {
    // Two bodies of two lights, 30 u apart with rings of 10: half way between, both claim.
    const pair: LitBodies = {
      count: 2,
      positions: Float64Array.from([0, 0, 30, 0]),
      ringRadius: Float64Array.from([10, 10]),
      docks: Uint8Array.from([1, 1]),
      light: Int32Array.from([0, 1]),
    };
    const firmest = lightClaims(pair, 15, 0, LET_GO, claims);
    const each = 1 - smooth((15 - 10) / (20 - 10));
    expect(claims[0]).toBeCloseTo(each, 12);
    expect(claims[1]).toBeCloseTo(each, 12);
    expect(firmest).toBeCloseTo(each, 12);
    // And the next call starts from nothing: a light claims only where it does now.
    lightClaims(pair, 500, 500, LET_GO, claims);
    expect([...claims]).toEqual([0, 0]);
  });
});

describe('turnToward: from the light away from bodies to the claiming one, by angle', () => {
  const DEG = Math.PI / 180;
  const angle = (a: Direction, b: Direction): number =>
    Math.acos(Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z)));
  // A sun low beside the ship and the key light high above it on the far side, 150 degrees
  // apart: the widest kind of turn, the one by the Projects binary's gap.
  const from: Direction = { x: 1, y: 0, z: 0 };
  const to: Direction = {
    x: Math.cos(150 * DEG),
    y: Math.sin(150 * DEG) * 0.6,
    z: Math.sin(150 * DEG) * 0.8,
  };

  it('turns by that share of the angle all the way, not by blending the two', () => {
    expect(angle(from, to)).toBeCloseTo(150 * DEG, 12);
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const out = turnToward(from, to, t, { x: 0, y: 0, z: 0 });
      expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(1, 12);
      // A quarter of the way is a quarter of the turn: 37.5 degrees, where a blend of the two
      // vectors would have turned 13 of them, and 137 by three quarters.
      expect(angle(from, out) / DEG, `t ${t}`).toBeCloseTo(t * 150, 9);
      expect(angle(out, to) / DEG, `t ${t}`).toBeCloseTo((1 - t) * 150, 9);
    }
  });

  it('is where it starts at 0 and where it is going at 1, and never turns past either', () => {
    for (const [t, where] of [
      [0, from],
      [-0.5, from],
      [1, to],
      [1.5, to],
    ] as const) {
      const out = turnToward(from, to, t, { x: 0, y: 0, z: 0 });
      for (const axis of ['x', 'y', 'z'] as const)
        expect(out[axis], `t ${t}`).toBeCloseTo(where[axis], 15);
    }
  });

  it('keeps a direction that already is the other one', () => {
    expect(turnToward(from, { ...from }, 0.5, { x: 0, y: 0, z: 0 })).toEqual(from);
  });

  it('keeps the first of two opposite directions until the claim is whole, then takes the other', () => {
    // No one short way from one to its opposite: rather than pick one, the light it had stands.
    const back: Direction = { x: -1, y: 0, z: 0 };
    for (const t of [0, 0.5, 0.999]) {
      expect(turnToward(from, back, t, { x: 0, y: 0, z: 0 }), `t ${t}`).toEqual(from);
    }
    expect(turnToward(from, back, 1, { x: 0, y: 0, z: 0 })).toEqual(back);
  });

  it('may write over the direction it turns', () => {
    const out = { ...from };
    const apart = turnToward({ ...from }, to, 0.25, { x: 0, y: 0, z: 0 });
    expect(turnToward(out, to, 0.25, out)).toBe(out);
    expect(out).toEqual(apart);
  });
});

function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}
