import { createRng, pickWeighted, type Rng } from './rng';
import { directionOf } from './skyDirections';

/**
 * THE LIST OF STARS: which stars there are, where, how bright, what colour. A pure function of
 * the recipe (design/tuning.ts, `starfield`) and its seed, so the same sky appears on every
 * visit, in every screenshot and after the engine is rebuilt (a lost WebGL context).
 *
 * Five kinds, faintest to brightest. DUST is the mass, FIELD the ones a visitor sees without
 * looking, BRIGHT the ones they notice, MID a few with a small plus, and the eight HEROES carry
 * six diffraction spikes. Part of each of the first four lies along the Milky Way (a Gaussian
 * round its great circle), the rest anywhere; three small clusters and the heroes are at fixed
 * places. A star is only a DIRECTION: world/Starfield.ts draws it at infinity.
 */

/** The kinds, in the order the shader numbers them (design/shaders/sky.ts, `aStar.x`). */
export const STAR_KINDS = ['dust', 'field', 'bright', 'mid', 'hero'] as const;
export type StarKind = (typeof STAR_KINDS)[number];

const DUST = 0;
const FIELD = 1;
const HERO = 4;
const RAD = Math.PI / 180;
const TURN = Math.PI * 2;

interface ClassRecipe {
  readonly count?: number;
  readonly yRange: readonly [number, number];
  readonly yExp: number;
  readonly bandShare: number;
}

/** What of `tuning.starfield` the list is made from. `Tint` is a key of `color.star`. */
export interface StarRecipe<Tint extends string> {
  readonly seed: string | number;
  /** The dust class's count with a fine pointer, and with a coarse one. */
  readonly count: number;
  readonly countCoarse: number;
  readonly palette: ReadonlyArray<readonly [Tint, number]>;
  readonly twinkleShare: number;
  readonly classes: Readonly<Record<'dust' | 'field' | 'bright' | 'mid', ClassRecipe>>;
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
  };
  readonly bandSigmaDeg: number;
}

/** The Milky Way's great circle (`tuning.look.sky.band`): its pole, tilted from straight up. */
export interface StarBand {
  readonly tiltDeg: number;
  readonly poleAzDeg: number;
}

export interface StarListOptions {
  /** A finger, not a mouse: a phone. Half of every class but the heroes. */
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
  /** A hero's size, 0 to 1; 1 for every other star. */
  readonly sizes: Float32Array;
  /** 0 to 1: where the star is in its twinkle (or a hero in its breath), and how fast. */
  readonly phases: Float32Array;
  /** 1 if the star twinkles. */
  readonly twinkles: Uint8Array;
}

/** How many stars of each kind a tier and a pointer get; `cluster` is each cluster's count. */
export function starCounts<Tint extends string>(
  recipe: StarRecipe<Tint>,
  options: StarListOptions,
): Record<StarKind, number> & { clusters: number[] } {
  const share = (options.coarse ? 0.5 : 1) * (options.low ? 0.5 : 1);
  const part = (full: number): number => Math.round(full * share);
  const { classes } = recipe;
  return {
    dust: Math.round(
      (options.coarse ? recipe.countCoarse : recipe.count) * (options.low ? 0.5 : 1),
    ),
    field: part(classes.field.count ?? 0),
    bright: part(classes.bright.count ?? 0),
    // A plus of four arms is the one thing the low tier's stars go without.
    mid: options.low ? 0 : part(classes.mid.count ?? 0),
    // A hero costs one quad, and the heroes are the look: all of them, everywhere.
    hero: recipe.heroes.length,
    clusters: recipe.clusters.map((cluster) => part(cluster.count)),
  };
}

type Vec3 = [number, number, number];

const cross = (a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Two unit vectors that, with `axis` (a unit vector not straight up or down), are a frame. */
function frameOf(axis: Readonly<Vec3>): [Vec3, Vec3] {
  const flat = Math.hypot(axis[2], axis[0]);
  const e1: Vec3 = [axis[2] / flat, 0, -axis[0] / flat];
  return [e1, cross(axis, e1)];
}

/** A draw from the standard normal distribution (Box and Muller). */
function gauss(rng: Rng): number {
  const u = rng() || 1e-6;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TURN * rng());
}

export function buildStarList<Tint extends string>(
  recipe: StarRecipe<Tint>,
  band: StarBand,
  options: StarListOptions,
): StarList<Tint> {
  const counts = starCounts(recipe, options);
  const count =
    counts.dust +
    counts.field +
    counts.bright +
    counts.mid +
    counts.hero +
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

  // The Milky Way: a great circle whose pole is tilted from straight up.
  const pole = directionOf(band.poleAzDeg, 90 - band.tiltDeg);
  const [b1, b2] = frameOf(pole);
  const place = (inBand: boolean): Vec3 => {
    if (inBand) {
      const lat = gauss(rng) * recipe.bandSigmaDeg * RAD;
      const along = rng() * TURN;
      const c = Math.cos(lat) * Math.cos(along);
      const s = Math.cos(lat) * Math.sin(along);
      const up = Math.sin(lat);
      return [
        c * b1[0] + s * b2[0] + up * pole[0],
        c * b1[1] + s * b2[1] + up * pole[1],
        c * b1[2] + s * b2[2] + up * pole[2],
      ];
    }
    // Anywhere: uniform on the sphere.
    const y = rng() * 2 - 1;
    const azimuth = rng() * TURN;
    const ring = Math.sqrt(1 - y * y);
    return [ring * Math.sin(azimuth), y, ring * Math.cos(azimuth)];
  };

  const scatter = (kind: number, cls: ClassRecipe, n: number, twinkling: boolean): void => {
    const [lo, hi] = cls.yRange;
    for (let k = 0; k < n; k += 1) {
      const d = place(rng() < cls.bandShare);
      const y = lo + (hi - lo) * rng() ** cls.yExp;
      const i = put(d, kind, y, pickWeighted(rng, recipe.palette));
      phases[i] = rng();
      // Drawn even where it is not used, so that the next star does not depend on it.
      const twinkle = rng() < recipe.twinkleShare;
      twinkles[i] = twinkling && twinkle ? 1 : 0;
    }
  };
  const { classes } = recipe;
  scatter(DUST, classes.dust, counts.dust, true);
  scatter(FIELD, classes.field, counts.field, true);
  scatter(2, classes.bright, counts.bright, true);
  scatter(3, classes.mid, counts.mid, false);

  const look = recipe.cluster;
  recipe.clusters.forEach((cluster, index) => {
    const centre = directionOf(cluster.azDeg, cluster.elDeg);
    const [e1, e2] = frameOf(centre);
    const sigma = cluster.sigmaDeg * RAD;
    for (let k = 0; k < (counts.clusters[index] ?? 0); k += 1) {
      const u = gauss(rng) * sigma;
      const v = gauss(rng) * sigma;
      const sigmas = Math.hypot(u, v) / sigma;
      const y = look.yBase + look.yGain * rng() ** look.yExp * Math.exp(-look.falloff * sigmas);
      const own = rng() < look.tintShare;
      const any = pickWeighted(rng, recipe.palette);
      const i = put(
        [
          centre[0] + e1[0] * u + e2[0] * v,
          centre[1] + e1[1] * u + e2[1] * v,
          centre[2] + e1[2] * u + e2[2] * v,
        ],
        k < look.fieldCount ? FIELD : DUST,
        y,
        own ? cluster.tint : any,
      );
      phases[i] = rng();
      twinkles[i] = rng() < recipe.twinkleShare ? 1 : 0;
    }
  });

  // The heroes: where the recipe says, at full brightness, never twinkling. They breathe, each
  // at its own pace (its phase), so the eight never pulse together.
  for (const hero of recipe.heroes) {
    const i = put(directionOf(hero.azDeg, hero.elDeg), HERO, 1, hero.tint);
    sizes[i] = hero.size;
    phases[i] = rng();
  }

  return { count, directions, brightness, kinds, tints, sizes, phases, twinkles };
}
