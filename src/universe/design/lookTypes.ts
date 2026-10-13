/**
 * The shapes of the tables in `tuning.look` and of the star classes in `tuning.starfield`: the
 * "flat worlds, deep light" pass (docs/DESIGN.md, "Deep light"). Types only, so that a table row
 * in design/tuning.ts that names a star tint, an air or a biome that does not exist is a type
 * error and not a black patch of sky. The systems that read each table own what the numbers
 * MEAN.
 *
 * Colours are never numbers here: a row names a token key (`air: 'terra'`, `tint: 'hot'`).
 */
import type { QualityTier } from '../core/quality/tiers';
import type { AirKey, BiomeKey, StarKey } from './tokens';

/** A far galaxy: a small ellipse of light in two star tints, baked into the sky. */
export interface SkyGalaxy {
  readonly azDeg: number;
  readonly elDeg: number;
  /** Semi-major axis. */
  readonly radiusDeg: number;
  /** Minor over major. */
  readonly axisRatio: number;
  /** How far the major axis is turned from level, round the galaxy's own direction. */
  readonly angleDeg: number;
  /** A lens (edge-on) has a dark lane, a spiral two arms, an ellipse neither. */
  readonly kind: 'lens' | 'spiral' | 'ellipse';
  /** The tint of its disc, and of its nucleus. */
  readonly disc: StarKey;
  readonly core: StarKey;
  /** Its loudness, 0 to 1. */
  readonly gain: number;
}

/** What one quality tier bakes: the panorama's size. Every tier paints the same sky. */
export interface SkyTier {
  readonly panoWidth: number;
  readonly panoHeight: number;
  /** Rows drawn in one frame while the panorama is baked. */
  readonly bandRows: number;
}

/**
 * The Milky Way: a river of stars along a great circle, and the faint haze under them. The bake
 * (design/shaders/skyBake.ts) paints the haze and the star list (sim/starList.ts) lays the stars
 * from these same numbers; sim/milkyWay.ts says what each does. Longitudes run round the
 * circle, degrees, from its level point a quarter turn of azimuth on from its pole.
 */
export interface SkyBand {
  /** The circle's pole is tilted this far from straight up (never 0)... */
  readonly tiltDeg: number;
  /** ...toward this azimuth. */
  readonly poleAzDeg: number;
  /** Scales the haze before it is cut off at 1. */
  readonly gain: number;
  /** The cross-section: a narrow bank and a wide one, each exp(-(y / sigmaDeg)^2) times its weight. */
  readonly banks: readonly [
    narrow: readonly [sigmaDeg: number, weight: number],
    wide: readonly [sigmaDeg: number, weight: number],
  ];
  /**
   * The river's middle wanders off the circle by a1 sin(2 lon + p1) + a2 sin(5 lon + p2): the
   * two swings in degrees, the two phases in radians, as [a1, p1, a2, p2].
   */
  readonly meanderDeg: readonly [a1: number, p1: number, a2: number, p2: number];
  /** How bright the river is along its length: this much everywhere, plus the clumps. */
  readonly base: number;
  readonly clumps: ReadonlyArray<readonly [lonDeg: number, sigmaDeg: number, weight: number]>;
  /**
   * The bulge, the river's heart: an oval on its middle at `lonDeg`, exp(-(lon / along)^2 -
   * (lat / across)^2) with `sigmaDeg` = [along, across]. It is MADE OF STARS: the star list
   * crowds it with stars in warm tints (`tuning.starfield.bulge`). The haze has no colour for
   * it: it only swells there, by `glow`, in the tones it has everywhere.
   */
  readonly core: {
    readonly lonDeg: number;
    readonly sigmaDeg: readonly [along: number, across: number];
    readonly glow: number;
  };
  /**
   * The dark lane: its middle runs offsetDeg[0] off the river's, swinging by [1] and [2]; it is
   * widthDeg[0] wide, swinging by [1]. It is made of MISSING STARS and of nothing else: no
   * paint (a lane darkened in the haze drew streaks along it, which read as layers). `hide`
   * acts on the stars twice: the river's and the bulge's own stars are laid that much thinner
   * where it runs, and whatever star is left there, of any class, is dimmed through the
   * panorama's alpha (at the lane's middle, where 0.2 of it is clear, to a ninth of its light).
   */
  readonly lane: {
    readonly offsetDeg: readonly [number, number, number];
    readonly widthDeg: readonly [number, number];
    readonly hide: number;
  };
}

/** `tuning.look.sky`: design/tuning.ts says what each number does. */
export interface SkyLook {
  readonly intensity: number;
  readonly revealSec: number;
  readonly exposureDocked: number;
  readonly exposureMap: number;
  readonly exposureOmega: number;
  readonly bandSlowMs: number;
  readonly stripDeg: readonly [none: number, full: number];
  readonly ceilingY: number;
  readonly band: SkyBand;
  readonly galaxies: readonly SkyGalaxy[];
  readonly tiers: Readonly<Record<QualityTier, SkyTier>>;
}

/** A hero star: one of eight fixed places, with six spikes. */
export interface HeroStar {
  readonly azDeg: number;
  readonly elDeg: number;
  /** 0 to 1: scales its spikes. */
  readonly size: number;
  readonly tint: StarKey;
}

/** A Gaussian cluster of stars. */
export interface StarCluster {
  readonly azDeg: number;
  readonly elDeg: number;
  readonly sigmaDeg: number;
  readonly count: number;
  readonly tint: StarKey;
  /**
   * The system (its id in the galaxy) whose bearing from home this cluster stands at: the sky's
   * compass. Left out for a cluster that marks nothing. It is a NOTE, and nothing in the engine
   * reads it: `azDeg` is what places the cluster, and tests/look.test.ts holds the two together
   * (the azimuth is 90 minus the layout's bearing of that system from home).
   */
  readonly system?: string;
}

/**
 * How a cluster's stars are made (`tuning.starfield.cluster`). A cluster has a HEART: its first
 * `brightCount` stars are bright ones (the bright class's range) within `heart` of its width,
 * the next `fieldCount` are field stars within twice that, and the rest are dust across the
 * whole width, of brightness yBase + yGain * random^yExp * exp(-falloff * r), r the distance
 * from the middle in sigmas: brighter toward the heart. `tintShare` of them wear the cluster's
 * tint, the rest any.
 */
export interface StarClusterLook {
  readonly yBase: number;
  readonly yGain: number;
  readonly yExp: number;
  readonly falloff: number;
  readonly tintShare: number;
  readonly fieldCount: number;
  readonly brightCount: number;
  readonly heart: number;
}

/**
 * The Milky Way's bulge, in stars (its place and size are `look.sky.band.core`): how many of
 * each plain class it adds to the river there, and the tints they wear.
 */
export interface StarBulge {
  readonly counts: Readonly<Record<'dust' | 'field' | 'bright', number>>;
  readonly palette: StarPalette;
}

/** A share of each star tint: [token name under color.star, weight]. */
export type StarPalette = ReadonlyArray<readonly [StarKey, number]>;

/** One class of stars. Brightness is peak linear luminance; sizes are CSS px at `scaleRows`. */
export interface StarClass {
  /** Left out for dust, which takes `starfield.count` (and `countCoarse`). */
  readonly count?: number;
  readonly yRange: readonly [number, number];
  /** Brightness is drawn as random^yExp across the range: higher means more faint ones. */
  readonly yExp: number;
  /** The Gaussian core. */
  readonly sigmaPx: number;
  /** The core's peak, as a share of the star's brightness. 1 when left out. */
  readonly coreGain?: number;
  readonly haloSigmaPx?: number;
  readonly haloGain?: number;
  readonly spikeLenPx?: number;
  readonly spikeGain?: number;
  readonly spikeThicknessPx?: number;
  /** A star's spikes are this share of `spikeLenPx` long, drawn evenly from the range. */
  readonly sizeRange?: readonly [number, number];
  /** The class's own tints. `starfield.palette` when left out. */
  readonly palette?: StarPalette;
  /** Share of the class drawn along the Milky Way instead of anywhere. */
  readonly bandShare: number;
}

/**
 * Double stars: a bright primary and a fainter companion a hair away, in another temperature.
 * `tints`: the pairs of [primary, companion] a double is drawn from.
 */
export interface StarPairs {
  readonly count: number;
  /** How far apart the two are, degrees: [least, most]. */
  readonly sepDeg: readonly [number, number];
  /** Their ranges of brightness. */
  readonly primaryY: readonly [number, number];
  readonly companionY: readonly [number, number];
  readonly tints: ReadonlyArray<readonly [primary: StarKey, companion: StarKey]>;
}

/** A tone of a system's family, as the suns' corona names it. */
export type SunTone = 'light' | 'base' | 'shade';
/** A colour of a world's hairline of air: its air, that mixed toward white, or the dusk. */
export type RimTone = 'air' | 'airLight' | 'dusk';

/** A world with air, by manifest id. */
export interface AirWorld {
  readonly air: AirKey;
  /** `share` 0 to 1 of the sky that is cloud; `peak` whose snow colours it (a biome's `peak`). */
  readonly cloud?: { readonly share: number; readonly peak: BiomeKey };
  /** Lamps on the night side. */
  readonly windows?: boolean;
}

/** The token a lamp is painted with, as a path under `color`. */
export type LampToken = 'window' | `star.${StarKey}`;
