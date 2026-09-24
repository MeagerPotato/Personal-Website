import type { BodyField } from './assist';
import type { ShipState } from './types';

/**
 * THE REFLEX: how fast a ship flown by the autopilot (sim/autopilot.ts) or by the approach
 * (sim/docking.ts) may go on its own COURSE, whatever its plan says. A plan keeps its path clear
 * of everything; a ship does not always keep to its plan. It was asked somewhere new at speed,
 * behind it or across its course; the plan turns back on itself; a bend was taken too wide; a
 * body within reach was asked for while the ship raced past it. Then the ship is going where
 * nobody planned, and this is what brakes it before it meets something there. On a plan that is
 * being flown, it asks for nothing: the plan was slower already.
 *
 * A course is a straight line from where the ship is: the way it is going, and the way its nose
 * points (a ship turning hard is about to go that way; in a bend it has planned, its nose is never
 * turned far enough toward a body to matter). What it runs into is a body it passes closer than
 * REFLEX_CLEAR above the surface (further out it meets the cushion at most, sim/collide.ts), and
 * the ship must be able to stop short of that: no faster than `gain` times the way still to go.
 * Braking as hard as it can, a ship decays faster than that, so a ship held to it never meets the
 * shell.
 *
 * Pure and allocation-free, like the rest of sim/.
 */

/**
 * u. A course that passes further than this above a body's surface meets its cushion at most (the
 * shell is cushion.shellGap above the surface), and sets no limit.
 */
export const REFLEX_CLEAR = 3;
/**
 * u/s. The reflex never asks for less than this: the cushions stop a ship this slow by themselves,
 * and a ship brought to rest beside a moon must still be free to set out along a path that begins
 * a little toward it.
 */
export const REFLEX_FLOOR = 5;
/**
 * s. A ship with no plan (the approach, which flies straight for a ring) keeps this much more
 * clear of everything for each u/s it goes: at 130 u/s, 6.5 u more. With a plan, the plan keeps
 * clear, and the reflex only has to catch what strays from it (courseLimits' `leadSec` 0).
 * Measured with the journey harness's stress test (scripts/journeys/stress.ts): without it, one
 * body in a hundred asked for from within reach at cruise speed was passed closer than half a
 * cushion; with it, none, and the closest any came was 2.7 u above a surface.
 */
export const REFLEX_LEAD_SEC = 0.05;

/**
 * The reflex's limits (u/s) for a ship at `state`, now and `ahead` u further along its course:
 * written to `out` as [here, ahead], Infinity where nothing is in the way. `target`, the body the
 * ship is going to, is never in the way: its own pilot brings the ship onto its ring. `gain` (1/s)
 * must stay below what the brake can do (brakeDrag + forwardDrag of the drive that flies it):
 * CruiseParams.openSpaceGain, the same rule the plans slow down by beside a keep-out. `leadSec`
 * widens the berth with speed (REFLEX_LEAD_SEC for a ship with no plan, else 0).
 */
export function courseLimits(
  field: BodyField,
  state: Readonly<ShipState>,
  target: number,
  ahead: number,
  gain: number,
  leadSec: number,
  out: Float64Array,
): Float64Array {
  out[0] = Infinity;
  out[1] = Infinity;
  const speed = Math.hypot(state.vx, state.vz);
  if (!(speed > 1e-6)) return out;
  const clear = REFLEX_CLEAR + speed * leadSec;
  const { heading } = state;
  limitAlong(field, state, target, ahead, gain, state.vx / speed, state.vz / speed, clear, out);
  limitAlong(field, state, target, ahead, gain, Math.sin(heading), Math.cos(heading), clear, out);
  return out;
}

/** courseLimits along one straight course, the unit vector (ux, uz), into `out`. */
function limitAlong(
  field: BodyField,
  state: Readonly<ShipState>,
  target: number,
  ahead: number,
  gain: number,
  ux: number,
  uz: number,
  clear: number,
  out: Float64Array,
): void {
  for (let j = 0; j < field.count; j += 1) {
    const surface = field.radius[j] ?? 0;
    if (j === target || !(surface > 0)) continue;
    const dx = (field.positions[j * 2] ?? 0) - state.x;
    const dz = (field.positions[j * 2 + 1] ?? 0) - state.z;
    // How far along the course the body is passed, and how close.
    const along = ux * dx + uz * dz;
    if (!(along > 0)) continue;
    const miss = dx * dx + dz * dz - along * along;
    const danger = surface + clear;
    if (miss >= danger * danger) continue;
    const toGo = Math.max(0, along - Math.sqrt(danger * danger - Math.max(0, miss)));
    for (let k = 0; k < 2; k += 1) {
      const limit = Math.max(REFLEX_FLOOR, gain * (toGo - (k === 0 ? 0 : ahead)));
      if (limit < (out[k] ?? Infinity)) out[k] = limit;
    }
  }
}
