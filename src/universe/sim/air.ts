import { clamp, smoothstep } from './math';
import type { Rgb } from './meshBuilder';

/**
 * THE CPU TWIN OF A WORLD'S AIR: what the shaders draw on a world with air ("Deep light",
 * docs/DESIGN.md), as numbers a test can hold. Two shaders read the same look:
 *
 *   the ground   design/shaders/toonFlat.ts, AIR: the three bands of light (lit exactly its
 *                colour, a warm dusk, a cool night that is never black) and the tint toward the
 *                air's colour near the limb (`airShade`, `limbTint`)
 *   the shell    design/shaders/air.ts: flat rings of air outside the outline, dimmed toward
 *                the night (`shellAlpha`), and a hairline whose colour runs round the limb
 *                (`alongStops`)
 *
 * The shaders soften every edge by a pixel; here an edge is where it is. NOTHING THE ENGINE
 * SHIPS IMPORTS THIS but the types. Pure.
 */

/** `tuning.look.air`, as far as the ground's shader reads it. */
export interface AirLook {
  /** Multipliers on shading.dusk and shading.night. */
  readonly bands: { readonly dusk: number; readonly night: number };
  readonly limb: {
    readonly power: number;
    readonly lit: number;
    readonly always: number;
    readonly litEdges: readonly [number, number];
    readonly steps: number;
    readonly topRadii: readonly [number, number];
  };
}

/** `tuning.look.air.shell`. */
export interface ShellLook {
  readonly rings: ReadonlyArray<readonly [inner: number, outer: number, alpha: number]>;
  readonly lowRings: number;
  readonly mask: ReadonlyArray<readonly [deg: number, value: number]>;
}

/** The colours of a world's air, linear: its air, and the multipliers of its bands. */
export interface AirColors {
  readonly air: Rgb;
  /** The middle band's multiplier (design/materials.ts, `airBands`). */
  readonly dusk: Rgb;
  /** The shade band's: shading.night times `bands.night`. */
  readonly night: Rgb;
  /** The shade band's of everything without air: shading.shadow. */
  readonly shadow: Rgb;
}

/** `tuning.shading`, as far as the bands read it. */
export interface BandLook {
  /** The two facings between which a place is in the middle band (x < y). */
  readonly bandEdges: readonly [number, number];
  /** How lit the middle band of a world without air is, 0 to 1. */
  readonly midLevel: number;
}

/** A place on a world, as its light sees it. */
export interface AirPlace {
  /** The surface's normal against the direction to its light, -1 to 1. */
  readonly facing: number;
  /** The BALL's normal there against the direction to the camera: 1 mid-disc, 0 on the outline. */
  readonly nz: number;
  /** The ball's normal there against the direction to its light. */
  readonly ballFacing: number;
  /** How far the place is from the world's centre, in its radii. 1 when left out: on the ground. */
  readonly height?: number;
}

const times = (a: Rgb, b: Rgb): Rgb => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** How much a place is in the air, 1 on the ground to 0 above it. */
export function inAir(place: AirPlace, look: AirLook): number {
  const [from, to] = look.limb.topRadii;
  return 1 - smoothstep(from, to, place.height ?? 1);
}

/**
 * How much of a place's colour is its air's, 0 to 1: nothing where the ball faces the camera,
 * the most on its outline, in `steps` flat levels; strong toward the light and faint at night.
 */
export function limbTint(place: AirPlace, look: AirLook): number {
  const { power, lit, always, litEdges, steps } = look.limb;
  const limb = Math.pow(1 - clamp(place.nz, 0, 1), power);
  // Cut into flat levels: 0 below the first cut, 1 above the last.
  let level = 0;
  for (let i = 0; i < steps; i += 1) if (limb > (i + 0.5) / steps) level += 1 / steps;
  const sunlit = smoothstep(litEdges[0], litEdges[1], place.ballFacing);
  return clamp(level * (lit * sunlit + always) * inAir(place, look), 0, 1);
}

/**
 * The colour of a place on a world with air: `base` where it is lit (exactly), `base` times the
 * dusk in the middle band and times the night in the shade, then tinted toward the air near the
 * limb. What stands above the air takes the plain bands of everything without air instead.
 * `flatness` 1 (the star map) is `base` everywhere.
 */
export function airShade(
  base: Rgb,
  place: AirPlace,
  colors: AirColors,
  look: AirLook,
  shading: BandLook,
  flatness = 0,
): Rgb {
  const [low, high] = shading.bandEdges;
  const day = place.facing > high;
  const dusk = place.facing > low;
  const air = day ? base : times(base, dusk ? colors.dusk : colors.night);
  const plain = mix(times(base, colors.shadow), base, day ? 1 : dusk ? shading.midLevel : 0);
  const shaded = mix(mix(plain, air, inAir(place, look)), base, flatness);
  return mix(shaded, colors.air, limbTint(place, look) * (1 - flatness));
}

/** A value along stops [[at, value], ...] in rising order: linear between two, held outside them. */
export function alongStops(stops: ReadonlyArray<readonly [number, number]>, at: number): number {
  const [first] = stops;
  if (!first) return 0;
  let [from, value] = first;
  for (const [to, next] of stops) {
    if (at <= to) return to > from ? value + ((next - value) * (at - from)) / (to - from) : next;
    from = to;
    value = next;
  }
  return value;
}

/**
 * How much air there is at `r` world radii from the centre of the disc, `deg` degrees round the
 * limb from where its light comes from: the ring `r` lies in, dimmed toward the night. `low`:
 * the low tier's fewer rings.
 */
export function shellAlpha(r: number, deg: number, look: ShellLook, low = false): number {
  const rings = low ? look.rings.slice(0, look.lowRings) : look.rings;
  const ring = rings.find(([inner, outer]) => r >= inner && r < outer);
  return ring ? ring[2] * alongStops(look.mask, Math.abs(deg)) : 0;
}
