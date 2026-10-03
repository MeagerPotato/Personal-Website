import { describe, expect, it } from 'vitest';
import type { SkyBand } from '../design/lookTypes';
import { tuning } from '../design/tuning';
import {
  bandFrame,
  bulgeAt,
  clumpAt,
  clumpPeak,
  laneAt,
  meanderAt,
  narrowShare,
  profileAt,
} from './milkyWay';
import { azimuthDeg, elevationDeg, wrapDeg } from './skyDirections';

const { band } = tuning.look.sky;
const RAD = Math.PI / 180;
const dot = (a: readonly number[], b: readonly number[]): number =>
  (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);

/** A river with one clump and no wander, to read single terms off. */
const plain: SkyBand = {
  ...band,
  meanderDeg: [0, 0, 0, 0],
  base: 0.25,
  clumps: [[40, 10, 0.5]],
  lane: { offsetDeg: [2, 0, 0], widthDeg: [1.5, 0], hide: 0.8 },
};

describe('the Milky Way’s frame', () => {
  it('tilts the circle’s pole from straight up, toward its azimuth', () => {
    const { pole, b1, b2 } = bandFrame(band);
    expect(elevationDeg(pole)).toBeCloseTo(90 - band.tiltDeg, 9);
    expect(wrapDeg(azimuthDeg(pole) - band.poleAzDeg)).toBeCloseTo(0, 9);
    // Three unit vectors at right angles; longitude starts from a level one.
    for (const axis of [pole, b1, b2]) expect(Math.hypot(...axis)).toBeCloseTo(1, 12);
    expect(dot(pole, b1)).toBeCloseTo(0, 12);
    expect(dot(pole, b2)).toBeCloseTo(0, 12);
    expect(dot(b1, b2)).toBeCloseTo(0, 12);
    expect(b1[1]).toBe(0);
  });

  it('puts the river’s crest opposite the pole’s lean, a tilt above the horizon', () => {
    // A quarter turn of longitude from the level start is the circle's highest point.
    const { b2 } = bandFrame(band);
    expect(elevationDeg(b2)).toBeCloseTo(band.tiltDeg, 9);
    expect(wrapDeg(azimuthDeg(b2) - (band.poleAzDeg + 180))).toBeCloseTo(0, 9);
  });
});

describe('the river’s shape', () => {
  it('wanders about the circle by two sines, never further than their swings', () => {
    const [a1, p1, a2, p2] = band.meanderDeg;
    expect(meanderAt(band, 0.3)).toBeCloseTo(a1 * Math.sin(0.6 + p1) + a2 * Math.sin(1.5 + p2), 12);
    for (let lon = 0; lon < 360; lon += 7) {
      expect(Math.abs(meanderAt(band, lon * RAD))).toBeLessThanOrEqual(a1 + a2);
    }
    expect(meanderAt(plain, 1.234)).toBe(0);
  });

  it('is a narrow bank and a wide one across: brightest in its middle, even, gone far out', () => {
    const [[s1, w1], [s2, w2]] = band.banks;
    expect(profileAt(band, 0)).toBeCloseTo(w1 + w2, 12);
    expect(profileAt(band, 3)).toBe(profileAt(band, -3));
    expect(profileAt(band, s1)).toBeCloseTo(w1 / Math.E + w2 * Math.exp(-((s1 / s2) ** 2)), 12);
    let before = profileAt(band, 0);
    for (let yy = 0.5; yy <= 30; yy += 0.5) {
      const here = profileAt(band, yy);
      expect(here).toBeLessThan(before);
      before = here;
    }
    // The bake stops looking 40 degrees off the circle: by then nothing is left.
    expect(profileAt(band, 40)).toBeLessThan(1e-10);
  });

  it('is its base everywhere, and a clump brighter round each clump’s longitude', () => {
    expect(clumpAt(plain, 40)).toBeCloseTo(0.75, 12);
    expect(clumpAt(plain, 50)).toBeCloseTo(0.25 + 0.5 / Math.E, 12);
    expect(clumpAt(plain, 30)).toBeCloseTo(clumpAt(plain, 50), 12);
    expect(clumpAt(plain, 220)).toBeCloseTo(0.25, 9);
    expect(clumpPeak(plain)).toBeCloseTo(0.75, 12);
    // The recipe's river: never under its base, and its peak is where two clumps overlap.
    for (let lon = 0; lon < 360; lon += 1) {
      expect(clumpAt(band, lon)).toBeGreaterThanOrEqual(band.base);
      expect(clumpAt(band, lon)).toBeLessThanOrEqual(clumpPeak(band));
    }
    expect(clumpPeak(band)).toBeGreaterThan(band.base + 1);
  });

  it('runs a dark lane beside its middle: all of it on the lane’s line, none far from it', () => {
    expect(laneAt(plain, 0.4, 2)).toBe(1);
    expect(laneAt(plain, 0.4, 2 + 1.5)).toBeCloseTo(1 / Math.E, 12);
    expect(laneAt(plain, 0.4, 2 - 1.5)).toBeCloseTo(1 / Math.E, 12);
    expect(laneAt(plain, 0.4, 12)).toBeLessThan(1e-12);
    // The recipe's lane swings from side to side, and always has a width.
    const { offsetDeg, widthDeg } = band.lane;
    expect(widthDeg[0] - Math.abs(widthDeg[1])).toBeGreaterThan(0.5);
    for (let lon = 0; lon < 360; lon += 5) {
      const phi = lon * RAD;
      const middle =
        offsetDeg[0] +
        offsetDeg[1] * Math.sin(3 * phi + 0.7) +
        offsetDeg[2] * Math.sin(7 * phi + 2.1);
      expect(laneAt(band, phi, middle)).toBeCloseTo(1, 12);
      expect(Math.abs(middle - offsetDeg[0])).toBeLessThanOrEqual(
        Math.abs(offsetDeg[1]) + Math.abs(offsetDeg[2]) + 1e-12,
      );
    }
  });

  it('shares its stars between the banks by their mass, so their cross-section is the haze’s', () => {
    const [[s1, w1], [s2, w2]] = band.banks;
    const share = narrowShare(band);
    expect(share).toBeCloseTo((s1 * w1) / (s1 * w1 + s2 * w2), 12);
    // Two banks of one weight: the wider holds as many more stars as it is wider.
    expect(
      narrowShare({
        ...band,
        banks: [
          [2, 0.5],
          [6, 0.5],
        ],
      }),
    ).toBeCloseTo(0.25, 12);
    // Two banks of one width: by their weights.
    expect(
      narrowShare({
        ...band,
        banks: [
          [3, 0.9],
          [3, 0.1],
        ],
      }),
    ).toBeCloseTo(0.9, 12);
    // Stars drawn that often from each bank (a Gaussian of deviation sigma / sqrt 2) are as
    // dense, at every distance from the middle, as the haze is bright: one constant between.
    const density = (yy: number): number =>
      (share / s1) * Math.exp(-((yy / s1) ** 2)) + ((1 - share) / s2) * Math.exp(-((yy / s2) ** 2));
    const k = density(0) / profileAt(band, 0);
    for (const yy of [0.5, 2, 5, 9, 15]) {
      expect(density(yy) / profileAt(band, yy)).toBeCloseTo(k, 12);
    }
    // By weight alone (half and half here) the narrow bank would hold too many: a hard core.
    expect(share).toBeLessThan(w1 / (w1 + w2));
  });

  it('swells into a bulge: an oval on its middle, round one longitude', () => {
    const { lonDeg, sigmaDeg } = band.core;
    const [along, across] = sigmaDeg;
    expect(bulgeAt(band, lonDeg, 0)).toBe(1);
    expect(bulgeAt(band, lonDeg + along, 0)).toBeCloseTo(1 / Math.E, 12);
    expect(bulgeAt(band, lonDeg - along, 0)).toBeCloseTo(1 / Math.E, 12);
    expect(bulgeAt(band, lonDeg, across)).toBeCloseTo(1 / Math.E, 12);
    expect(bulgeAt(band, lonDeg, -across)).toBeCloseTo(1 / Math.E, 12);
    expect(bulgeAt(band, lonDeg + along, across)).toBeCloseTo(Math.exp(-2), 12);
    expect(bulgeAt(band, lonDeg + 180, 0)).toBeLessThan(1e-12);
    expect(bulgeAt(band, lonDeg, 40)).toBeLessThan(1e-12);
    // It lies along the river, and is round enough to be a bulge and not a streak of it (a
    // glow three and more times as long as it was wide read as a smear).
    expect(along).toBeGreaterThan(across);
    expect(along / across).toBeLessThan(2);
  });

  it('has no seam: every term comes round to itself where the longitude wraps', () => {
    // The shader's longitude jumps from 180 to -180 degrees on one line of the sky.
    expect(meanderAt(band, Math.PI)).toBeCloseTo(meanderAt(band, -Math.PI), 12);
    expect(laneAt(band, Math.PI, 1.3)).toBeCloseTo(laneAt(band, -Math.PI, 1.3), 12);
    expect(clumpAt(band, 180)).toBeCloseTo(clumpAt(band, -180), 12);
    expect(clumpAt(band, 359.5)).toBeCloseTo(clumpAt(band, -0.5), 12);
    // A bulge that sits on the wrap is whole on both sides of it.
    const wrapped: SkyBand = { ...band, core: { ...band.core, lonDeg: 178 } };
    expect(bulgeAt(wrapped, -177, 1)).toBeCloseTo(bulgeAt(wrapped, 173, 1), 12);
    expect(bulgeAt(wrapped, 180, 0)).toBeCloseTo(bulgeAt(wrapped, -180, 0), 12);
    expect(bulgeAt(wrapped, 183, 0)).toBeGreaterThan(0.5);
    // A clump whose reach crosses the wrap is whole on both sides of it.
    const across: SkyBand = { ...plain, clumps: [[355, 10, 0.5]] };
    expect(clumpAt(across, 5)).toBeCloseTo(clumpAt(across, 345), 12);
    expect(clumpAt(across, 0)).toBeCloseTo(0.25 + 0.5 * Math.exp(-0.25), 12);
  });
});
