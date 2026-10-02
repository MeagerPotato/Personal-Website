import type { GroundSpec } from '../../sim/world/ground';
import type { Vec2 } from '../../sim/world/kit';
import type { ThemeKey } from '../tokens';

/**
 * Small helpers the rows of more than one system use. Everything here is arithmetic on
 * numbers: a colour is always a token path, resolved by sim/world/palette.ts.
 */

/** Degrees to radians. */
export const rad = (deg: number): number => (deg * Math.PI) / 180;

/** The i-th entry of a table a row repeats over (an index past its end is a bug in the rows). */
export function nth<T>(list: readonly T[], i: number): T {
  const entry = list[i];
  if (entry === undefined) throw new RangeError(`nth: no entry ${i} in a list of ${list.length}`);
  return entry;
}

/** A rectangle 2w x 2h with its corners cut by c: a plinth, a phone. Eight points, round in order. */
export const cutRect = (w: number, h: number, c: number): Vec2[] => [
  [-w + c, -h],
  [w - c, -h],
  [w, -h + c],
  [w, h - c],
  [w - c, h],
  [-w + c, h],
  [-w, h - c],
  [-w, -h + c],
];

/** A sun's ball in its family's colours, seeded as the concept art was. */
export const sunGround = (family: ThemeKey): GroundSpec => ({
  seed: `sun-${family}`,
  sun: family,
  recipe: 'sun',
});
