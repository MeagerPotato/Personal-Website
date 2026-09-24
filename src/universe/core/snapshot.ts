import { GUARD_SPEED } from '../sim/docking';
import { createShipState } from '../sim/flight';
import type { ShipState } from '../sim/types';

/**
 * Everything needed to build the engine again exactly where it was: after the browser takes the
 * WebGL context away (a phone that spent a minute in the background), and later when a page is
 * opened on a planet or a quality tier needs a different kind of canvas. It is deliberately tiny,
 * because nothing else in the world is state: where every planet is follows from `steps`.
 */
export interface Snapshot {
  /** Simulation steps taken so far. The simulation's only clock (core/loop.ts). */
  readonly steps: number;
  readonly ship: Readonly<ShipState>;
  /**
   * Where the visitor was headed or docked, if anywhere. A docked ship is CARRIED, not flown, so
   * its state alone would not bring the orbit back: the dock is put back from these. It is put
   * back ON its ring (Navigator.restore, place): the springs still settling a journey's arrival
   * onto the ring (sim/docking.ts, arrive) are not kept, so a rebuild in the first half second of
   * an orbit cuts the ship the rest of the way, up to about 18 u. A rebuild is a cut anyway.
   */
  readonly dock: {
    readonly id: string;
    readonly docked: boolean;
    /** Docked: where on the ring, and which way round. */
    readonly angle: number;
    readonly spin: number;
    /**
     * On the way: how much longer (s) the journey must still last before the ship may be taken
     * into orbit (cruise.minJourneySec, less what has passed; DockState.holdSec). 0 for the
     * pilot's own "dock here", and once docked. A snapshot written before this field existed
     * reads as 0.
     */
    readonly holdSec: number;
  } | null;
  /**
   * STOP was pressed a moment ago, and the ship is still braking to rest by itself (sim/docking.ts,
   * DockState.halting): it carries on braking. Only ever with no dock. A snapshot written before
   * this field existed reads as false.
   */
  readonly halting: boolean;
  /**
   * The pilot took the controls back from a journey a moment ago (or steered out of a STOP), and
   * the ship is still too fast for the cushions: the reflex goes on braking it for whatever lies
   * on its course (sim/docking.ts, DockState.guarding). Only ever with no dock, and never with
   * `halting`. A snapshot written before this field existed reads as false.
   */
  readonly guarding: boolean;
}

const SHIP_FIELDS = ['x', 'z', 'vx', 'vz', 'heading', 'yawRate'] as const;
/** Nothing in any galaxy we build is this far out, or this fast, or this old (about 190 days). */
const MAX_COORDINATE = 100_000;
const MAX_STEPS = 1_000_000_000;
/** No journey is ever held this long: anything more is not a hold this engine wrote. */
const MAX_HOLD_SEC = 60;

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * A snapshot that has been AWAY (the web layer keeps one in sessionStorage, so that a reload or a
 * full page load carries on where the visitor was) is only data again: check every field. Null
 * for anything that is not a snapshot this engine could have written.
 */
export function parseSnapshot(data: unknown): Snapshot | null {
  if (typeof data !== 'object' || data === null) return null;
  const { steps, ship, dock, halting = false, guarding = false } = data as Record<string, unknown>;
  if (!isNumber(steps) || !Number.isInteger(steps) || steps < 0 || steps > MAX_STEPS) return null;
  if (typeof ship !== 'object' || ship === null) return null;

  const state = createShipState();
  for (const field of SHIP_FIELDS) {
    const value = (ship as Record<string, unknown>)[field];
    if (!isNumber(value) || Math.abs(value) > MAX_COORDINATE) return null;
    state[field] = value;
  }

  if (typeof halting !== 'boolean' || typeof guarding !== 'boolean') return null;
  if (halting && guarding) return null;
  if (dock === null || dock === undefined) {
    return { steps, ship: state, dock: null, halting, guarding };
  }
  if (typeof dock !== 'object') return null;
  const { id, docked, angle, spin, holdSec = 0 } = dock as Record<string, unknown>;
  if (typeof id !== 'string' || typeof docked !== 'boolean' || !isNumber(angle)) return null;
  if (spin !== 1 && spin !== -1) return null;
  if (!isNumber(holdSec) || holdSec < 0 || holdSec > MAX_HOLD_SEC) return null;
  // A ship that is headed somewhere, or docked, is not braking to a stop.
  return {
    steps,
    ship: state,
    dock: { id, docked, angle, spin, holdSec },
    halting: false,
    guarding: false,
  };
}

/** Where a visit starts: what the web layer knows when it creates the universe. */
export interface StartOptions {
  /** Id of the body whose page is open: the visit starts in orbit round it, with no flight. */
  at?: string | null | undefined;
  /** What `Universe.snapshot()` returned earlier in this tab, or anything else storage gave back. */
  snapshot?: unknown;
}

/**
 * THE URL SAYS WHERE THE VISITOR IS DOCKED; a remembered snapshot only says where things were.
 * So the snapshot brings back the world's clock and the ship, and keeps its dock only when it
 * agrees with `at`: then the ship carries on from the very spot on its orbit. Otherwise the ship
 * is put in orbit round `at` (main.ts), or flies free from where it was when there is no `at`.
 *
 * A JOURNEY that is not taken up is a STOP (`halting`): the ship brakes to rest where it is. A
 * journey pointed at in the world flies with the URL on a page with no body (the sky, Projects),
 * so a reload in the middle of it, a phone that threw the tab away, or the router's fallback to
 * a full page load (every navigation after a deploy) loads a page with no `at`, and the ship
 * would otherwise coast on at the pilot's top speed into whatever lay ahead (sim/docking.ts,
 * haltDock). Put in orbit round `at` instead, it is not braking anything. The same goes for an
 * orbit let go of in its first half second, while the springs still carry the ship round faster
 * than the cushions can stop (GUARD_SPEED, as sim/docking.ts onJourney decides for a key or a
 * link): it brakes too. A settled orbit goes round far slower than that, and is simply let go.
 */
export function startingFrom(start: StartOptions | undefined): {
  snapshot: Snapshot | null;
  at: string | null;
} {
  const at = start?.at ?? null;
  const saved = parseSnapshot(start?.snapshot);
  if (!saved) return { snapshot: null, at };
  if (saved.dock === null || saved.dock.id === at) return { snapshot: saved, at };
  // (A snapshot with a dock is neither halting nor guarding: parseSnapshot.)
  const fast = Math.hypot(saved.ship.vx, saved.ship.vz) > GUARD_SPEED;
  return { snapshot: { ...saved, dock: null, halting: !saved.dock.docked || fast }, at };
}

/**
 * How often the engine may be rebuilt. One lost context is a phone being a phone; several in a
 * row is a GPU that cannot cope, and then the honest answer is plain mode, not a loop.
 */
export class RebuildBudget {
  private readonly times: number[] = [];

  constructor(
    private readonly maxRebuilds: number,
    private readonly windowMs: number,
  ) {}

  /** Asks for one rebuild at `nowMs`. False means: give up. */
  spend(nowMs: number): boolean {
    while (this.times.length > 0 && nowMs - (this.times[0] ?? 0) > this.windowMs) {
      this.times.shift();
    }
    if (this.times.length >= this.maxRebuilds) return false;
    this.times.push(nowMs);
    return true;
  }
}
