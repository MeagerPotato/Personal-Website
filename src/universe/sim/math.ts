import type { Vec2 } from './types';

/**
 * The one angle convention of the universe (see sim/types.ts): counter-clockwise seen from above,
 * 0 along +Z, so the unit vector at angle a is (sin a, cos a). Headings, orbit phases and camera
 * azimuths all go through here, so they cannot disagree.
 */

export const TAU = Math.PI * 2;

export function unitX(angle: number): number {
  return Math.sin(angle);
}

export function unitZ(angle: number): number {
  return Math.cos(angle);
}

/** The angle of a direction on the flight plane. Inverse of (unitX, unitZ). */
export function angleOf(x: number, z: number): number {
  return Math.atan2(x, z);
}

export function pointAt(center: Vec2, radius: number, angle: number, out: Vec2): Vec2 {
  out.x = center.x + radius * Math.sin(angle);
  out.z = center.z + radius * Math.cos(angle);
  return out;
}

/** Shortest signed turn from `from` to `to`, in (-PI, PI]. Positive is counter-clockwise. */
export function angleDelta(from: number, to: number): number {
  let delta = (to - from) % TAU;
  if (delta > Math.PI) delta -= TAU;
  else if (delta <= -Math.PI) delta += TAU;
  return delta;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** 0 below `edge0`, 1 above `edge1`, a smooth S-curve between. Edges may be given in either order. */
export function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Ease `current` toward `target` at `ratePerSec`, EXACTLY over `dt` seconds: two half steps land
 * where one whole step does, so the ease looks the same at any frame rate. After 1 / ratePerSec
 * seconds about 63% of the gap is closed.
 */
export function approach(current: number, target: number, ratePerSec: number, dt: number): number {
  if (!(ratePerSec > 0) || !(dt > 0)) return current;
  return target + (current - target) * Math.exp(-ratePerSec * dt);
}
