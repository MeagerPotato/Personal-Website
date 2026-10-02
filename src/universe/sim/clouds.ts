import type { Point } from './meshBuilder';
import { hashSeed } from './rng';
import { fbm3 } from './skyNoise';

/**
 * THE CPU TWIN OF A WORLD'S CLOUDS: what the cloud shader (design/shaders/air.ts) draws at a
 * place on the skin, as numbers a test can hold. The shader evaluates the very same noise
 * (design/shaders/noise.ts; its twin is sim/skyNoise.ts) and the same cuts, so the shares
 * measured here are the picture's. NOTHING THE ENGINE SHIPS IMPORTS THIS but the types and
 * `cloudCut`, `cloudSeed` and `cloudOffset`, which lay a world's clouds out for the shader.
 *
 * `n` is a unit direction in the skin's own space. Pure.
 */

/** `tuning.look.air.cloud`, as far as the field reads it. */
export interface CloudLook {
  readonly threshold: number;
  readonly shareGain: number;
  readonly noiseWeight: number;
  readonly bandWeight: number;
  readonly bandFreq: number;
  readonly freq: Point;
  readonly octaves: number;
  readonly core: number;
}

/** The domain offset of the clouds' fractal sum (sim/skyNoise.ts, `fbm3`): the shader's CLOUD_OFFSET. */
export const CLOUD_FBM_OFFSET = 1;

/** A world's own number, from its name: where in the noise its clouds are cut from. Under 10. */
export function cloudSeed(name: string): number {
  return (hashSeed(`${name}/clouds`) / 4294967296) * 10;
}

/** Where in the noise a world's clouds are: its own place, from its number. */
export const cloudOffset = (seed: number): Point => [seed, 0.4 * seed, 0.9 * seed];

/** The field at a place: a fractal noise, stretched along the latitudes, plus a latitude band. */
export function cloudField(n: Point, seed: number, look: CloudLook): number {
  const [ox, oy, oz] = cloudOffset(seed);
  const [fx, fy, fz] = look.freq;
  return (
    look.noiseWeight *
      fbm3(n[0] * fx + ox, n[1] * fy + oy, n[2] * fz + oz, look.octaves, CLOUD_FBM_OFFSET) +
    look.bandWeight * (0.5 + 0.5 * Math.cos(look.bandFreq * n[1] + seed))
  );
}

/** What the field must pass for a place to be cloud, for a sky of which `share` (0 to 1) is asked. */
export const cloudCut = (share: number, look: CloudLook): number =>
  look.threshold - look.shareGain * share;

/** 0 clear sky, 1 a cloud's thin edge, 2 its body. */
export function cloudAt(n: Point, seed: number, share: number, look: CloudLook): 0 | 1 | 2 {
  const field = cloudField(n, seed, look);
  const cut = cloudCut(share, look);
  return field >= cut + look.core ? 2 : field >= cut ? 1 : 0;
}
