import type { System } from '../core/Engine';
import type { Snapshot } from '../core/snapshot';
import { pullOf, type AssistParams } from '../sim/assist';
import type { CruiseParams } from '../sim/autopilot';
import {
  dockAt,
  guardDock,
  haltDock,
  releaseDock,
  requestDock,
  type DockParams,
} from '../sim/docking';
import type { Surroundings } from '../sim/surroundings';
import type { FlightInput, ShipState } from '../sim/types';
import { FLIGHT, transition, type AppEvent, type AppState } from './appMachine';

/** What the navigator tells the world. Queued during a simulation step, delivered with the frame. */
export type NavigatorEvents = {
  /** The mode changed (state/appMachine.ts). */
  statechange: AppState;
  /** The ship came within reach of a body that can be docked at, or left it (`id` null). */
  soi: { id: string | null };
  /** The ship is in orbit round `id`. */
  docked: { id: string };
  /**
   * An approach or a dock ended. `by` says where that came from: the `pilot` (the controls, the
   * prompt: the web layer should now follow), or somebody `asked` through the API (the route
   * changed, another destination was chosen: the web layer already knows).
   */
  undocked: { id: string; by: 'pilot' | 'asked' };
};

export interface NavigatorParams {
  readonly assist: AssistParams;
  readonly dock: DockParams;
  readonly cruise: Pick<CruiseParams, 'minJourneySec'>;
}

export interface NavigatorOptions {
  surroundings: Surroundings;
  ship: {
    readonly state: Readonly<ShipState>;
    /** Put the ship into an exact state with no in-between frame (a cut, not a flight). */
    restore(state: Readonly<ShipState>): void;
  };
  pilot: { readonly current: Readonly<FlightInput> };
  params: NavigatorParams;
  emit<K extends keyof NavigatorEvents>(event: K, payload: NavigatorEvents[K]): void;
}

/** How a ship was handed back to its pilot, as a snapshot keeps it (core/snapshot.ts). */
export type HandBack = Pick<Snapshot, 'halting' | 'guarding'>;
const NOT_HANDED_BACK: HandBack = Object.freeze({ halting: false, guarding: false });

/** The prompt must not flicker at the very edge of a sphere of influence. */
const SOI_ENTER_PULL = 0.08;

/**
 * WHERE THE VISITOR IS HEADED: the one place that turns requests ("dock here", "be there", "let
 * go") into simulation state (sim/docking.ts), keeps the app state machine in step with what the
 * simulation then does, and reports it. It decides nothing about HOW the ship flies.
 *
 * Add it AFTER the ship, so that it sees what each simulation step did in that same step.
 */
export class Navigator implements System {
  private current: AppState = FLIGHT;
  private near: string | null = null;
  private arrival: 'flown' | 'cut' = 'flown';
  private readonly queue: Array<() => void> = [];

  constructor(private readonly options: NavigatorOptions) {}

  get state(): AppState {
    return this.current;
  }

  /** How the ship got to where it is docked: `cut` means it was put there, and a camera should cut too. */
  get lastArrival(): 'flown' | 'cut' {
    return this.arrival;
  }

  /** Id of the body the ship could dock at right now, or null. */
  get candidate(): string | null {
    return this.near;
  }

  /** Is body `id` close enough to be approached directly? */
  withinReach(id: string): boolean {
    const { surroundings, ship, params } = this.options;
    const i = surroundings.orbits.indexOf(id);
    return i >= 0 && pullOf(surroundings.field, i, ship.state.x, ship.state.z, params.assist) > 0;
  }

  /**
   * Fly onto the ring of `id`, which must be within reach. False when it is not, or is unknown:
   * then `travel` brings the ship there first. `by` says whose idea it was, for whatever the
   * ship leaves behind (see `undocked`): a visitor pointing at a planet is the PILOT.
   */
  approach(id: string, by: 'pilot' | 'asked' = 'asked'): boolean {
    return this.approachWith(id, by, 0);
  }

  /** `approach`, not captured before `holdSec` (a whole journey: see `travel`). */
  private approachWith(id: string, by: 'pilot' | 'asked', holdSec: number): boolean {
    const { surroundings, pilot } = this.options;
    const i = surroundings.orbits.indexOf(id);
    if (i < 0 || !this.withinReach(id)) return false;
    if (this.current.target === id && this.current.mode !== 'autopilot') return true;
    this.leave(by);
    this.arrival = 'flown';
    requestDock(surroundings.dock, i, pilot.current, false, holdSec);
    this.apply({ type: 'approach', to: id });
    return true;
  }

  /**
   * Set out for `id` from wherever the ship is: the autopilot flies it there (sim/autopilot.ts)
   * and takes it into orbit beside the ring; from within reach, the approach flies it. Either
   * way it takes at least cruise.minJourneySec. False for an unknown body.
   */
  travel(id: string, by: 'pilot' | 'asked' = 'asked'): boolean {
    return this.setOut(id, by, this.options.params.cruise.minJourneySec);
  }

  /** `travel`, not taken into orbit before `holdSec` (a journey picked up after a rebuild). */
  private setOut(id: string, by: 'pilot' | 'asked', holdSec: number): boolean {
    const { surroundings, pilot } = this.options;
    const i = surroundings.orbits.indexOf(id);
    if (i < 0) return false;
    if (this.current.target === id) return true;
    // Within reach, the ring's own pilot flies it; still a journey, and no quicker than one.
    if (this.withinReach(id)) return this.approachWith(id, by, holdSec);
    this.leave(by);
    this.arrival = 'flown';
    requestDock(surroundings.dock, i, pilot.current, true, holdSec);
    this.apply({ type: 'travel', to: id });
    return true;
  }

  /** Be in orbit round `id` at once, at `angle` on its ring. False for an unknown body. */
  place(id: string, angle = 0, spin = 1, by: 'pilot' | 'asked' = 'asked'): boolean {
    const { surroundings, ship, params } = this.options;
    const i = surroundings.orbits.indexOf(id);
    if (i < 0) return false;
    if (this.current.mode === 'docked' && this.current.target === id) return true;
    this.leave(by);
    const state = { ...ship.state };
    dockAt(surroundings.field, state, params.dock, surroundings.dock, i, angle, spin);
    ship.restore(state);
    this.arrival = 'cut';
    this.apply({ type: 'place', at: id });
    this.queue.push(() => this.options.emit('docked', { id }));
    return true;
  }

  /** What a rebuilt engine needs to be headed, or docked, where this one is (core/snapshot.ts). */
  snapshot(): Snapshot['dock'] {
    const { dock } = this.options.surroundings;
    const id = this.current.target;
    if (id === null || dock.phase === 'free') return null;
    const docked = dock.phase === 'docked';
    // On the way, the journey must still last what is left of its hold: a rebuild in the middle
    // of a hop neither starts the shortest journey over nor lets the ship arrive early.
    const holdSec = docked ? 0 : Math.max(0, dock.holdSec - dock.phaseSec);
    return { id, docked, angle: dock.angle, spin: dock.spin, holdSec };
  }

  /**
   * Pick up where a snapshot left off. The ship's own state must have been restored already. A
   * visitor who asked for less motion (`cut`) is never flown across the galaxy: a journey that was
   * under way is taken up as the short approach when the body is within reach, and as a cut
   * otherwise, exactly as their links and their pointing are (api.ts goTo, main.ts flyToRow: an
   * approach with no hold, since theirs is no journey). A ship braking after a STOP (`halting`,
   * with no dock) goes on braking, and one taken back at speed by its pilot (`guarding`) keeps its
   * reflex.
   */
  restore(from: Snapshot['dock'], cut = false, after: HandBack = NOT_HANDED_BACK): void {
    if (!from) {
      // Stopped a moment ago, and still braking: it carries on braking.
      if (after.halting) this.stop();
      else if (after.guarding) {
        const { surroundings, pilot, params } = this.options;
        guardDock(surroundings.dock, pilot.current, params.dock.leaveDeadZone);
      }
      return;
    }
    if (from.docked) this.place(from.id, from.angle, from.spin);
    else if (!cut) this.setOut(from.id, 'asked', from.holdSec);
    else if (!this.approach(from.id)) this.place(from.id);
  }

  /**
   * Let go: back to free flight, from exactly where and how the ship is. Out of an orbit that is
   * all ("Leave orbit": a docked ship is slow). On the way somewhere it is a STOP: the web layer
   * lets go of a journey whenever the route moves to a page with no body (Projects, the wordmark,
   * Close or Back to the sky: shell/follow.ts), and a ship let go of at the autopilot's speed
   * would coast on into whatever lies ahead at the pilot's own top speed (sim/docking.ts, haltDock).
   */
  release(by: 'pilot' | 'asked' = 'asked'): void {
    const { phase } = this.options.surroundings.dock;
    if (phase === 'cruise' || phase === 'approach') {
      this.stop(by);
      return;
    }
    this.leave(by);
    this.apply({ type: 'release' });
  }

  /**
   * STOP (the prompt's button on the way somewhere, and `release` then too): let go, and brake the
   * ship to rest where it is (sim/docking.ts, haltDock). Steering takes over at once.
   */
  stop(by: 'pilot' | 'asked' = 'asked'): void {
    this.leave(by);
    haltDock(this.options.surroundings.dock, this.options.surroundings.assist);
    this.apply({ type: 'release' });
  }

  /** Is the ship braking to rest after a STOP? (core/snapshot.ts keeps it through a rebuild.) */
  get halting(): boolean {
    return this.options.surroundings.dock.halting;
  }

  /** Is the reflex still on for a ship its pilot took back at speed? (Kept through a rebuild too.) */
  get guarding(): boolean {
    return this.options.surroundings.dock.guarding;
  }

  fixedUpdate(): void {
    const { surroundings, ship, params } = this.options;
    const { dock, assist, orbits, field } = surroundings;

    // What did the last simulation step do with the dock?
    if (dock.leftByPilot && this.current.target !== null) {
      const id = this.current.target;
      this.queue.push(() => this.options.emit('undocked', { id, by: 'pilot' }));
      this.apply({ type: 'release' });
    } else if (
      dock.phase === 'docked' &&
      (this.current.mode === 'approach' || this.current.mode === 'autopilot')
    ) {
      // On the ring: the approach got there, or the journey arrived beside it.
      const id = this.current.target;
      this.apply({ type: 'capture' });
      if (id !== null) this.queue.push(() => this.options.emit('docked', { id }));
    }

    // Within reach of something? Only free flight is offered a dock.
    let near: string | null = null;
    if (this.current.mode === 'flight' && assist.body >= 0) {
      const pull = pullOf(field, assist.body, ship.state.x, ship.state.z, params.assist);
      const id = orbits.ids[assist.body] ?? null;
      if (pull > (id === this.near ? 0 : SOI_ENTER_PULL)) near = id;
    }
    if (near !== this.near) {
      this.near = near;
      this.queue.push(() => this.options.emit('soi', { id: near }));
    }
  }

  frameUpdate(): void {
    // Listeners run here, between simulation steps, where they may safely ask for anything.
    for (const deliver of this.queue.splice(0)) deliver();
  }

  dispose(): void {
    this.queue.length = 0;
  }

  /** End whatever approach or dock is going on, and say so. */
  private leave(by: 'pilot' | 'asked'): void {
    const { surroundings } = this.options;
    const id = this.current.target;
    if (surroundings.dock.phase === 'free' || id === null) return;
    releaseDock(surroundings.dock, surroundings.assist);
    this.queue.push(() => this.options.emit('undocked', { id, by }));
  }

  private apply(event: AppEvent): void {
    const next = transition(this.current, event);
    if (!next) return;
    this.current = next;
    this.queue.push(() => this.options.emit('statechange', next));
  }
}
