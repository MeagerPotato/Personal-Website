/**
 * TUNING: every number that shapes how the universe FEELS. Engine timings are in seconds,
 * distances in world units (1 u is about 1 m at toy scale).
 *
 * DESIGN SURFACE (docs/PLAN.md §5.6): values are free to change; shapes are owned by the logic
 * that consumes them (from Phase 1 each block is checked with `satisfies <Params>`, so an edit
 * that breaks a contract is a type error, not a runtime surprise).
 */
export const tuning = {
  viewport: {
    /** Pixels are the budget on phones. Cap the ratio AND the absolute pixel count. */
    maxPixelRatio: 2,
    maxPixelRatioCoarse: 1.5,
    maxMegapixels: 4,
    minPixelRatio: 0.5,
  },

  camera: {
    fovDegrees: 55,
    near: 0.1,
    far: 2000,
  },

  starfield: {
    /** Changing the seed reshuffles the whole sky; keep it stable so screenshots stay comparable. */
    seed: 'allenkh-starfield',
    count: 4000,
    countCoarse: 2000,
    /** Stars live on a thick shell around the camera, far enough to read as "infinitely far". */
    radiusMin: 400,
    radiusMax: 1000,
    /** Point size in CSS px. Sizes are cubed-random: many small stars, few large ones. */
    sizeMin: 1.1,
    sizeMax: 3.4,
    /** Palette weights: [token name under color.star, share]. */
    palette: [
      ['white', 0.6],
      ['cool', 0.25],
      ['warm', 0.15],
    ],
    brightnessMin: 0.45,
    twinkleShare: 0.2,
    twinkleDepth: 0.55,
    /** Whole-sky drift, radians per second. Off under reduced motion. */
    driftRadPerSec: 0.004,
  },
} as const;

export type Tuning = typeof tuning;
