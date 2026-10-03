import { noise3 } from './gradientNoise';
import type { Point } from './meshBuilder';
import { SUN_RING_RADII, SUN_TONE, type SunSurfaceLook } from './sunSurface';

/**
 * THE CPU TWIN OF A SUN'S SURFACE: what the sun's shader (design/shaders/toonFlat.ts, SUN) draws
 * at a place on its ball, as numbers a test can hold. The shader evaluates the very same noise
 * (design/shaders/noise.ts: gradient noise on an integer lattice, hashed with pcg3d, which gives
 * the same lattice on every driver; its twin is sim/gradientNoise.ts) and the same cuts, so the
 * shares measured here are the picture's. NOTHING THE ENGINE SHIPS IMPORTS THIS.
 *
 * `n` is a unit direction in the sun's own space; `offset` the sun's place in the noise
 * (sim/sunSurface.ts, `sunOffset`). Pure.
 */

/** Where the fine layer is cut from, beside the coarse one (the shader's SUN_FINE). */
export const SUN_FINE_OFFSET: Point = [2.2, 7.1, 1.3];

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The granulation at a place: two layers of smooth noise, about -1 to 1. */
export function sunGrain(n: Point, offset: Point, look: SunSurfaceLook): number {
  const { freq, weight, freq2 } = look.granulation;
  return (
    weight * noise3(n[0] * freq + offset[0], n[1] * freq + offset[1], n[2] * freq + offset[2]) +
    (1 - weight) *
      noise3(
        n[0] * freq2 + offset[0] + SUN_FINE_OFFSET[0],
        n[1] * freq2 + offset[1] + SUN_FINE_OFFSET[1],
        n[2] * freq2 + offset[2] + SUN_FINE_OFFSET[2],
      )
  );
}

/**
 * How far up the ladder a grain is, 0 (shade) to 3 (hot): a whole number inside a cell, and in
 * between across the soft edge of two (`soft`: half that edge's width, never thinner than a
 * pixel in the shader).
 */
export function sunLevel(
  grain: number,
  look: SunSurfaceLook,
  soft = look.granulation.soft,
): number {
  return look.granulation.thresholds.reduce(
    (level, cut) => level + smoothstep(cut - soft, cut + soft, grain),
    0,
  );
}

/** How much of a place is a spot's ring, and its core, 0 to 1 each (soft at their rims). */
export function sunSpot(
  n: Point,
  look: SunSurfaceLook,
  soft = look.softSpotRad,
): { ring: number; core: number } {
  let ring = 0;
  let core = 0;
  for (const spot of look.spots) {
    const [x, y, z] = spot.normal;
    const cos = (n[0] * x + n[1] * y + n[2] * z) / Math.hypot(x, y, z);
    const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
    ring = Math.max(ring, 1 - smoothstep(-soft, soft, angle - spot.radius * SUN_RING_RADII));
    core = Math.max(core, 1 - smoothstep(-soft, soft, angle - spot.radius));
  }
  return { ring, core };
}

/** How many tones the limb takes off, 0 to 2, where the ball faces the camera by `facing`. */
export function sunLimb(facing: number, look: SunSurfaceLook, soft = look.softLimb): number {
  return look.limbNz.reduce(
    (down, edge) => down + 1 - smoothstep(edge - soft, edge + soft, facing),
    0,
  );
}

/** The tone (SUN_TONE) at the heart of a place: which cell it is in, seen face on. */
export function sunTone(n: Point, offset: Point, look: SunSurfaceLook): number {
  const { ring, core } = sunSpot(n, look);
  if (core >= 0.5) return SUN_TONE.core;
  if (ring >= 0.5) return SUN_TONE.ring;
  return Math.round(sunLevel(sunGrain(n, offset, look), look, 1e-9));
}
