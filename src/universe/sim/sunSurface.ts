import type { Point, Rgb } from './meshBuilder';
import { hashSeed } from './rng';

/**
 * A LIVING SUN'S SURFACE ("Deep light", docs/DESIGN.md): a sun is LIGHT, and light may be smooth.
 * Its ball's tones are not its facets': they are drawn PER PIXEL by the sun's own shader
 * (design/shaders/toonFlat.ts, SUN) as round, soft-edged cells of smooth noise on the sphere, cut
 * into four flat tones (shade, base, light, hot) by three thresholds so that the middle of the
 * ball is the family's base and it does not wash out to cream; three spots sit at fixed places
 * on it, a dark core inside a ring; and toward the limb the tones step down the ladder in round
 * bands. No facet edge shows anywhere on it.
 *
 * What is decided here is what the shader is handed: the LADDER of six colours made from the
 * family's three tokens (`sunLadder`), the sun's own place in the noise (`sunOffset` of its
 * seed), and the flag every facet of the ball carries so that the shader knows the surface from
 * the signs a sun wears (`SUN_SURFACE`). The CPU twin of the shader's picture, which the tests
 * hold to its shares, is sim/sunGrain.ts; nothing the engine ships imports that.
 *
 * Pure: the numbers come in as `SunSurfaceLook` (design/tuning.ts, `look.sun`).
 */

/** The ladder, darkest first, and then the two shades of a spot (which the limb leaves alone). */
export const SUN_TONE = { shade: 0, base: 1, light: 2, hot: 3, ring: 4, core: 5 } as const;
export const SUN_TONE_COUNT = 6;

/** A spot's two shades are the family's shade, this much of it. */
const SPOT = { ring: 0.86, core: 0.5 } as const;
/** A spot's ring reaches this many of its radii (the shader's SUN_RING: a test holds them equal). */
export const SUN_RING_RADII = 1.5;

export interface SunSurfaceLook {
  /** The hottest tone is the family's light mixed this far toward white. */
  readonly hotMix: number;
  readonly granulation: {
    /** The coarse noise's frequency on the unit sphere, and its share of the sum. */
    readonly freq: number;
    readonly weight: number;
    readonly freq2: number;
    /** shade | base | light | hot. */
    readonly thresholds: readonly [number, number, number];
    /** Half the width of the soft edge between two tones, in the noise's own units. */
    readonly soft: number;
  };
  /** Limb darkening: where the ball is turned this far from the camera it is two, then one, tone darker. */
  readonly limbNz: readonly [number, number];
  /** Half the width of the soft edge of a limb band (in facing, 0 to 1) and of a spot (radians). */
  readonly softLimb: number;
  readonly softSpotRad: number;
  /** Unit normals in the sun's own space (nearly unit: they are normalised), radians. */
  readonly spots: ReadonlyArray<{ readonly normal: Point; readonly radius: number }>;
}

/** A sun's own number, from its name: how its rays and its loops lie (design/shaders/corona.ts). */
export function sunSeed(name: string): number {
  return (hashSeed(name) / 4294967296) * 10;
}

/** Where in the noise a sun's surface is cut from: its own place, from its number. */
export function sunOffset(seed: number): Point {
  return [seed, 0.4 * seed, 0.9 * seed];
}

/**
 * The lighting flag of every facet of a living sun's ball (sim/world/kit.ts, `Unlit`): 6 and the
 * sun's own number above it (`sunSeed`, under 10). Every reader of the flag asks "above a half?"
 * (takes no light) and "above one and a half?" (glows, and blooms), which this is, so a sun's
 * facet is plain glow to everything but the sun's shader, which asks "above four?": the surface,
 * whose tones it draws, at the place in the noise its number says (so two suns of one family,
 * which share a material, are still two suns). A plain 2 (a lamp, a gear of the Hardware sun, a
 * sun's sign) keeps its own colour.
 */
export const SUN_SURFACE = 6;
export const sunFlag = (seed: number): number => SUN_SURFACE + seed;

/** The six colours of a sun (linear RGB), by tone, from its family's three. */
export function sunLadder(
  family: { readonly shade: Rgb; readonly base: Rgb; readonly light: Rgb },
  hotMix: number,
): Rgb[] {
  const { shade, base, light } = family;
  const scaled = (k: number): Rgb => [shade[0] * k, shade[1] * k, shade[2] * k];
  const hot: Rgb = [
    light[0] + (1 - light[0]) * hotMix,
    light[1] + (1 - light[1]) * hotMix,
    light[2] + (1 - light[2]) * hotMix,
  ];
  return [shade, base, light, hot, scaled(SPOT.ring), scaled(SPOT.core)];
}
