import { TAU } from './math';

/**
 * WHERE EVERYTHING IS, as a pure function of time (docs/PLAN.md §5.5). Planets circle their sun,
 * moons circle their planet, and nobody caches a world position: whoever needs one asks for the
 * time it cares about. The simulation asks for the time of its step, the renderer for the exact
 * time of its frame, so bodies move smoothly at any frame rate with nothing to interpolate.
 *
 * Shapes are structural on purpose: this file knows nothing about the manifest, only about the
 * few fields it reads from it, so it stays pure and the manifest stays free to grow.
 */
export interface OrbitingBody {
  readonly id: string;
  /** Id of the body it circles, or null when it sits still at the centre of its system. */
  readonly parent: string | null;
  readonly system: string;
  readonly orbit: {
    readonly radius: number;
    readonly phase: number;
    readonly periodSec: number;
  } | null;
}

export interface OrbitingSystem {
  readonly id: string;
  /** [x, z] on the flight plane. */
  readonly position: readonly [number, number];
}

/** The orbits of a galaxy, flattened into arrays so that a whole pass allocates nothing. */
export interface OrbitTable {
  readonly count: number;
  readonly ids: readonly string[];
  /** Index of the parent in this table, or -1. Parents always come BEFORE their children. */
  readonly parent: Int32Array;
  readonly centerX: Float64Array;
  readonly centerZ: Float64Array;
  readonly radius: Float64Array;
  readonly phase: Float64Array;
  /** Radians per second; positive is counter-clockwise seen from above. */
  readonly rate: Float64Array;
  indexOf(id: string): number;
}

export function createOrbitTable(
  systems: readonly OrbitingSystem[],
  bodies: readonly OrbitingBody[],
): OrbitTable {
  const systemById = new Map(systems.map((system) => [system.id, system]));
  const bodyById = new Map(bodies.map((body) => [body.id, body]));

  // Order parents before children, whatever order the manifest lists them in.
  const ordered: OrbitingBody[] = [];
  const placed = new Set<string>();
  const place = (body: OrbitingBody, trail: readonly string[]): void => {
    if (placed.has(body.id)) return;
    if (trail.includes(body.id)) throw new Error(`orbits: '${body.id}' circles itself`);
    if (body.parent !== null) {
      const parent = bodyById.get(body.parent);
      if (!parent) throw new Error(`orbits: '${body.id}' circles unknown '${body.parent}'`);
      place(parent, [...trail, body.id]);
    }
    placed.add(body.id);
    ordered.push(body);
  };
  for (const body of bodies) place(body, []);

  const count = ordered.length;
  const index = new Map(ordered.map((body, i) => [body.id, i]));
  const table = {
    count,
    ids: ordered.map((body) => body.id),
    parent: new Int32Array(count).fill(-1),
    centerX: new Float64Array(count),
    centerZ: new Float64Array(count),
    radius: new Float64Array(count),
    phase: new Float64Array(count),
    rate: new Float64Array(count),
    indexOf: (id: string): number => index.get(id) ?? -1,
  };

  ordered.forEach((body, i) => {
    const system = systemById.get(body.system);
    if (!system) throw new Error(`orbits: '${body.id}' is in unknown system '${body.system}'`);
    table.parent[i] = body.parent === null ? -1 : (index.get(body.parent) ?? -1);
    table.centerX[i] = system.position[0];
    table.centerZ[i] = system.position[1];
    if (body.orbit) {
      table.radius[i] = body.orbit.radius;
      table.phase[i] = body.orbit.phase;
      table.rate[i] = body.orbit.periodSec > 0 ? TAU / body.orbit.periodSec : 0;
    }
  });
  return table;
}

/**
 * Positions of every body at time `t`, written as [x0, z0, x1, z1, ...] into `out` (length
 * 2 * count). With `velocities`, how fast each one moves, in units per second, as well.
 */
export function bodyPositions(
  table: OrbitTable,
  t: number,
  out: Float64Array,
  velocities?: Float64Array,
): Float64Array {
  for (let i = 0; i < table.count; i += 1) {
    const parent = table.parent[i] ?? -1;
    const radius = table.radius[i] ?? 0;
    const rate = table.rate[i] ?? 0;
    const angle = (table.phase[i] ?? 0) + rate * t;
    // The universe's angle convention: 0 along +Z, counter-clockwise from above (sim/math.ts).
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);

    // A body with no parent sits at its system's centre, or circles that centre.
    const baseX = parent < 0 ? (table.centerX[i] ?? 0) : (out[parent * 2] ?? 0);
    const baseZ = parent < 0 ? (table.centerZ[i] ?? 0) : (out[parent * 2 + 1] ?? 0);
    out[i * 2] = baseX + radius * sin;
    out[i * 2 + 1] = baseZ + radius * cos;

    if (velocities) {
      const baseVx = parent < 0 ? 0 : (velocities[parent * 2] ?? 0);
      const baseVz = parent < 0 ? 0 : (velocities[parent * 2 + 1] ?? 0);
      velocities[i * 2] = baseVx + radius * rate * cos;
      velocities[i * 2 + 1] = baseVz - radius * rate * sin;
    }
  }
  return out;
}

/**
 * Position of ONE body at time `t`, written to `out` as [x, z]: for whoever cares about
 * different bodies at different times (the autopilot: each body when the ship passes it).
 */
export function bodyPositionAt(
  table: OrbitTable,
  i: number,
  t: number,
  out: Float64Array,
): Float64Array {
  const parent = table.parent[i] ?? -1;
  if (parent >= 0) bodyPositionAt(table, parent, t, out);
  else {
    out[0] = table.centerX[i] ?? 0;
    out[1] = table.centerZ[i] ?? 0;
  }
  const radius = table.radius[i] ?? 0;
  const angle = (table.phase[i] ?? 0) + (table.rate[i] ?? 0) * t;
  out[0] = (out[0] ?? 0) + radius * Math.sin(angle);
  out[1] = (out[1] ?? 0) + radius * Math.cos(angle);
  return out;
}
