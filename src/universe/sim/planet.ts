import { MeshBuilder, type MeshData, type Point, type Rgb } from './meshBuilder';
import { createNoise3, fbm } from './noise';
import { createRng } from './rng';

/**
 * THE PLANET GENERATOR: a low-poly world from a seed. An icosphere whose corners are pushed out
 * by fractal noise sampled on the sphere itself (no seams, no pinched poles), with flat oceans,
 * terraced land, and flat colours chosen by height. Mini Motorways, but round.
 *
 * ROUND ("Deep light", docs/DESIGN.md): the mesh is facets, the picture is not. Every corner
 * carries the normal of the ball (or the shape) it lies on, so light falls across the world as
 * across a ball; and a facet that a coast, a band of height or an edge of paint runs through
 * carries BOTH colours and where the line between them crosses it (sim/meshBuilder.ts, `Facet`),
 * so the toon shader draws that line straight through the facet, from where it enters to where
 * it leaves, and from facet to facet it is a smooth outline and not a staircase of triangles.
 * No facet is added for it.
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

/** A place on a facet, for a painter: all of it measured on the facet's corners, never guessed. */
export interface FacetPlace {
  /** The unit direction from the centre through the place (a mean of the facet's corners'). */
  readonly d: Point;
  /** The place itself, on the facet. */
  readonly pos: Point;
  /** 0 at the north pole (+Y) to 1 at the south. */
  readonly colat: number;
  /** Its bearing, radians clockwise from north (-Z) seen from above. */
  readonly az: number;
}

/** A colour for a place on a facet, or undefined to keep the band its height chose. */
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

/** The unit normal of a shape at its point in the unit direction `d` (the direction, for a sphere). */
export function shapeNormal(d: Point, shape: PlanetShape): Point {
  const { p, s } = shape;
  const at = shapePoint(d, shape);
  const g = [0, 1, 2].map((i) => {
    const q = (at[i] ?? 0) / (s[i] ?? 1);
    return (Math.sign(q) * Math.abs(q) ** (p - 1)) / (s[i] ?? 1);
  });
  const length = Math.hypot(g[0] ?? 0, g[1] ?? 0, g[2] ?? 0) || 1;
  return [(g[0] ?? 0) / length, (g[1] ?? 0) / length, (g[2] ?? 0) / length];
}

interface Corner {
  at: Point;
  /**
   * How high, before the terraces: 0 the sea's edge, 1 the highest peak, below 0 under the sea
   * (and for a smooth ball, its level as it is). What lies between two corners is between their
   * heights, which is how a coast finds its way through a facet.
   */
  h: number;
  /** The unit direction the corner was made from, before any shape (what paint measures). */
  d: Point;
  /** The normal of the ball or the shape there: the relief does not turn it. */
  n: Point;
}

/** A colour at a place, and whether paint chose it (paint is never nudged). */
interface Ink {
  readonly c: Rgb;
  readonly painted: boolean;
}

/** A place on a facet a b c, as its share of b and of c. */
type Flat = readonly [x: number, y: number];

/** A facet's outline is looked at in this many steps an edge: nothing thinner than one is seen. */
const OUTLINE_STEPS = 6;
/** ...and a change of colour between two steps is then found by this many halvings. */
const CUT_STEPS = 7;

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
    const d: Point = [dx, dy, dz];
    // Where the surface is in this direction before any relief: the sphere, or the shape.
    const [sx, sy, sz] = shape ? shapePoint(d, shape) : d;
    const n = shape ? shapeNormal(d, shape) : d;
    if (flat !== undefined)
      return { at: [sx * spec.radius, sy * spec.radius, sz * spec.radius], h: flat, d, n };
    const f = look.frequency;
    const raw = fbm(noise, dx * f, dy * f, dz * f, look.octaves);
    const h = (raw - look.seaLevel) / (look.peakAt - look.seaLevel);
    const r = spec.radius * (1 + look.reliefShare * Math.max(0, landOf(h)));
    return { at: [sx * r, sy * r, sz * r], h, d, n };
  };

  /** A height as land: 0 to 1 above the sea, in terraces; below 0, the sea. A smooth ball's is its level. */
  const landOf = (h: number): number => {
    if (flat !== undefined) return h;
    if (h <= 0) return -1;
    const smooth = Math.min(1, h);
    const stepped = Math.floor(smooth * look.terraces) / look.terraces;
    return smooth + (stepped - smooth) * look.terraceStrength;
  };

  const bandOf = (h: number): Rgb => {
    const land = landOf(h);
    const [shore, low, high] = look.bandStops;
    const { bands } = spec;
    return land < 0
      ? bands.sea
      : land < shore
        ? bands.shore
        : land < low
          ? bands.low
          : land < high
            ? bands.high
            : bands.peak;
  };

  /**
   * The colour at a place on the facet a b c, given by its share of each corner: what paint says
   * there, or else the band of its height.
   */
  const inkAt = (a: Corner, b: Corner, c: Corner, u: number, v: number, w: number): Ink => {
    if (painter) {
      const x = a.d[0] * u + b.d[0] * v + c.d[0] * w;
      const y = a.d[1] * u + b.d[1] * v + c.d[1] * w;
      const z = a.d[2] * u + b.d[2] * v + c.d[2] * w;
      const length = Math.hypot(x, y, z) || 1;
      const d: Point = [x / length, y / length, z / length];
      const painted = painter({
        d,
        pos: [
          a.at[0] * u + b.at[0] * v + c.at[0] * w,
          a.at[1] * u + b.at[1] * v + c.at[1] * w,
          a.at[2] * u + b.at[2] * v + c.at[2] * w,
        ],
        colat: Math.acos(Math.max(-1, Math.min(1, d[1]))) / Math.PI,
        az: Math.atan2(d[0], -d[2]),
      });
      if (painted) return { c: painted, painted: true };
    }
    return { c: bandOf(a.h * u + b.h * v + c.h * w), painted: false };
  };

  const same = (p: Ink, q: Ink): boolean =>
    p.c === q.c || (p.c[0] === q.c[0] && p.c[1] === q.c[1] && p.c[2] === q.c[2]);

  /**
   * One facet: one colour, or up to three with the lines between them. Its outline is walked
   * once, corner to corner, and every change of colour on the way is a CUT, found to a hair by
   * halving. Two cuts are one line through the facet; four are two (a stripe, or three bands of
   * height); three are a place where three colours meet. A neighbour walks the shared edge
   * through the same places and finds the same cuts, so its lines begin where these end.
   */
  const facet = (a: Corner, b: Corner, c: Corner): void => {
    // Drawn for every facet, painted or not, so that painting one facet never changes the nudge
    // of any other.
    const nudge = 1 + (paint() * 2 - 1) * look.colorJitter;
    const rgb = ({ c: ink, painted }: Ink): Rgb =>
      painted
        ? ink
        : [Math.min(1, ink[0] * nudge), Math.min(1, ink[1] * nudge), Math.min(1, ink[2] * nudge)];
    const n = [...a.n, ...b.n, ...c.n];
    /** The place `along` the outline: 0 is a, 1 b, 2 c, 3 a again; as [x, y] = its share of b and c. */
    const place = (along: number): Flat => {
      const edge = Math.floor(along) % 3;
      const t = along - Math.floor(along);
      return edge === 0 ? [t, 0] : edge === 1 ? [1 - t, t] : [0, 1 - t];
    };
    const inkOf = ([x, y]: Flat): Ink => inkAt(a, b, c, 1 - x - y, x, y);

    const first = inkOf([0, 0]);
    const cuts: Array<{ along: number; after: Ink }> = [];
    let before = first;
    for (let step = 1; step <= 3 * OUTLINE_STEPS; step += 1) {
      const end = step / OUTLINE_STEPS;
      const here = step === 3 * OUTLINE_STEPS ? first : inkOf(place(end));
      // Every change within the step, in order (a band thinner than a step that ends inside it
      // is two): so that the walk finds the same cuts in either direction.
      for (
        let from = end - 1 / OUTLINE_STEPS, tries = 0;
        !same(here, before) && tries < 3;
        tries += 1
      ) {
        let lo = from;
        let hi = end;
        for (let i = 0; i < CUT_STEPS; i += 1) {
          const mid = (lo + hi) / 2;
          if (same(inkOf(place(mid)), before)) lo = mid;
          else hi = mid;
        }
        before = hi === end ? here : inkOf(place(hi));
        cuts.push({ along: (lo + hi) / 2, after: before });
        from = hi;
      }
      before = here;
    }

    /**
     * Where each corner stands on the line through two places: a half ON the line, more than a
     * half on the side where `inside` lies.
     */
    const line = (p: Flat, q: Flat, inside: Flat): number[] | null => {
      const f = ([x, y]: Flat): number => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
      const at = [f([0, 0]), f([1, 0]), f([0, 1])];
      const most = Math.max(...at.map(Math.abs));
      const side = f(inside);
      if (most < 1e-9 || Math.abs(side) < 1e-12) return null;
      return at.map((value) => 0.5 + (0.5 * Math.sign(side) * value) / most);
    };
    /** A place on the outline between two cuts (the second may lie past the first corner again). */
    const between = (from: number, to: number): Flat =>
      place((from + (to < from ? to + 3 : to)) / 2);
    const count = cuts.length;
    if (count === 0) {
      builder.triangle(a.at, b.at, c.at, rgb(first), { n });
      return;
    }
    /** Cut i, counted round the outline (cut `count` is cut 0 again). */
    const cut = (i: number): { along: number; after: Ink } =>
      cuts[((i % count) + count) % count] ?? { along: 0, after: first };
    /** The colour of the stretch of outline that begins at cut i, and the line that cuts it off. */
    const side = (from: number, to: number): { c: Rgb; k: number[] } | null => {
      const k = line(
        place(cut(from).along),
        place(cut(to).along),
        between(cut(from).along, cut(to).along),
      );
      return k && { c: rgb(cut(from).after), k };
    };

    if (count === 3) {
      // Three colours meet: the third is cut off by a line, and the other two part at its middle.
      const p = place(cut(1).along);
      const q = place(cut(2).along);
      const over = side(1, 2);
      const k = line(
        place(cut(0).along),
        [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2],
        between(cut(0).along, cut(1).along),
      );
      if (k && over) {
        builder.triangle(a.at, b.at, c.at, rgb(first), {
          n,
          side: { c: rgb(cut(0).after), k },
          over,
        });
        return;
      }
    }

    // Otherwise the facet is cut by lines that do not meet in it: bands of height, a stripe, one
    // edge of paint. Its middle's colour is kept, with the two lines nearest the middle: where
    // that colour touches the outline twice, one line on each side of it; where it touches once
    // (a corner, or one side of a single line), the line that bounds it and the next one out.
    // Whatever lies beyond a second line (a fourth band in one facet) takes its neighbour's
    // colour: a sliver in a corner.
    const middle = inkOf([1 / 3, 1 / 3]);
    const touches = cuts.flatMap((_, i) => (same(cut(i).after, middle) ? [i] : []));
    const [i, j] = touches;
    if (i !== undefined && touches.length <= 2) {
      const lines =
        j !== undefined
          ? [side(i + 1, j), side(j + 1, i)]
          : [side(i + 1, i), count >= 4 ? side(i + 2, i - 1) : null];
      const [near, far] = lines;
      if (near) {
        builder.triangle(a.at, b.at, c.at, rgb(middle), {
          n,
          side: near,
          ...(far ? { over: far } : {}),
        });
        return;
      }
    }
    // A knot of colours no two lines can part: its middle's.
    builder.triangle(a.at, b.at, c.at, rgb(middle), { n });
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
        facet(p, q, r);

        const s = rows[i + 1]?.[j + 1];
        if (s) facet(q, s, r);
      }
    }
    yield;
  }

  // Every facet came with its normals: there is nothing to round.
  return builder.build(false);
}

/** Run a generator to its end in one go (tests, and bodies too small to be worth slicing). */
export function finish<T>(job: Generator<void, T>): T {
  for (;;) {
    const step = job.next();
    if (step.done) return step.value;
  }
}
