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

// --- the look ----------------------------------------------------------------------------------

/**
 * WHAT A JUMP LOOKS LIKE at one moment, as numbers from 0 to 1 that the picture
 * (world/Hyperspace.ts), the stars, the lens and the flame each read their part of. One pure
 * function decides all of it, so the lab, the tests and a flight show the same jump.
 */
export interface HyperLook {
  /** How far the dots over the stars are pulled out into dashes: 0 is a dot, a star. */
  stretch: number;
  /** How much of those dots shows. */
  dots: number;
  /** The tunnel: how far it has opened from its eye outward, and how much of it shows. */
  veil: number;
  /** How much of the real stars' dimming is on (main.ts, `starCalm`). */
  calm: number;
  /**
   * Where the lens and the flame are headed (camera/ChaseCam.ts, ship/EngineFlame.ts). It
   * STEPS, at the punch and at the drop-out; they ease after it.
   */
  surge: number;
  /** The ring that races out from the eye at the punch: 0 to 1 on its way, -1 for none. */
  punch: number;
  /** The ring that closes onto the destination as the tunnel goes: 0 to 1, -1 for none. */
  drop: number;
}

export function createHyperLook(): HyperLook {
  return { stretch: 0, dots: 0, veil: 0, calm: 0, surge: 0, punch: -1, drop: -1 };
}

export function copyHyperLook(from: Readonly<HyperLook>, to: HyperLook): HyperLook {
  to.stretch = from.stretch;
  to.dots = from.dots;
  to.veil = from.veil;
  to.calm = from.calm;
  to.surge = from.surge;
  to.punch = from.punch;
  to.drop = from.drop;
  return to;
}

/** Where a jump's picture is: nothing shows, the wind-up, the tunnel, or on its way out. */
export const LOOK_OFF = 0;
export const LOOK_WINDUP = 1;
export const LOOK_TUNNEL = 2;
export const LOOK_DROPOUT = 3;
export type LookStage =
  typeof LOOK_OFF | typeof LOOK_WINDUP | typeof LOOK_TUNNEL | typeof LOOK_DROPOUT;

export interface HyperLookParams extends Pick<HyperParams, 'punchSpeed' | 'windupSec'> {
  /** s. Any way out of a wind-up or a tunnel, the picture has gone this long after. */
  readonly dropoutSec: number;
}

export interface LookAt {
  stage: LookStage;
  /** Seconds in that stage; on the way out, since the picture was last on. */
  seconds: number;
  /** The ship's speed, and the fastest the autopilot cruises (cruise.far.cruiseSpeed), u/s. */
  speed: number;
  topSpeed: number;
  /** On the way out: what was showing when it began, and whether that was the tunnel. */
  level: Readonly<HyperLook>;
  fromTunnel: boolean;
}

/**
 * The cut sheet, in seconds. The wind-up: the dots come up between DOTS_AFTER and DOTS_AFTER +
 * DOTS_SEC. The tunnel: the dashes shoot out in SHOOT_SEC, the tube opens in OPEN_SEC, the real
 * stars are down in STARS_SEC, and the punch ring is out in RING_SEC.
 */
const DOTS_AFTER = 0.08;
const DOTS_SEC = 0.12;
const SHOOT_SEC = 0.1;
const OPEN_SEC = 0.22;
const STARS_SEC = 0.12;
const RING_SEC = 0.35;
/** How much of each is there when the tunnel opens (what the wind-up built up to). */
const WOUND_STRETCH = 0.35;
const WOUND_VEIL = 0.15;
const WOUND_CALM = 0.3;
const WOUND_SURGE = 0.3;
/** A slow bend in a long journey thins the picture: gone under this share of the punch speed. */
const THIN_SHARE = 0.4;
/** The dashes at the punch speed are this share of their length at the top speed. */
const SLOW_STRETCH = 0.45;
/** Shares of the drop-out: the dashes are points by then, the tube gone, the dots start to go. */
const POINTS_BY = 5 / 7;
const TUBE_BY = 6 / 7;
const DOTS_FROM = 4 / 7;

const unit = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOutCubic = (x: number): number => 1 - (1 - unit(x)) ** 3;
const easeInCubic = (x: number): number => unit(x) ** 3;
const smooth = (x: number): number => {
  const t = unit(x);
  return t * t * (3 - 2 * t);
};

/**
 * The look at `at`, into `out`. Every part is continuous through a jump, with two steps meant
 * as they are: the punch (the dashes and `surge` jump as the tunnel opens) and `surge` going at
 * the drop-out. A tunnel taken up after a rebuild comes a second in: nothing of its punch.
 */
export function hyperLook(
  at: Readonly<LookAt>,
  params: HyperLookParams,
  out: HyperLook,
): HyperLook {
  const s = Math.max(0, at.seconds);
  out.punch = -1;
  out.drop = -1;
  if (at.stage === LOOK_WINDUP) {
    const w = unit(s / params.windupSec);
    out.stretch = WOUND_STRETCH * w * w * Math.max(0.25, unit(at.speed / params.punchSpeed));
    out.dots = unit((s - DOTS_AFTER) / DOTS_SEC);
    out.veil = WOUND_VEIL * w;
    out.calm = WOUND_CALM * w;
    out.surge = WOUND_SURGE * w;
  } else if (at.stage === LOOK_TUNNEL) {
    const g = smooth((at.speed / params.punchSpeed - THIN_SHARE) / (1 - THIN_SHARE));
    const q = unit(at.speed / at.topSpeed);
    out.stretch =
      (WOUND_STRETCH + (1 - WOUND_STRETCH) * easeOutCubic(s / SHOOT_SEC)) *
      (SLOW_STRETCH + (1 - SLOW_STRETCH) * q) *
      g;
    out.dots = g;
    out.veil = (WOUND_VEIL + (1 - WOUND_VEIL) * easeOutCubic(s / OPEN_SEC)) * g;
    out.calm = unit(WOUND_CALM + ((1 - WOUND_CALM) * s) / STARS_SEC) * g;
    out.surge = g;
    if (s <= RING_SEC) out.punch = s / RING_SEC;
  } else if (at.stage === LOOK_DROPOUT && s < params.dropoutSec) {
    const x = s / params.dropoutSec;
    const { level } = at;
    out.stretch = level.stretch * (1 - easeInCubic(x / POINTS_BY));
    out.dots = level.dots * (1 - smooth((x - DOTS_FROM) / (1 - DOTS_FROM)));
    out.veil = level.veil * (1 - easeOutCubic(x / TUBE_BY));
    out.calm = level.calm * (1 - x * x);
    out.surge = 0;
    if (at.fromTunnel && x <= TUBE_BY) out.drop = x / TUBE_BY;
  } else {
    out.stretch = 0;
    out.dots = 0;
    out.veil = 0;
    out.calm = 0;
    out.surge = 0;
  }
  return out;
}

/**
 * THE REAL STARS under two dimmers at once: the star map (`map`, 0 to 1, down to `mapOpacity`)
 * and a jump (`hyper`, the look's `calm`, down to `hyperOpacity`). They multiply. What comes
 * back is what world/Starfield.ts `setCalm` takes: how calm the sky is, and the opacity it has
 * when fully calm, such that the stars show at exactly the product. With no jump it is the call
 * the map alone always made.
 */
export function starCalm(
  map: number,
  mapOpacity: number,
  hyper: number,
  hyperOpacity: number,
  out: { calm: number; opacity: number },
): { calm: number; opacity: number } {
  out.calm = Math.max(map, hyper);
  if (!(hyper > 0)) {
    out.opacity = mapOpacity;
    return out;
  }
  const shown = (1 + (mapOpacity - 1) * map) * (1 + (hyperOpacity - 1) * hyper);
  out.opacity = 1 + (shown - 1) / out.calm;
  return out;
}
