/**
 * The shapes of the tables in `tuning.look` and of the star classes in `tuning.starfield`: the
 * "flat worlds, deep light" pass (docs/DESIGN.md, "Deep light"). Types only, so that a table row
 * in design/tuning.ts that names a colour family, a star tint or a biome that does not exist is
 * a type error and not a black patch of sky. The systems that read each table arrive step by
 * step and own what the numbers MEAN; until one does, its block is only data.
 *
 * Colours are never numbers here: a row names a token key (`family: 'mint'`, `tint: 'hot'`).
 */
import type { QualityTier } from '../core/quality/tiers';
import type { AirKey, BiomeKey, StarKey, ThemeKey } from './tokens';

/** One ridgeline of a gas massif, far to near. Angles in degrees; the rest are shares, 0 to 1. */
export interface SkyRidge {
  /** The crest's offset from its pool's centre elevation (times the pool's `height`). */
  readonly offDeg: number;
  /** How far the crest swings about that (times `height` and a noise of about -0.8 to +1). */
  readonly ampDeg: number;
  /** That noise's frequency, cycles per radian of azimuth. */
  readonly freq: number;
  /** Half the width of the crest's soft edge: small is crisp (near), large is hazy (far). */
  readonly edgeDeg: number;
  /** Width of the lit line under the crest. */
  readonly rimDeg: number;
  /** Width of the soft light that falls down the face. */
  readonly softDeg: number;
  /** How much of the dark gas colours the ridge's body. */
  readonly body: number;
  /** How far the crest line goes from `lit` toward `rim`. */
  readonly edge: number;
  /** The key light on this ridge: scales the crest line, the soft light and the relief. */
  readonly key: number;
}

/** One gas massif, at the bearing of its system from home. */
export interface SkyPool {
  readonly id: string;
  /** Azimuth = atan2(x, z), degrees: 90 minus the layout's bearing. */
  readonly azDeg: number;
  readonly elDeg: number;
  /** Half-width in degrees of arc. */
  readonly halfWidthDeg: number;
  readonly strength: number;
  readonly family: ThemeKey;
  /** A second family blotched in, over `altShare` of the area. */
  readonly altFamily: ThemeKey;
  readonly altShare: number;
  readonly seed: number;
  /** Scales the ridges' offsets and swings: a smaller pool is lower. */
  readonly height: number;
  /** The family's loudness (mint's ramp is the brightest, so it is turned down). */
  readonly gain: number;
}

export interface SkyGalaxy {
  readonly azDeg: number;
  readonly elDeg: number;
  /** Semi-major axis. */
  readonly radiusDeg: number;
  /** Minor over major. */
  readonly axisRatio: number;
  readonly angleDeg: number;
  /** A lens (edge-on) has a dark lane, a spiral two arms, an ellipse neither. */
  readonly kind: 'lens' | 'spiral' | 'ellipse';
}

/** A thin broken ring: an old blast wave. */
export interface SkyArc {
  readonly azDeg: number;
  readonly elDeg: number;
  /** The ring's angular radius round its centre. */
  readonly radiusDeg: number;
  /** The angles it is drawn over, round the centre. */
  readonly fromDeg: number;
  readonly toDeg: number;
  readonly widthDeg: number;
  readonly family: ThemeKey;
  readonly strength: number;
  readonly seed: number;
}

/** A small stepped clump of gas with a pinprick in it. */
export interface SkyKnot {
  readonly azDeg: number;
  readonly elDeg: number;
  readonly radiusDeg: number;
  readonly family: ThemeKey;
  readonly seed: number;
}

/** What one quality tier bakes: the panorama's size and which layers its shader keeps. */
export interface SkyTier {
  readonly panoWidth: number;
  readonly panoHeight: number;
  /** Rows drawn in one frame while the panorama is baked. */
  readonly bandRows: number;
  /** Far galaxies, arcs and knots. */
  readonly far: boolean;
  /** 0 leaves the relief out. */
  readonly reliefOctaves: number;
  /** The second, finer set of teeth on every crest. */
  readonly rag2: boolean;
  /** Steam above the far crest. */
  readonly wisp: boolean;
}

/** The Milky Way's great circle. All degrees. */
export interface SkyBand {
  /** The pole is tilted this far from straight up... */
  readonly tiltDeg: number;
  /** ...toward this azimuth. */
  readonly poleAzDeg: number;
  /** The haze's width off the circle. */
  readonly sigmaDeg: number;
  /** The warm bulge: its azimuth along the circle, and its width. */
  readonly coreAzDeg: number;
  readonly coreSigmaDeg: number;
}

/** `tuning.look.sky`: design/tuning.ts says what each number does. */
export interface SkyLook {
  readonly intensity: number;
  readonly revealSec: number;
  readonly exposureDocked: number;
  readonly exposureMap: number;
  readonly exposureOmega: number;
  readonly warpAzDeg: number;
  readonly warpFreq: number;
  readonly poolFall: number;
  readonly seam: number;
  readonly dropDeg: number;
  readonly ragDeg: number;
  readonly ragFreq: number;
  readonly rag2Deg: number;
  readonly rag2Freq: number;
  readonly reliefOctaves: number;
  readonly relief: number;
  readonly reliefFreq: number;
  readonly reliefTap: number;
  readonly wisp: number;
  readonly glowHeightDeg: number;
  readonly glowLateral: number;
  readonly glowFilament: number;
  readonly glowGain: number;
  readonly glowSteps: number;
  readonly glowSoft: number;
  readonly heart: number;
  readonly heartMix: number;
  readonly softRim: number;
  readonly rimGain: number;
  readonly stripDeg: readonly [none: number, full: number];
  readonly ceilingY: number;
  readonly bandGain: number;
  readonly bandSoft: number;
  readonly arc: number;
  readonly band: SkyBand;
  readonly ridges: readonly [far: SkyRidge, mid: SkyRidge, near: SkyRidge];
  readonly pools: readonly SkyPool[];
  readonly galaxies: readonly SkyGalaxy[];
  readonly arcs: readonly SkyArc[];
  readonly knots: readonly SkyKnot[];
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

/** A Gaussian cloud of stars. */
export interface StarCluster {
  readonly azDeg: number;
  readonly elDeg: number;
  readonly sigmaDeg: number;
  readonly count: number;
  readonly tint: StarKey;
}

/** One class of stars. Brightness is peak linear luminance; sizes are CSS px at `scaleRows`. */
export interface StarClass {
  /** Left out for dust, which takes `starfield.count` (and `countCoarse`). */
  readonly count?: number;
  readonly yRange: readonly [number, number];
  /** Brightness is drawn as random^yExp across the range: higher means more faint ones. */
  readonly yExp: number;
  /** The Gaussian core. */
  readonly sigmaPx: number;
  readonly haloSigmaPx?: number;
  readonly haloGain?: number;
  readonly spikeLenPx?: number;
  readonly spikeGain?: number;
  readonly spikeThicknessPx?: number;
  /** Share of the class drawn along the Milky Way instead of anywhere. */
  readonly bandShare: number;
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
