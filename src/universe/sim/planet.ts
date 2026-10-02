import { MeshBuilder, type MeshData, type Point, type Rgb } from './meshBuilder';
import { createNoise3, fbm } from './noise';
import { createRng } from './rng';

/**
 * THE PLANET GENERATOR: a low-poly world from a seed. An icosphere whose corners are pushed out
 * by fractal noise sampled on the sphere itself (no seams, no pinched poles), with flat oceans,
 * terraced land, and one flat colour per facet chosen by height. Mini Motorways, but round.
 *
 * Pure, and written as a GENERATOR so that building a big one can be spread over several frames
 * (core/jobs.ts): it yields after each of the icosahedron's 20 faces.
 */

/** How planets look, as numbers. Filled in by design/tuning.ts. */
export interface PlanetLook {
  /** How tall the highest peak is, as a share of the radius. */
  readonly reliefShare: number;
  /** How many continents fit across a planet: higher = smaller, busier features. */
  readonly frequency: number;
  readonly octaves: number;
  /** Noise below this is ocean. 0 floods about half the planet; lower = drier. */
  readonly seaLevel: number;
  /** Noise at or above this counts as the highest peak. */
  readonly peakAt: number;
  /** Land rises in this many steps, and this much of the way from a smooth slope to hard steps. */
  readonly terraces: number;
  readonly terraceStrength: number;
  /** Land height (0 to 1) at which the colour changes: shore|low, low|high, high|peak. */
  readonly bandStops: readonly [shore: number, low: number, high: number];
  /** Each facet's colour is nudged by up to this share, so that flat areas look hand-made. */
  readonly colorJitter: number;
}

/** Lowest to highest. Linear RGB (sim/color.ts). */
export interface PlanetBands {
  readonly sea: Rgb;
  readonly shore: Rgb;
  readonly low: Rgb;
  readonly high: Rgb;
  readonly peak: Rgb;
}

/**
 * A superellipsoid for the generator to wrap its facets round instead of a sphere: exponent `p`
 * (2 is an ellipsoid, 4 a rounded box) and the half-extents `s` along x, y and z, in radii. It is
 * how a world can be a fish, a bus, a loaf or a cube (sim/world, design/worlds).
 */
export interface PlanetShape {
  readonly p: number;
  readonly s: Point;
}

/** Where a facet is, for a painter: all of it measured on the facet's corners, never guessed. */
export interface FacetPlace {
  /** The unit direction from the centre through the facet (the mean of its corners'). */
  readonly d: Point;
  /** The facet's centroid, on the shape and at its height. */
  readonly pos: Point;
  /** 0 at the north pole (+Y) to 1 at the south. */
  readonly colat: number;
  /** Its bearing, radians clockwise from north (-Z) seen from above. */
  readonly az: number;
}

/** A colour for a facet by where it is, or undefined to keep the band its height chose. */
export type FacetPainter = (place: FacetPlace) => Rgb | undefined;

export interface PlanetSpec {
  readonly radius: number;
  readonly seed: string;
  /** Subdivisions per icosahedron edge, minus one: the mesh has 20 * (detail + 1)^2 triangles. */
  readonly detail: number;
  readonly bands: PlanetBands;
  // The options below are for worlds of their own (sim/world). Without any of them a planet is
  // exactly, bit for bit, what the generator always made: sim/planet.test.ts pins that.
  /**
   * A smooth ball: every corner at this land height and none of the noise's, so the level alone
   * chooses the colour band (-1 is the sea, 0.3 the low ground with the usual stops) and paint
   * does the rest. No relief either: the surface is the shape itself.
   */
  readonly flat?: number;
  /** Wrap the facets round a superellipsoid instead of the sphere (relief is added on top). */
  readonly shape?: PlanetShape;
  /** Turn the icosahedron so that one of its corners sits exactly on the north pole. */
  readonly up?: 'vertex';
  /** Recolour facets by where they are, over the bands (their colour is then not nudged). */
  readonly paint?: FacetPainter;
}

const T = (1 + Math.sqrt(5)) / 2;
// prettier-ignore
const CORNERS: readonly Point[] = [
  [-1, T, 0], [1, T, 0], [-1, -T, 0], [1, -T, 0], [0, -1, T], [0, 1, T],
  [0, -1, -T], [0, 1, -T], [T, 0, -1], [T, 0, 1], [-T, 0, -1], [-T, 0, 1],
];
// Counter-clockwise seen from outside.
// prettier-ignore
const FACES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

// The same icosahedron turned about Z so that corner 0 is at the north pole: a clean polar cap,
// and a place for a nose cone, a stadium or a phone to stand.
// Corner 0 is [-1, T, 0].
const UP_TILT = Math.atan2(-1, T);
const UP_COS = Math.cos(UP_TILT);
const UP_SIN = Math.sin(UP_TILT);
const VERTEX_UP: readonly Point[] = CORNERS.map(([x, y, z]): Point => [
  x * UP_COS - y * UP_SIN,
  x * UP_SIN + y * UP_COS,
  z,
]);

export function planetTriangleCount(detail: number): number {
  return 20 * (detail + 1) * (detail + 1);
}

/** The point of a shape in the unit direction `d` (the direction itself for a sphere). */
export function shapePoint(d: Point, shape: PlanetShape): Point {
  const { p, s } = shape;
  // An ellipsoid needs no search: scaling the unit sphere along its axes is exactly it.
  const r =
    p === 2 ? 1 : 1 / (Math.abs(d[0]) ** p + Math.abs(d[1]) ** p + Math.abs(d[2]) ** p) ** (1 / p);
  return [d[0] * r * s[0], d[1] * r * s[1], d[2] * r * s[2]];
}

interface Corner {
  at: Point;
  /** 0 to 1 above the sea, or -1 for the sea itself. */
  land: number;
  /** The unit direction the corner was made from, before any shape (what paint measures). */
  dx: number;
  dy: number;
  dz: number;
}

export function* generatePlanet(spec: PlanetSpec, look: PlanetLook): Generator<void, MeshData> {
  const noise = createNoise3(spec.seed);
  const paint = createRng(`${spec.seed}/paint`);
  const builder = new MeshBuilder();
  const n = spec.detail + 1;
  const { flat, shape, paint: painter } = spec;
  const corners = spec.up === 'vertex' ? VERTEX_UP : CORNERS;

  const corner = (x: number, y: number, z: number): Corner => {
    const length = Math.hypot(x, y, z);
    const dx = x / length;
    const dy = y / length;
    const dz = z / length;
    // Where the surface is in this direction before any relief: the sphere, or the shape.
    const [sx, sy, sz] = shape ? shapePoint([dx, dy, dz], shape) : [dx, dy, dz];
    if (flat !== undefined)
      return { at: [sx * spec.radius, sy * spec.radius, sz * spec.radius], land: flat, dx, dy, dz };
    const f = look.frequency;
    const raw = fbm(noise, dx * f, dy * f, dz * f, look.octaves);
    if (raw <= look.seaLevel)
      return { at: [sx * spec.radius, sy * spec.radius, sz * spec.radius], land: -1, dx, dy, dz };

    const smooth = Math.min(1, (raw - look.seaLevel) / (look.peakAt - look.seaLevel));
    const stepped = Math.floor(smooth * look.terraces) / look.terraces;
    const land = smooth + (stepped - smooth) * look.terraceStrength;
    const r = spec.radius * (1 + look.reliefShare * land);
    return { at: [sx * r, sy * r, sz * r], land, dx, dy, dz };
  };

  /** Where a facet is, for the painter (only asked for when there is one). */
  const placeOf = (a: Corner, b: Corner, c: Corner): FacetPlace => {
    const x = a.dx + b.dx + c.dx;
    const y = a.dy + b.dy + c.dy;
    const z = a.dz + b.dz + c.dz;
    const length = Math.hypot(x, y, z) || 1;
    const d: Point = [x / length, y / length, z / length];
    return {
      d,
      pos: [
        (a.at[0] + b.at[0] + c.at[0]) / 3,
        (a.at[1] + b.at[1] + c.at[1]) / 3,
        (a.at[2] + b.at[2] + c.at[2]) / 3,
      ],
      colat: Math.acos(Math.max(-1, Math.min(1, d[1]))) / Math.PI,
      az: Math.atan2(d[0], -d[2]),
    };
  };

  const colorOf = (a: Corner, b: Corner, c: Corner): Rgb => {
    let band: Rgb;
    if (a.land < 0 && b.land < 0 && c.land < 0) {
      band = spec.bands.sea;
    } else {
      const height = (Math.max(0, a.land) + Math.max(0, b.land) + Math.max(0, c.land)) / 3;
      const [shore, low, high] = look.bandStops;
      band =
        height < shore
          ? spec.bands.shore
          : height < low
            ? spec.bands.low
            : height < high
              ? spec.bands.high
              : spec.bands.peak;
    }
    // Drawn for every facet, painted or not, so that painting one facet never changes the nudge
    // of any other.
    const nudge = 1 + (paint() * 2 - 1) * look.colorJitter;
    const painted = painter?.(placeOf(a, b, c));
    if (painted) return painted;
    return [
      Math.min(1, band[0] * nudge),
      Math.min(1, band[1] * nudge),
      Math.min(1, band[2] * nudge),
    ];
  };

  for (const [ia, ib, ic] of FACES) {
    const a = corners[ia];
    const b = corners[ib];
    const c = corners[ic];
    if (!a || !b || !c) continue;

    // A triangular grid over the face: rows[i][j] = a + (b - a) * i/n + (c - a) * j/n.
    const rows: Corner[][] = [];
    for (let i = 0; i <= n; i += 1) {
      const row: Corner[] = [];
      for (let j = 0; j <= n - i; j += 1) {
        const u = i / n;
        const v = j / n;
        row.push(
          corner(
            a[0] + (b[0] - a[0]) * u + (c[0] - a[0]) * v,
            a[1] + (b[1] - a[1]) * u + (c[1] - a[1]) * v,
            a[2] + (b[2] - a[2]) * u + (c[2] - a[2]) * v,
          ),
        );
      }
      rows.push(row);
    }

    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n - i; j += 1) {
        const p = rows[i]?.[j];
        const q = rows[i + 1]?.[j];
        const r = rows[i]?.[j + 1];
        if (!p || !q || !r) continue;
        builder.triangle(p.at, q.at, r.at, colorOf(p, q, r));

        const s = rows[i + 1]?.[j + 1];
        if (s) builder.triangle(q.at, s.at, r.at, colorOf(q, s, r));
      }
    }
    yield;
  }

  return builder.build();
}

/** Run a generator to its end in one go (tests, and bodies too small to be worth slicing). */
export function finish<T>(job: Generator<void, T>): T {
  for (;;) {
    const step = job.next();
    if (step.done) return step.value;
  }
}
