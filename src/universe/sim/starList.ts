import type { SkyBand } from '../design/lookTypes';
import { bandFrame, clumpAt, clumpPeak, laneAt, meanderAt, narrowShare } from './milkyWay';
import { createRng, pickWeighted, type Rng } from './rng';
import { directionOf } from './skyDirections';

/**
 * THE LIST OF STARS: which stars there are, where, how bright, what colour. A pure function of
 * the recipe (design/tuning.ts, `starfield`), the Milky Way (`look.sky.band`) and the seed, so
 * the same sky appears on every visit, in every screenshot and after the engine is rebuilt (a
 * lost WebGL context).
 *
 * Five kinds, faintest to brightest. DUST is the mass, FIELD the ones a visitor sees without
 * looking, BRIGHT the ones they notice, MID a few with six small spikes, and the eight HEROES
 * carry six long ones. Part of each of the first four is THE MILKY WAY: a river of stars along a
 * great circle (sim/milkyWay.ts), denser in its clumps and thin where its dark lane runs; the
 * rest lie anywhere. Where the river is thickest, its BULGE is a crowd of more dust, field and
 * bright stars in warm tints: the bulge is these stars, the haze paints no colour of its own
 * there. Six small clusters (each a few bright stars with fainter ones falling away round
 * them), a handful of double stars and the heroes complete it. A star is only a DIRECTION:
 * world/Starfield.ts draws it at infinity.
 */

/** The kinds, in the order the shader numbers them (design/shaders/sky.ts, `aStar.x`). */
export const STAR_KINDS = ['dust', 'field', 'bright', 'mid', 'hero'] as const;
export type StarKind = (typeof STAR_KINDS)[number];

const DUST = 0;
const FIELD = 1;
const BRIGHT = 2;
const MID = 3;
const HERO = 4;
const RAD = Math.PI / 180;
const TURN = Math.PI * 2;
/** How many places in the river are tried for one star before it goes anywhere instead. */
const RIVER_GUESSES = 40;

type Palette<Tint extends string> = ReadonlyArray<readonly [Tint, number]>;
type Range = readonly [number, number];

interface ClassRecipe<Tint extends string> {
  readonly count?: number;
  readonly yRange: Range;
  readonly yExp: number;
  readonly bandShare: number;
  /** The class's own tints: the recipe's `palette` when left out. */
  readonly palette?: Palette<Tint>;
  /** A star's size is drawn evenly from this range: 1 when left out. */
  readonly sizeRange?: Range;
}

/** What of `tuning.starfield` the list is made from. `Tint` is a key of `color.star`. */
export interface StarRecipe<Tint extends string> {
  readonly seed: string | number;
  /** The dust class's count with a fine pointer, and with a coarse one. */
  readonly count: number;
  readonly countCoarse: number;
  readonly palette: Palette<Tint>;
  readonly twinkleShare: number;
  readonly classes: Readonly<Record<'dust' | 'field' | 'bright' | 'mid', ClassRecipe<Tint>>>;
  readonly heroes: ReadonlyArray<{
    readonly azDeg: number;
    readonly elDeg: number;
    readonly size: number;
    readonly tint: Tint;
  }>;
  readonly clusters: ReadonlyArray<{
    readonly azDeg: number;
    readonly elDeg: number;
    readonly sigmaDeg: number;
    readonly count: number;
    readonly tint: Tint;
  }>;
  readonly cluster: {
    readonly yBase: number;
    readonly yGain: number;
    readonly yExp: number;
    readonly falloff: number;
    readonly tintShare: number;
    readonly fieldCount: number;
    readonly brightCount: number;
    readonly heart: number;
  };
  /** The Milky Way's bulge: how many of each plain class it adds there, and their tints. */
  readonly bulge: {
    readonly counts: Readonly<Record<'dust' | 'field' | 'bright', number>>;
    readonly palette: Palette<Tint>;
  };
  readonly pairs: {
    readonly count: number;
    readonly sepDeg: Range;
    readonly primaryY: Range;
    readonly companionY: Range;
    readonly tints: ReadonlyArray<readonly [primary: Tint, companion: Tint]>;
  };
}

export interface StarListOptions {
  /** A finger, not a mouse: a phone. Half of every class but the heroes and the doubles. */
  readonly coarse: boolean;
  /** The low quality tier: half again, and no mid class. */
  readonly low: boolean;
}

/** The stars, as parallel arrays: star `i` is `directions[3i..3i+2]`, `brightness[i]`, ... */
export interface StarList<Tint extends string> {
  readonly count: number;
  /** Unit vectors, y up. */
  readonly directions: Float32Array;
  /** Peak brightness: the star's colour is its tint times this. */
  readonly brightness: Float32Array;
  /** An index into STAR_KINDS. */
  readonly kinds: Uint8Array;
  readonly tints: readonly Tint[];
  /** How long a hero's or a mid star's spikes are, 0 to 1; 1 for every other star. */
  readonly sizes: Float32Array;
  /** 0 to 1: where the star is in its twinkle (or a hero in its breath), and how fast. */
  readonly phases: Float32Array;
  /** 1 if the star twinkles. */
  readonly twinkles: Uint8Array;
}

/** The plain classes the bulge adds stars of, in the order they are laid. */
const BULGE_KINDS = ['dust', 'field', 'bright'] as const;

/**
 * How many stars of each kind a tier and a pointer get from their classes; on top of those,
 * `bulge` is what the Milky Way's bulge adds of each plain class, `clusters` each cluster's
 * count and `pairs` the number of double stars (two stars each).
 */
export function starCounts<Tint extends string>(
  recipe: StarRecipe<Tint>,
  options: StarListOptions,
): Record<StarKind, number> & {
  bulge: Record<(typeof BULGE_KINDS)[number], number>;
  clusters: number[];
  pairs: number;
} {
  const share = (options.coarse ? 0.5 : 1) * (options.low ? 0.5 : 1);
  const part = (full: number): number => Math.round(full * share);
  const { classes, pairs, bulge } = recipe;
  return {
    dust: Math.round(
      (options.coarse ? recipe.countCoarse : recipe.count) * (options.low ? 0.5 : 1),
    ),
    field: part(classes.field.count ?? 0),
    bright: part(classes.bright.count ?? 0),
    // Small spikes are the one thing the low tier's stars go without.
    mid: options.low ? 0 : part(classes.mid.count ?? 0),
    // A hero costs one quad, and the heroes are the look: all of them, everywhere.
    hero: recipe.heroes.length,
    bulge: {
      dust: part(bulge.counts.dust),
      field: part(bulge.counts.field),
      bright: part(bulge.counts.bright),
    },
    clusters: recipe.clusters.map((cluster) => part(cluster.count)),
    // A double costs two quads and is found by looking: all of them, everywhere.
    pairs: pairs.tints.length > 0 ? pairs.count : 0,
  };
}

type Vec3 = [number, number, number];

const cross = (a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Two unit vectors that, with the unit vector `axis`, are a frame: the first one level. */
function frameRound(axis: Readonly<Vec3>): [Vec3, Vec3] {
  const flat = Math.hypot(axis[2], axis[0]);
  // Straight up or down, any level vector will do.
  const e1: Vec3 = flat > 1e-9 ? [axis[2] / flat, 0, -axis[0] / flat] : [1, 0, 0];
  return [e1, cross(axis, e1)];
}

/** A draw from the standard normal distribution (Box and Muller). */
function gauss(rng: Rng): number {
  const u = rng() || 1e-6;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TURN * rng());
}

export function buildStarList<Tint extends string>(
  recipe: StarRecipe<Tint>,
  band: SkyBand,
  options: StarListOptions,
): StarList<Tint> {
  const counts = starCounts(recipe, options);
  const count =
    counts.dust +
    counts.field +
    counts.bright +
    counts.mid +
    counts.hero +
    counts.bulge.dust +
    counts.bulge.field +
    counts.bulge.bright +
    counts.pairs * 2 +
    counts.clusters.reduce((sum, n) => sum + n, 0);

  const directions = new Float32Array(count * 3);
  const brightness = new Float32Array(count);
  const kinds = new Uint8Array(count);
  const tints: Tint[] = [];
  const sizes = new Float32Array(count).fill(1);
  const phases = new Float32Array(count);
  const twinkles = new Uint8Array(count);
  const rng = createRng(recipe.seed);
  let next = 0;

  const put = (d: Readonly<Vec3>, kind: number, y: number, tint: Tint): number => {
    const i = next;
    next += 1;
    const length = Math.hypot(d[0], d[1], d[2]);
    directions[i * 3] = d[0] / length;
    directions[i * 3 + 1] = d[1] / length;
    directions[i * 3 + 2] = d[2] / length;
    kinds[i] = kind;
    brightness[i] = y;
    tints.push(tint);
    return i;
  };
  const between = ([lo, hi]: Range, t: number): number => lo + (hi - lo) * t;

  /** Anywhere: uniform on the sphere. */
  const anywhere = (): Vec3 => {
    const y = rng() * 2 - 1;
    const azimuth = rng() * TURN;
    const ring = Math.sqrt(1 - y * y);
    return [ring * Math.sin(azimuth), y, ring * Math.cos(azimuth)];
  };

  const { pole, b1, b2 } = bandFrame(band);
  /** The direction at a longitude round the river (radians), `yy` degrees off its middle. */
  const onRiver = (along: number, yy: number): Vec3 => {
    const lat = (yy + meanderAt(band, along)) * RAD;
    const c = Math.cos(lat) * Math.cos(along);
    const s = Math.cos(lat) * Math.sin(along);
    const up = Math.sin(lat);
    return [
      c * b1[0] + s * b2[0] + up * pole[0],
      c * b1[1] + s * b2[1] + up * pole[1],
      c * b1[2] + s * b2[2] + up * pole[2],
    ];
  };
  /** How often a guess `yy` degrees off the river's middle is kept: less in the dark lane. */
  const clear = (along: number, yy: number): number => 1 - band.lane.hide * laneAt(band, along, yy);

  // The Milky Way: a guess is a longitude anywhere round the circle and a latitude off the
  // river's middle from one of its two banks, each bank as often as its mass (the haze's
  // exp(-(y / sigma)^2) is a Gaussian of deviation sigma / sqrt 2), so the stars' cross-section
  // is the haze's. It is kept as often as the river is bright at that longitude and clear of
  // the dark lane there.
  const peak = clumpPeak(band);
  const [[narrowDeg], [wideDeg]] = band.banks;
  const narrow = narrowShare(band);
  const inRiver = (): Vec3 | null => {
    for (let guess = 0; guess < RIVER_GUESSES; guess += 1) {
      const along = rng() * TURN;
      const sigma = rng() < narrow ? narrowDeg : wideDeg;
      const yy = gauss(rng) * sigma * Math.SQRT1_2;
      if (rng() > (clumpAt(band, along / RAD) / peak) * clear(along, yy)) continue;
      return onRiver(along, yy);
    }
    return null;
  };

  // The bulge: an oval on the river's middle (the Gaussians of sim/milkyWay.ts, bulgeAt), with
  // the dark lane cut through it as through the rest of the river.
  const [bulgeAlong, bulgeAcross] = band.core.sigmaDeg;
  const inBulge = (): Vec3 => {
    for (let guess = 1; ; guess += 1) {
      const along = (band.core.lonDeg + gauss(rng) * bulgeAlong * Math.SQRT1_2) * RAD;
      const yy = gauss(rng) * bulgeAcross * Math.SQRT1_2;
      if (guess >= RIVER_GUESSES || rng() <= clear(along, yy)) return onRiver(along, yy);
    }
  };

  const scatter = (
    kind: number,
    cls: ClassRecipe<Tint>,
    n: number,
    twinkling: boolean,
    place: () => Vec3,
    palette: Palette<Tint>,
  ): void => {
    for (let k = 0; k < n; k += 1) {
      const d = place();
      const y = between(cls.yRange, rng() ** cls.yExp);
      const i = put(d, kind, y, pickWeighted(rng, palette));
      if (cls.sizeRange) sizes[i] = between(cls.sizeRange, rng());
      phases[i] = rng();
      // Drawn even where it is not used, so that the next star does not depend on it.
      const twinkle = rng() < recipe.twinkleShare;
      twinkles[i] = twinkling && twinkle ? 1 : 0;
    }
  };
  const { classes } = recipe;
  /** A class's own stars: its share along the river, the rest anywhere, in its own tints. */
  const ofClass = (kind: number, cls: ClassRecipe<Tint>, n: number, twinkling: boolean): void =>
    scatter(
      kind,
      cls,
      n,
      twinkling,
      () => (rng() < cls.bandShare ? inRiver() : null) ?? anywhere(),
      cls.palette ?? recipe.palette,
    );
  ofClass(DUST, classes.dust, counts.dust, true);
  ofClass(FIELD, classes.field, counts.field, true);
  ofClass(BRIGHT, classes.bright, counts.bright, true);
  ofClass(MID, classes.mid, counts.mid, false);

  // The bulge's stars: more of each plain class, in the bulge's warm tints.
  BULGE_KINDS.forEach((name, kind) => {
    scatter(kind, classes[name], counts.bulge[name], true, inBulge, recipe.bulge.palette);
  });

  // The clusters. Each has a heart: a few bright stars close in, field stars round them, then
  // the dust across its whole width, brighter toward the middle.
  const look = recipe.cluster;
  recipe.clusters.forEach((cluster, index) => {
    const centre = directionOf(cluster.azDeg, cluster.elDeg);
    const [e1, e2] = frameRound(centre);
    const sigma = cluster.sigmaDeg * RAD;
    for (let k = 0; k < (counts.clusters[index] ?? 0); k += 1) {
      const bright = k < look.brightCount;
      const field = !bright && k < look.brightCount + look.fieldCount;
      const reach = bright ? look.heart : field ? look.heart * 2 : 1;
      const u = gauss(rng) * sigma * reach;
      const v = gauss(rng) * sigma * reach;
      const sigmas = Math.hypot(u, v) / sigma;
      const y = bright
        ? between(classes.bright.yRange, rng())
        : look.yBase + look.yGain * rng() ** look.yExp * Math.exp(-look.falloff * sigmas);
      const own = rng() < look.tintShare;
      const any = pickWeighted(rng, recipe.palette);
      const i = put(
        [
          centre[0] + e1[0] * u + e2[0] * v,
          centre[1] + e1[1] * u + e2[1] * v,
          centre[2] + e1[2] * u + e2[2] * v,
        ],
        bright ? BRIGHT : field ? FIELD : DUST,
        y,
        own ? cluster.tint : any,
      );
      phases[i] = rng();
      twinkles[i] = rng() < recipe.twinkleShare ? 1 : 0;
    }
  });

  // Double stars: a bright primary anywhere, and a fainter companion a hair away in another
  // temperature. Neither twinkles: a double is found by looking, and it should hold still.
  const { pairs } = recipe;
  for (let k = 0; k < counts.pairs; k += 1) {
    const primary = anywhere();
    const [e1, e2] = frameRound(primary);
    const angle = rng() * TURN;
    const apart = Math.tan(between(pairs.sepDeg, rng()) * RAD);
    const tints =
      pairs.tints[Math.min(Math.floor(rng() * pairs.tints.length), pairs.tints.length - 1)];
    if (!tints) throw new RangeError('starList: a double star needs a pair of tints');
    const across = Math.cos(angle) * apart;
    const up = Math.sin(angle) * apart;
    put(primary, BRIGHT, between(pairs.primaryY, rng()), tints[0]);
    put(
      [
        primary[0] + e1[0] * across + e2[0] * up,
        primary[1] + e1[1] * across + e2[1] * up,
        primary[2] + e1[2] * across + e2[2] * up,
      ],
      FIELD,
      between(pairs.companionY, rng()),
      tints[1],
    );
  }

  // The heroes: where the recipe says, at full brightness, never twinkling. They breathe, each
  // at its own pace (its phase), so the eight never pulse together.
  for (const hero of recipe.heroes) {
    const i = put(directionOf(hero.azDeg, hero.elDeg), HERO, 1, hero.tint);
    sizes[i] = hero.size;
    phases[i] = rng();
  }

  return { count, directions, brightness, kinds, tints, sizes, phases, twinkles };
}
