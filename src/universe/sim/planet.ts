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

export interface PlanetSpec {
  readonly radius: number;
  readonly seed: string;
  /** Subdivisions per icosahedron edge, minus one: the mesh has 20 * (detail + 1)^2 triangles. */
  readonly detail: number;
  readonly bands: PlanetBands;
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

export function planetTriangleCount(detail: number): number {
  return 20 * (detail + 1) * (detail + 1);
}

interface Corner {
  at: Point;
  /** 0 to 1 above the sea, or -1 for the sea itself. */
  land: number;
}

export function* generatePlanet(spec: PlanetSpec, look: PlanetLook): Generator<void, MeshData> {
  const noise = createNoise3(spec.seed);
  const paint = createRng(`${spec.seed}/paint`);
  const builder = new MeshBuilder();
  const n = spec.detail + 1;

  const corner = (x: number, y: number, z: number): Corner => {
    const length = Math.hypot(x, y, z);
    const dx = x / length;
    const dy = y / length;
    const dz = z / length;
    const f = look.frequency;
    const raw = fbm(noise, dx * f, dy * f, dz * f, look.octaves);
    if (raw <= look.seaLevel)
      return { at: [dx * spec.radius, dy * spec.radius, dz * spec.radius], land: -1 };

    const smooth = Math.min(1, (raw - look.seaLevel) / (look.peakAt - look.seaLevel));
    const stepped = Math.floor(smooth * look.terraces) / look.terraces;
    const land = smooth + (stepped - smooth) * look.terraceStrength;
    const r = spec.radius * (1 + look.reliefShare * land);
    return { at: [dx * r, dy * r, dz * r], land };
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
    const nudge = 1 + (paint() * 2 - 1) * look.colorJitter;
    return [
      Math.min(1, band[0] * nudge),
      Math.min(1, band[1] * nudge),
      Math.min(1, band[2] * nudge),
    ];
  };

  for (const [ia, ib, ic] of FACES) {
    const a = CORNERS[ia];
    const b = CORNERS[ib];
    const c = CORNERS[ic];
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
