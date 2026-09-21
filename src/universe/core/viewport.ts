/**
 * Render-resolution policy. On phones the budget is mostly PIXELS: a DPR-3 screen rendered
 * naively is 9x the fragment work. So we cap the ratio, then cap the absolute pixel count.
 * Pure, so the policy is unit-tested without a GPU.
 */

export interface PixelRatioLimits {
  readonly maxPixelRatio: number;
  readonly maxMegapixels: number;
  readonly minPixelRatio: number;
}

export function computePixelRatio(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  limits: PixelRatioLimits,
): number {
  const capped = Math.min(Math.max(devicePixelRatio, limits.minPixelRatio), limits.maxPixelRatio);
  const area = cssWidth * cssHeight;
  if (area <= 0) return capped;

  const budget = limits.maxMegapixels * 1_000_000;
  if (area * capped * capped <= budget) return capped;

  return Math.max(limits.minPixelRatio, Math.sqrt(budget / area));
}
