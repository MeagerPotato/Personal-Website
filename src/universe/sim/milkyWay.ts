import type { SkyBand } from '../design/lookTypes';
import { frameOf, wrapDeg } from './skyDirections';

/**
 * THE MILKY WAY'S SHAPE: a river along a great circle of the sky. Its haze is baked into the
 * sky's panorama (design/shaders/skyBake.ts; the CPU twin is sim/skyOracle.ts) and its stars are
 * laid by the star list (sim/starList.ts), both from these functions of `tuning.look.sky.band`,
 * so the stars lie where the haze is, crowd where it swells (the bulge) and thin out where the
 * dark lane runs. The lane is in the stars alone: the haze is never darkened.
 *
 * All of it is closed form: sums of sines and Gaussians along and across the circle. No noise
 * and no levels, so nothing in it has an edge. The shader writes the same expressions in GLSL:
 * CHANGE THEM TOGETHER (the lab's `sky` subject compares the two texel by texel).
 *
 * A place on the river is a longitude `phi` round the circle (radians, 0 along `b1`, growing
 * toward `b2`) and a latitude off it (degrees, positive toward the pole).
 */

type Vec3 = [number, number, number];

/** The circle's pole, and the two unit vectors in its plane that longitude is measured from. */
export function bandFrame(band: SkyBand): { pole: Vec3; b1: Vec3; b2: Vec3 } {
  const { c, e1, e2 } = frameOf(band.poleAzDeg, 90 - band.tiltDeg);
  return { pole: c, b1: e1, b2: e2 };
}

/** How far the river's middle is off the circle at a longitude, degrees. */
export function meanderAt(band: SkyBand, phi: number): number {
  const [a1, p1, a2, p2] = band.meanderDeg;
  return a1 * Math.sin(2 * phi + p1) + a2 * Math.sin(5 * phi + p2);
}

/** The river's cross-section `yy` degrees off its middle: a narrow bank and a wide one. */
export function profileAt(band: SkyBand, yy: number): number {
  const [[s1, w1], [s2, w2]] = band.banks;
  return w1 * Math.exp(-(yy / s1) * (yy / s1)) + w2 * Math.exp(-(yy / s2) * (yy / s2));
}

/** How bright the river is along its length, at a longitude in degrees: its base and its clumps. */
export function clumpAt(band: SkyBand, lonDeg: number): number {
  let sum = band.base;
  for (const [lon, sigma, weight] of band.clumps) {
    const d = wrapDeg(lonDeg - lon) / sigma;
    sum += weight * Math.exp(-d * d);
  }
  return sum;
}

/** The most `clumpAt` comes to, looked for a degree at a time. */
export function clumpPeak(band: SkyBand): number {
  let peak = 0;
  for (let lon = 0; lon < 360; lon += 1) peak = Math.max(peak, clumpAt(band, lon));
  return peak;
}

/** How much of the dark lane a place is in, 0 to 1: `yy` degrees off the river's middle. */
export function laneAt(band: SkyBand, phi: number, yy: number): number {
  const { offsetDeg, widthDeg } = band.lane;
  const middle =
    offsetDeg[0] + offsetDeg[1] * Math.sin(3 * phi + 0.7) + offsetDeg[2] * Math.sin(7 * phi + 2.1);
  const width = widthDeg[0] + widthDeg[1] * Math.sin(4 * phi + 1.3);
  return Math.exp(-((yy - middle) / width) * ((yy - middle) / width));
}

/**
 * The share of the river's stars that belong to its narrow bank. A bank's stars are in
 * proportion to its MASS (its weight times its width), not to its weight alone: only then is
 * the stars' cross-section the haze's (`profileAt`), whose two banks have peaks in the ratio of
 * their weights.
 */
export function narrowShare(band: SkyBand): number {
  const [[s1, w1], [s2, w2]] = band.banks;
  return (s1 * w1) / (s1 * w1 + s2 * w2);
}

/**
 * The bulge, 0 to 1: an oval on the river's middle, at a longitude in degrees and `yy` degrees
 * off the middle. 1 at its heart.
 */
export function bulgeAt(band: SkyBand, lonDeg: number, yy: number): number {
  const [along, across] = band.core.sigmaDeg;
  const a = wrapDeg(lonDeg - band.core.lonDeg) / along;
  const b = yy / across;
  return Math.exp(-(a * a + b * b));
}
