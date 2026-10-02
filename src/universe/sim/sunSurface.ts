import type { Point, Rgb } from './meshBuilder';
import { fbm, type Noise3 } from './noise';
import { hashSeed } from './rng';

/**
 * A LIVING SUN'S SURFACE ("Deep light", docs/DESIGN.md): which TONE each facet of a sun's ball
 * takes. Granulation is two layers of noise (the planets' own, sim/noise.ts, seeded by the sun)
 * cut into four flat tones (shade, base, light, hot) by three thresholds, chosen so that the
 * middle facet is the family's base and the ball does not wash out to cream; three spots sit at
 * fixed places on it, a dark core inside a ring. Decided once, when the ball is generated: no
 * noise runs while it is drawn.
 *
 * The tone rides to the shader in the lighting flag every vertex already has (`toneUnlit`), and
 * its colour is one of a LADDER of six made from the family's three tokens (`sunLadder`), down
 * which the shader steps a facet near the limb (design/shaders/toonFlat.ts, SUN).
 *
 * Pure: the numbers come in as `SunSurfaceLook` (design/tuning.ts, `look.sun`).
 */

/** The ladder, darkest first, and then the two shades of a spot (which the limb leaves alone). */
export const SUN_TONE = { shade: 0, base: 1, light: 2, hot: 3, ring: 4, core: 5 } as const;
export const SUN_TONE_COUNT = 6;

/** A spot's two shades are the family's shade, this much of it. */
const SPOT = { ring: 0.86, core: 0.5 } as const;
/** A spot's ring reaches this many of its radii. */
const RING_RADII = 1.5;

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
  };
  /** Unit normals in the sun's own space (nearly unit: they are normalised here), radians. */
  readonly spots: ReadonlyArray<{ readonly normal: Point; readonly radius: number }>;
}

/** A sun's own number, from its name: how its rays and its loops lie (design/shaders/corona.ts). */
export function sunSeed(name: string): number {
  return (hashSeed(name) / 4294967296) * 10;
}

/**
 * The tone (SUN_TONE) of a facet whose unit normal, in the sun's own space, is `n`. `noise` is
 * the sun's own (sim/noise.ts, `createNoise3` of its seed).
 */
export function sunTone(n: Point, noise: Noise3, look: SunSurfaceLook): number {
  for (const spot of look.spots) {
    const [x, y, z] = spot.normal;
    const cos = (n[0] * x + n[1] * y + n[2] * z) / Math.hypot(x, y, z);
    const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
    if (angle < spot.radius) return SUN_TONE.core;
    if (angle < spot.radius * RING_RADII) return SUN_TONE.ring;
  }
  const { freq, weight, freq2, thresholds } = look.granulation;
  const grain =
    weight * fbm(noise, n[0] * freq, n[1] * freq, n[2] * freq, 3) +
    (1 - weight) * fbm(noise, n[0] * freq2 + 2.2, n[1] * freq2 + 7.1, n[2] * freq2 + 1.3, 2);
  return grain < thresholds[0]
    ? SUN_TONE.shade
    : grain < thresholds[1]
      ? SUN_TONE.base
      : grain < thresholds[2]
        ? SUN_TONE.light
        : SUN_TONE.hot;
}

/**
 * A tone as the lighting flag of its facet (sim/world/kit.ts, `Unlit`): 6, 10, 14... Every reader
 * of the flag asks "above a half?" (takes no light) and "above one and a half?" (glows, and
 * blooms), which all of these are, so a sun's facet is still plain glow to everything but the sun
 * shader, which reads the tone back as `floor(flag / 4) - 1`. A plain 2 (a lamp, a gear of the
 * Hardware sun) reads back as -1: no tone, its own colour.
 */
export const toneUnlit = (tone: number): number => 2 + 4 * (tone + 1);

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
