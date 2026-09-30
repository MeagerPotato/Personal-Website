import { describe, expect, it } from 'vitest';
import { lightClaims, type LitBodies } from './shipLight';

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

function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}
