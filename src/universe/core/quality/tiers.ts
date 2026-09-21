/**
 * QUALITY TIERS (docs/PLAN.md, Appendix A). On a phone the budget is pixels and memory
 * bandwidth, so a tier is mostly "how many pixels, and what is done to them". The values live in
 * design/tuning.ts; this file owns their shape and the rules for choosing one.
 *
 * Two rules keep tiers boring in the good sense. A tier is chosen BEFORE the renderer exists,
 * because whether a canvas is anti-aliased is decided when its WebGL context is created; changing
 * tier therefore means a new engine on a new canvas (api.ts, the same path as a lost context).
 * And the engine never promotes itself: a device that once needed a lower tier starts there.
 */
export type QualityTier = 'low' | 'medium' | 'high';

/** Lowest first. */
export const TIERS: readonly QualityTier[] = ['low', 'medium', 'high'];

export interface TierSettings {
  /** The device pixel ratio is capped at this ... */
  readonly maxPixelRatio: number;
  /** ... and the drawing buffer at this many megapixels, whatever the screen. */
  readonly maxMegapixels: number;
  /**
   * Post-processing (fx/PostFX.ts): bloom, vignette, and anti-aliasing done on its own render
   * target. Without it the scene goes straight to the canvas, anti-aliased by the canvas itself.
   */
  readonly post: boolean;
  /** Anti-aliasing samples: 0 (none), 2 or 4. */
  readonly msaaSamples: number;
  /** On touch devices, frames per second are capped at this. 0 = whatever the display does. */
  readonly maxFpsCoarse: number;
}

export function isTier(value: unknown): value is QualityTier {
  return value === 'low' || value === 'medium' || value === 'high';
}

/** The next tier down, or null at the bottom. */
export function lowerTier(tier: QualityTier): QualityTier | null {
  const index = TIERS.indexOf(tier);
  return index > 0 ? (TIERS[index - 1] ?? null) : null;
}

export interface DeviceHints {
  /** `(pointer: coarse)`: a phone or a tablet. */
  readonly coarsePointer: boolean;
  /** navigator.deviceMemory in GiB, where the browser tells (Chromium only). */
  readonly deviceMemory?: number | undefined;
  readonly hardwareConcurrency?: number | undefined;
}

/**
 * Where a device starts: desktops HIGH, phones MEDIUM, one lower for a machine that says it is
 * small, and never above `ceiling`, the tier this device was demoted to on an earlier visit.
 */
export function startingTier(hints: DeviceHints, ceiling: QualityTier | null): QualityTier {
  let tier: QualityTier = hints.coarsePointer ? 'medium' : 'high';
  const small =
    (hints.deviceMemory !== undefined && hints.deviceMemory <= 2) ||
    (hints.hardwareConcurrency !== undefined && hints.hardwareConcurrency <= 2);
  if (small) tier = lowerTier(tier) ?? tier;
  if (ceiling && TIERS.indexOf(ceiling) < TIERS.indexOf(tier)) tier = ceiling;
  return tier;
}
