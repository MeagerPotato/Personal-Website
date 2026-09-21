import type { BodyField } from './assist';
import type { ShipState, Vec2 } from './types';

/**
 * YOU CANNOT CRASH, AND YOU CANNOT GET LOST. Three gentle kinds of "no":
 *
 * - a CUSHION above every surface: a damped spring that slows a ship sinking into it;
 * - a SHELL under the cushion that nothing passes: a ship that still gets there is put back on
 *   it and keeps a fifth of its impact speed, so a hard hit reads as a soft bump;
 * - the EDGE of the world: no wall, only a pull back toward the middle that grows the further
 *   out a ship insists on going, until it outgrows any engine.
 *
 * All of it is measured in the frame of the body, which may be moving: a planet that sweeps over
 * a parked ship nudges it along instead of swallowing it.
 */

export interface CushionParams {
  /** The cushion starts this far above a surface, u. */
  readonly depth: number;
  /** Nothing gets closer to a surface than this, u. */
  readonly shellGap: number;
  /**
   * Outward push where the cushion meets the shell, u/s². It is zero at the top of the cushion
   * and grows linearly. Keep it above the ship's boosted thrust, or a boosting ship rides the shell.
   */
  readonly accel: number;
  /** 1/s: soaks up the speed of an impact, so the cushion is a pillow and not a trampoline. */
  readonly damping: number;
  /** Share of the impact speed a ship keeps when it does reach the shell. */
  readonly restitution: number;
}

export interface EdgeParams {
  /** The world ends this far beyond the outermost system, u. */
  readonly margin: number;
  /** The pull home, in u/s² per unit travelled past the edge. */
  readonly pullPerUnit: number;
}

/** Where the world ends: a circle on the flight plane. */
export interface WorldEdge {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/** The edge that contains every system, centred on `home`. */
export function worldEdge(
  systems: readonly { readonly position: readonly [number, number]; readonly radius: number }[],
  home: readonly [x: number, z: number],
  margin: number,
): WorldEdge {
  let reach = 0;
  for (const system of systems) {
    const distance = Math.hypot(system.position[0] - home[0], system.position[1] - home[1]);
    reach = Math.max(reach, distance + system.radius);
  }
  return { x: home[0], z: home[1], radius: reach + margin };
}

/** ADDS the push of every cushion the ship is inside to `out`, in u/s². */
export function addCushions(
  field: BodyField,
  state: Readonly<ShipState>,
  params: CushionParams,
  out: Vec2,
): Vec2 {
  const span = Math.max(params.depth - params.shellGap, 1e-6);
  for (let i = 0; i < field.count; i += 1) {
    const surface = field.radius[i] ?? 0;
    if (!(surface > 0)) continue;
    const rx = state.x - (field.positions[i * 2] ?? 0);
    const rz = state.z - (field.positions[i * 2 + 1] ?? 0);
    const d = Math.hypot(rx, rz);
    const top = surface + params.depth;
    if (d >= top || d < 1e-9) continue;

    const nx = rx / d;
    const nz = rz / d;
    // 0 at the top of the cushion, 1 at the shell.
    const sink = Math.min((top - d) / span, 1);
    const outward =
      (state.vx - (field.velocities[i * 2] ?? 0)) * nx +
      (state.vz - (field.velocities[i * 2 + 1] ?? 0)) * nz;
    // The damping is scaled by the same `sink`, so nothing jumps where the cushion begins, and
    // the sum never pulls a leaving ship back down.
    const push = Math.max(0, (params.accel - params.damping * outward) * sink);
    out.x += push * nx;
    out.z += push * nz;
  }
  return out;
}

/**
 * Put a ship that got under a shell back on it. Returns the row of the body it touched, or -1.
 * Run it AFTER the flight step, against where the bodies are at the end of that step.
 */
export function resolveShells(field: BodyField, state: ShipState, params: CushionParams): number {
  let touched = -1;
  for (let i = 0; i < field.count; i += 1) {
    const surface = field.radius[i] ?? 0;
    if (!(surface > 0)) continue;
    const limit = surface + params.shellGap;
    const bodyX = field.positions[i * 2] ?? 0;
    const bodyZ = field.positions[i * 2 + 1] ?? 0;
    let nx = state.x - bodyX;
    let nz = state.z - bodyZ;
    const d = Math.hypot(nx, nz);
    if (d >= limit) continue;

    if (d < 1e-9) {
      // Dead centre: every way out is as good as another.
      nx = 0;
      nz = 1;
    } else {
      nx /= d;
      nz /= d;
    }
    state.x = bodyX + nx * limit;
    state.z = bodyZ + nz * limit;

    const bodyVx = field.velocities[i * 2] ?? 0;
    const bodyVz = field.velocities[i * 2 + 1] ?? 0;
    const outward = (state.vx - bodyVx) * nx + (state.vz - bodyVz) * nz;
    if (outward < 0) {
      const bounce = -(1 + params.restitution) * outward;
      state.vx += bounce * nx;
      state.vz += bounce * nz;
    }
    touched = i;
  }
  return touched;
}

/** ADDS the pull back from beyond the edge of the world to `out`, in u/s². */
export function addEdgePull(
  edge: WorldEdge,
  state: Readonly<ShipState>,
  params: EdgeParams,
  out: Vec2,
): Vec2 {
  const rx = state.x - edge.x;
  const rz = state.z - edge.z;
  const d = Math.hypot(rx, rz);
  const past = d - edge.radius;
  if (past <= 0) return out;
  const pull = (params.pullPerUnit * past) / d;
  out.x -= pull * rx;
  out.z -= pull * rz;
  return out;
}

/** How far past the edge of the world a point is, in units. 0 inside it. For the HUD's hint. */
export function pastEdge(edge: WorldEdge, x: number, z: number): number {
  return Math.max(0, Math.hypot(x - edge.x, z - edge.z) - edge.radius);
}
