import type { CruiseState } from './autopilot';
import {
  HYPER_NONE,
  HYPER_OFFERED,
  HYPER_SPENT,
  HYPER_TUNNEL,
  HYPER_WINDUP,
  type DockState,
  type Hyper,
} from './docking';

/**
 * HYPERSPACE: a journey's fast stretch, shown as a jump. It is the SAME flight: nothing here
 * steers, pushes or hurries the ship. This file only reads the autopilot's plan and the ship's
 * speed, and writes two fields of the dock (`hyper`, `hyperSec`) that nothing in flight reads;
 * the picture (world/Hyperspace.ts), the lens and the chip follow those. The journeys harness
 * flies every journey with and without a jump and holds them equal, bit for bit.
 *
 *   NONE     nothing yet on this journey
 *   OFFERED  the plan ahead pays: fast enough, for long enough. Nobody has pressed.
 *   WINDUP   pressed. The stars are pulled out, and the tunnel opens once the ship is fast.
 *   TUNNEL   until the plan ahead never reaches `dropSpeed` again: the drop-out.
 *   SPENT    this journey has had its offer, or its jump: neither comes back.
 *
 * One offer and one jump a journey: an offer that went away and came back would be a chip that
 * flickers. A new destination is a new journey (sim/docking.ts, endHyper).
 *
 * Pure and allocation-free, like the rest of sim/.
 */
export interface HyperParams {
  /** u/s. No offer unless the plan ahead still reaches this. */
  readonly minPlannedSpeed: number;
  /** u/s. The fast stretch: for as long as the plan ahead still has a sample this fast. */
  readonly dropSpeed: number;
  /** u/s. The tunnel opens at this speed... */
  readonly punchSpeed: number;
  /** s. ...and never sooner than this after the press. */
  readonly windupSec: number;
  /** s. No offer unless a wind-up and this much of the fast stretch are still ahead. */
  readonly minTunnelSec: number;
}

export interface Ahead {
  /** The top planned speed still ahead, u/s. */
  peak: number;
  /** Planned seconds until the last sample at the floor or faster. 0: none ahead. */
  fastSec: number;
}

/**
 * What the plan still holds, from the piece of the path the ship is on: the top planned speed
 * ahead, and the planned seconds until the last sample at `floor` or faster. A journey with no
 * plan yet (its first step makes one) has nothing ahead.
 */
export function fastAhead(cruise: Readonly<CruiseState>, floor: number, out: Ahead): Ahead {
  const { path, speeds } = cruise;
  out.peak = 0;
  out.fastSec = 0;
  if (cruise.fresh || path.count < 2) return out;
  const from = Math.max(0, cruise.index);
  let time = 0;
  for (let k = from; k < path.count; k += 1) {
    const v = speeds[k] ?? 0;
    if (k > from) {
      // The time across a piece, at the mean of the speeds at its two ends.
      time += (2 * ((path.s[k] ?? 0) - (path.s[k - 1] ?? 0))) / ((speeds[k - 1] ?? 0) + v || 1);
    }
    if (v > out.peak) out.peak = v;
    if (v >= floor) out.fastSec = time;
  }
  return out;
}

/** A tunnel that would be shorter than this share of `minTunnelSec` is not opened: no stub. */
const LEAST_TUNNEL = 0.8;
/** s. Steps of 1/60 s do not add up to a round number of seconds exactly. */
const EPSILON = 1e-9;
/** A tunnel taken up after the engine was rebuilt is this many seconds in: past its punch. */
const RESUMED_SEC = 1;

const ahead: Ahead = { peak: 0, fastSec: 0 };

function become(dock: DockState, hyper: Hyper): void {
  dock.hyper = hyper;
  dock.hyperSec = 0;
}

/**
 * One step of a journey flown by the autopilot (flyStep, straight after the autopilot's own
 * step: the plan read here is this journey's, never the last one's). `speed` is the ship's, u/s.
 */
export function stepHyper(
  dock: DockState,
  cruise: Readonly<CruiseState>,
  speed: number,
  params: HyperParams,
  dt: number,
): void {
  if (dock.hyper === HYPER_SPENT) return;
  const { peak, fastSec } = fastAhead(cruise, params.dropSpeed, ahead);
  const pays = peak >= params.minPlannedSpeed && fastSec >= params.windupSec + params.minTunnelSec;
  dock.hyperSec += dt;
  switch (dock.hyper) {
    case HYPER_NONE:
      // (A plan that only pays later, after a replan, may still offer.)
      if (pays) become(dock, HYPER_OFFERED);
      break;
    case HYPER_OFFERED:
      if (!pays) become(dock, HYPER_SPENT);
      break;
    case HYPER_WINDUP:
      // The fast stretch ended before the tunnel opened: no jump.
      if (!(fastSec > 0)) become(dock, HYPER_SPENT);
      else if (dock.hyperSec >= params.windupSec - EPSILON && speed >= params.punchSpeed) {
        // The punch; or, pressed too late for more than a stub of a tunnel, nothing.
        become(dock, fastSec >= LEAST_TUNNEL * params.minTunnelSec ? HYPER_TUNNEL : HYPER_SPENT);
      }
      break;
    case HYPER_TUNNEL:
      // The drop-out. (A slow bend in the middle of a long journey does not close the tunnel:
      // the plan beyond it is fast again, and the picture thins by itself there.)
      if (!(fastSec > 0)) become(dock, HYPER_SPENT);
      break;
  }
}

/** The press: an offer is taken. False when there is none to take. */
export function engageHyper(dock: DockState): boolean {
  if (dock.hyper !== HYPER_OFFERED) return false;
  become(dock, HYPER_WINDUP);
  return true;
}

/**
 * The press was half of a chord (Shift+Tab): the wind-up is taken back and the offer stands
 * again. False once the tunnel has opened, and whenever there is no wind-up.
 */
export function cancelHyper(dock: DockState): boolean {
  if (dock.hyper !== HYPER_WINDUP) return false;
  become(dock, HYPER_OFFERED);
  return true;
}

/**
 * A journey taken up again after the engine was rebuilt in the tunnel (core/snapshot.ts): in the
 * tunnel, past its punch. Only on a journey the autopilot flies; its first step holds it to the
 * new plan, as any other step does.
 */
export function resumeHyper(dock: DockState): void {
  if (dock.phase !== 'cruise') return;
  dock.hyper = HYPER_TUNNEL;
  dock.hyperSec = RESUMED_SEC;
}
