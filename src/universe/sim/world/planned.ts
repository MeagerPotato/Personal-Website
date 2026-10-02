import type { ThemeKey } from '../../design/tokens';
import { TAU } from '../math';
import type { PlanetShape } from '../planet';
import type { Radii } from './kit';
import { FLAG, type Item, type PartRow } from './rows';

/**
 * THE PLANNED KIT: how work that is not built yet looks, the same way everywhere. A planned body
 * is primer-grey clay with NOTHING of its future painted on (tokens.ts, `biome.primer`); what
 * says "planned" is the site round it:
 *
 *   final-size-ring  dashes of the family's colour at the size it WILL be (a fact where there is
 *                    one: Corgi's twelve hours, Fish Online's six seats)
 *   crane            a tower crane, its beacon glowing: the kit's signature, and its one motion
 *   paint-chip       a white card on a stake with the family's light, base and shade: the colour
 *                    it will be, as on a hardware-store card, and not progress
 *   debris           loose pebbles of clay, the same scatter every time
 *
 * and the parts still to come are GHOSTS (FLAG.ghost): drawn as a blueprint, with their edges as
 * lines (glue.ts, `wire`). Each builder returns rows, so a body uses the kit by spreading it into
 * its own list of parts.
 */

/** A tower crane, 1 u tall, +Y up. */
export const crane = (family: ThemeKey): Item => [
  'g',
  ['box', 0.06, 0.7, 0.06, `${family}.light`, { at: [0, 0.35, 0] }],
  ['box', 0.66, 0.045, 0.045, `${family}.base`, { at: [0.2, 0.72, 0] }],
  ['box', 0.2, 0.06, 0.06, 'ink.low', { at: [-0.22, 0.72, 0] }],
  ['box', 0.09, 0.09, 0.09, 'ink.low', { at: [-0.3, 0.66, 0] }],
  ['box', 0.012, 0.22, 0.012, 'ink.low', { at: [0.42, 0.6, 0] }],
  ['box', 0.06, 0.05, 0.06, `${family}.base`, { at: [0.42, 0.48, 0] }],
  ['bead', 0.05, 'star.warm', { at: [0, 0.8, 0], g: 2 }],
];

/**
 * A paint chip on a stake: a white card with the family's light, base and shade as three bands.
 * The stake stands behind the card and stops at its middle: through it, it would show as a line
 * across the swatch.
 */
export const chip = (family: ThemeKey): Item => [
  'g',
  ['cyl', 0.012, 0, 0.42, 4, 'ink.mid', { at: [0, 0, -0.02] }],
  ['box', 0.2, 0.3, 0.012, 'ink.high', { at: [0, 0.42, 0] }],
  ['box', 0.15, 0.075, 0.016, `${family}.light`, { at: [0, 0.505, 0] }],
  ['box', 0.15, 0.075, 0.016, `${family}.base`, { at: [0, 0.42, 0] }],
  ['box', 0.15, 0.075, 0.016, `${family}.shade`, { at: [0, 0.335, 0] }],
];

/** n dashes of the family's colour round a finished-size outline, from bearing a0 to a1. */
export const dashes = (
  family: ThemeKey,
  radii: Radii,
  n: number,
  a0 = 0,
  a1 = TAU,
  steps = n < 10 ? 4 : 2,
): Item[] =>
  Array.from({ length: n }, (_, i): Item => {
    const start = a0 + ((a1 - a0) * i) / n;
    return ['ring', radii, start, start + ((a1 - a0) / n) * 0.56, steps, 0, 0, `${family}.base`];
  });

/** Loose pebbles of clay round a body: no random numbers, so the same scatter every time. */
export const pebbles = (n: number, r: number, y = 0): Item => [
  'around',
  n,
  0.3,
  r,
  y,
  0,
  (i) => [
    'bead',
    0.05 + (i % 3) * 0.012,
    'biome.primer.high',
    {
      at: [(((i * 5) % 3) - 1) * 0.1, (((i * 7) % 5) - 2) * 0.1, (((i * 3) % 4) - 1.5) * 0.08],
      rot: [i, 2 * i, 0],
    },
  ],
];

export interface PlannedKit {
  /** How many dashes the final-size ring has. */
  readonly n?: number;
  /** The final-size ring's radii, or the outline as a function of the bearing. */
  readonly r?: Radii;
  /** Where the crane stands: latitude and longitude, degrees. */
  readonly crane?: readonly [lat: number, lon: number];
  /** Where the paint chip stands, and how it is turned (radians about its stake). */
  readonly chip?:
    readonly [lat: number, lon: number] | readonly [lat: number, lon: number, spin: number];
  /** How many pebbles, and on what radius. */
  readonly debris?: number;
  readonly pr?: number;
  /** The ground's shape, when it is not round: the crane and the chip stand on it (a loaf). */
  readonly shape?: PlanetShape;
}

/** The shared parts of a planned body, to spread into its list of parts. */
export function planned(
  family: ThemeKey,
  {
    n = 14,
    r = [1.46, 1.54],
    crane: [craneLat, craneLon] = [50, 210],
    chip: chipAt = [70, 20],
    debris = 6,
    pr = 1.4,
    shape,
  }: PlannedKit = {},
): PartRow[] {
  const on = shape ? { shape } : {};
  return [
    ['final-size-ring', FLAG.hold, ...dashes(family, r, n)],
    ['crane', 0, ['s', craneLat, craneLon, { s: 0.8, spin: 0.5, ...on }, crane(family)]],
    ['paint-chip', 0, ['s', chipAt[0], chipAt[1], { spin: chipAt[2] ?? 0.4, ...on }, chip(family)]],
    ['debris', FLAG.hold, pebbles(debris, pr)],
  ];
}
