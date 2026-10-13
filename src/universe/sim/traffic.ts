import { TAU } from './math';
import type { OrbitTable } from './orbits';
import { createRng } from './rng';

/**
 * TRAFFIC: two dots on an orbit line, one going each way, at one speed along the line whatever
 * its size (docs/DESIGN.md, "Deep light"). Where a dot is, is a pure function of the time, as
 * where its orbit is (sim/orbits.ts): nobody stores it, so an engine rebuilt from its snapshot
 * draws the same dots, and at time zero they rest where they start.
 *
 * Pure: no three.js, no DOM, no clock.
 */
export interface TrafficParams {
  /** Only an orbit at least this large has traffic (u). */
  readonly minOrbitRadiusU: number;
  /** A dot's speed along its line (u/s). */
  readonly speedUPerSec: number;
  /** How large the two dots of a line are (CSS px): the one going with the orbits, the other. */
  readonly sizesPx: readonly number[];
  /** Places the dots: each orbit draws from this and its own id, so a new orbit moves no other's. */
  readonly seed: string;
}

/** The dots of a galaxy, flattened as the orbits are, so that placing them allocates nothing. */
export interface TrafficDots {
  readonly count: number;
  /** The row, in the orbit table, of the body whose orbit a dot is on. */
  readonly row: Int32Array;
  /** Where on the circle it starts, radians (0 along +Z, as the orbits count). */
  readonly phase: Float64Array;
  /** Radians per second; positive goes the way the orbits do. */
  readonly rate: Float64Array;
  /** CSS px across. */
  readonly sizePx: Float32Array;
}

/**
 * The dots of `orbits`: two on every orbit of at least `minOrbitRadiusU` that `runs` says has
 * any (a relay's has none: nothing docks there, so nothing goes there).
 */
export function trafficDots(
  orbits: OrbitTable,
  runs: (row: number) => boolean,
  params: TrafficParams,
): TrafficDots {
  const rows: number[] = [];
  for (let row = 0; row < orbits.count; row += 1) {
    const radius = orbits.radius[row] ?? 0;
    if (radius > 0 && radius >= params.minOrbitRadiusU && runs(row)) rows.push(row);
  }
  const count = rows.length * 2;
  const dots = {
    count,
    row: new Int32Array(count),
    phase: new Float64Array(count),
    rate: new Float64Array(count),
    sizePx: new Float32Array(count),
  };
  rows.forEach((row, i) => {
    const rng = createRng(`${params.seed}/${orbits.ids[row] ?? row}`);
    const turn = params.speedUPerSec / (orbits.radius[row] ?? 1);
    for (let k = 0; k < 2; k += 1) {
      const dot = i * 2 + k;
      dots.row[dot] = row;
      dots.phase[dot] = rng() * TAU;
      dots.rate[dot] = k === 0 ? turn : -turn;
      dots.sizePx[dot] = params.sizesPx[k] ?? params.sizesPx[0] ?? 0;
    }
  });
  return dots;
}

/**
 * Every dot at time `t` (s), written into `out` as [x, size, z] a dot: where it is on the flight
 * plane, and how large it is drawn (CSS px), which is nothing when its orbit is not drawn
 * (`scales`: how big each body is drawn, by row; the star map has no room for some).
 * `positions` are the bodies' at the same time, [x0, z0, x1, z1, ...] (sim/orbits.ts): a moon's
 * orbit rides its planet.
 */
export function placeTraffic(
  dots: TrafficDots,
  orbits: OrbitTable,
  positions: ArrayLike<number>,
  scales: ArrayLike<number>,
  t: number,
  out: Float32Array,
): Float32Array {
  for (let i = 0; i < dots.count; i += 1) {
    const row = dots.row[i] ?? 0;
    const parent = orbits.parent[row] ?? -1;
    const x = parent < 0 ? (orbits.centerX[row] ?? 0) : (positions[parent * 2] ?? 0);
    const z = parent < 0 ? (orbits.centerZ[row] ?? 0) : (positions[parent * 2 + 1] ?? 0);
    const radius = orbits.radius[row] ?? 0;
    const angle = (dots.phase[i] ?? 0) + (dots.rate[i] ?? 0) * t;
    out[i * 3] = x + radius * Math.sin(angle);
    out[i * 3 + 1] = (scales[row] ?? 1) > 1e-4 ? (dots.sizePx[i] ?? 0) : 0;
    out[i * 3 + 2] = z + radius * Math.cos(angle);
  }
  return out;
}
