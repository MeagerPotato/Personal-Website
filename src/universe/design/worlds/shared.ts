import type { GroundSpec } from '../../sim/world/ground';
import type { Vec2 } from '../../sim/world/kit';
import type { ColorPath } from '../../sim/world/palette';
import type { Item } from '../../sim/world/rows';
import type { LampToken } from '../lookTypes';
import type { ThemeKey } from '../tokens';
import { tuning } from '../tuning';

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

/** A lamp's token (design/tuning.ts, `look.lamps`) as the rows name a colour. */
const lampPath = (token: LampToken): ColorPath => (token === 'window' ? 'lamp.window' : token);

/** The colour of a lit window: a pane with a lamp behind it. Flat, and never on the bloom guest list. */
export const WINDOW: ColorPath = lampPath(tuning.look.lamps.windowToken);

/**
 * A beacon: a small round lamp on the tip of a mast or a dish, so that a built thing is found in
 * the dark. Flat (its colour as it is, whatever the light), and never on the bloom guest list:
 * it is lit, it is not a light.
 */
export const beacon = (at: readonly [number, number, number]): Item => [
  'bead',
  tuning.look.lamps.beaconRadius,
  lampPath(tuning.look.lamps.beaconToken),
  { at, g: 1 },
];

/** A sun's ball in its family's colours, seeded as the concept art was. */
export const sunGround = (family: ThemeKey): GroundSpec => ({
  seed: `sun-${family}`,
  sun: family,
  recipe: 'sun',
});
