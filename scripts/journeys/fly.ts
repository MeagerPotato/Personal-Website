import { parseSnapshot } from '../../src/universe/core/snapshot';
import type { UniverseManifest } from '../../src/universe/data/types';
import { tuning } from '../../src/universe/design/tuning';
import { homeSystemOf, nearestNeighbourOf } from '../../src/universe/manifest';
import { NO_INPUT, copyShipState, createShipState, speedOf } from '../../src/universe/sim/flight';
import { createRng } from '../../src/universe/sim/rng';
import { spawnPoint } from '../../src/universe/sim/spawn';
import {
  createSurroundings,
  flyStep,
  syncSurroundings,
  type Surroundings,
} from '../../src/universe/sim/surroundings';
import type { FlightInput, ShipState } from '../../src/universe/sim/types';
import type { AppMode } from '../../src/universe/state/appMachine';
import { Navigator, type NavigatorEvents } from '../../src/universe/state/Navigator';
import { mergeInto, type DeepPartial } from './merge';

// ONE JOURNEY, flown by the real simulation exactly as the engine flies it (universe/main.ts):
// the ship starts where the engine would put it (ShipSystem at the spawn point, then
// Navigator.place for a page opened on a body), and every fixed 60 Hz step is ShipSystem's
// flyStep followed by the Navigator's fixedUpdate, with its events delivered after the step as
// a frame would. The journey is asked for the way pointing at a body asks for it
// (Navigator.travel, main.ts flyToRow; a link's goTo makes the same call), with nobody touching
// the controls. It ends when the Navigator says `docked` there: the moment the page opens.
//
// Nothing about flight, the autopilot or docking is reimplemented here: this file only watches.

const TAU = Math.PI * 2;
/** On the ring (JourneyResult.settledSec): u off it, and u/s across it. */
const SETTLED_U = 0.5;
const SETTLED_SPEED = 2;
/** How long after docking the harness keeps watching for the ship to settle, s. */
const SETTLE_WATCH_SEC = 5;
/** u/s. A dip in speed this deep, and a surge back by as much, is a valley (JourneyResult.valleys). */
export const VALLEY_U_S = 40;

/** The tuning blocks the simulation reads, as the engine passes them to flyStep and the Navigator. */
type SimBlocks = Pick<typeof tuning, 'flight' | 'cruise' | 'assist' | 'cushion' | 'edge' | 'dock'>;

export type SimTuning = SimBlocks & {
  /** tuning.ship.spawn: where a new visitor starts (sim/spawn.ts). */
  readonly spawn: (typeof tuning)['ship']['spawn'];
  readonly stepHz: number;
};

/** Overrides of those blocks, merged over tuning.ts (unknown keys throw). `spawn` is ship.spawn. */
export type TuningOverrides = DeepPartial<SimBlocks & { spawn: (typeof tuning)['ship']['spawn'] }>;

export function simTuning(overrides: TuningOverrides = {}): SimTuning {
  const blocks = structuredClone({
    flight: tuning.flight,
    cruise: tuning.cruise,
    assist: tuning.assist,
    cushion: tuning.cushion,
    edge: tuning.edge,
    dock: tuning.dock,
    spawn: tuning.ship.spawn,
  });
  mergeInto(blocks, overrides);
  return { ...blocks, stepHz: tuning.loop.stepHz };
}

export type JourneyKind = 'between' | 'within' | 'spawn';

export interface JourneySpec {
  kind: JourneyKind;
  /** Body id the ship starts docked at, or null: at rest at the spawn point, as a new visitor. */
  from: string | null;
  to: string;
  /** Simulation time (s) at which the ship is placed (0 for a new visitor: the engine starts at step 0). */
  startSec: number;
  /** A docked start: where on the ring (radians) and which way round. */
  angle: number;
  spin: 1 | -1;
  /** Seconds between being placed and asking for the journey (reading the page, or the hint). */
  dwellSec: number;
}

export type Failure = 'timeout' | 'shell' | 'tunnel' | 'graze';

export interface JourneyResult {
  kind: JourneyKind;
  from: string;
  to: string;
  fromSystem: string;
  toSystem: string;
  /** Simulation time of the request, s. */
  askedAt: number;
  /** Ship to the target's centre at the request, u. */
  straightU: number;
  /** Request to capture (the page opens), s. The limit when it never docked. */
  seconds: number;
  docked: boolean;
  /**
   * Request until the ship is ON its ring, s: carried round the body, within SETTLED_U of the
   * ring and crossing it slower than SETTLED_SPEED (what a capture needed before a journey could
   * be captured beside the ring and settled onto it by the dock's springs). NaN if never.
   */
  settledSec: number;
  /** What Navigator.travel did: set out on the autopilot, or (within reach) went straight to the approach. */
  how: 'travel' | 'approach';
  /**
   * The cruise profile the first plan chose (tuning.cruise.shortLeg and longLeg): 'near', 'far',
   * or how far between them ('far 40%'); '-' without a cruise.
   */
  profile: string;
  /** Length (u) and expected duration (s) of the first plan. */
  planU: number;
  planEtaSec: number;
  peakSpeed: number;
  /**
   * The phases, which add up to `seconds`:
   *   takeoff   the request until the ship is out of the start body's reach (assist.soiRadii ring
   *             radii), or from the spawn point until the ship first goes faster than
   *             cruise.keepOutSpeed (a stronger drive never needs full thrust).
   *   cruise    from there until the journey arrives beside the ring and is taken into orbit
   *             (a body asked for from within its reach is approached instead, and has no cruise).
   *   approach  from the start of an approach until the ship is within 4 capture distances of the ring.
   *   capture   from there until it is captured (dock.captureDistance, captureRadialSpeed).
   */
  takeoffSec: number;
  cruiseSec: number;
  approachSec: number;
  captureSec: number;
  firstThrustSec: number;
  /**
   * Closest the ship came to the SURFACE of a body it neither left nor went to, u: over the whole
   * of every step (the straight line it flew, in that body's own frame), not only where each step
   * ended. At 700 u/s a step is 12 u, and a small moon is 2.4 u across.
   */
  closestGapU: number;
  closestBody: string;
  /**
   * The same over EVERY body, the two it left and went to included, measured to the shell
   * (surface + cushion.shellGap) rather than to the surface, from the request until a second
   * after it docked (the dock's springs settle it then). Below 0: a step passed through a shell,
   * which resolveShells (checking where steps end) cannot see.
   */
  shellClearU: number;
  /** Steps in which the ship was stopped by a shell (sim/collide.ts, resolveShells). */
  shellTouches: number;
  /** The approach ran out of time and the ship was captured where it was (dock.approachTimeoutSec). */
  approachTimedOut: boolean;
  /**
   * SPEED VALLEYS while the autopilot flew: how often it braked by VALLEY_U_S or more and then
   * sped up again by as much (the throttle and the brake taking turns, a nod of the camera each
   * time), and the deepest such dip, u/s.
   */
  valleys: number;
  deepestValley: number;
  /**
   * The hardest the ship's velocity changed in one step, from the request until it docked, u/s²
   * (world frame: a bend flown at speed counts, and so does a cushion's push).
   */
  peakAccel: number;
  /**
   * timeout: not docked within the limit. shell: touched a shell. tunnel: a step passed through a
   * shell (shellClearU < 0). graze: came closer than half a cushion to a body it was only passing
   * (the bound the autopilot's own test pins), anywhere along a step. A journey that was STOPPED
   * (`interrupt`) and not sent anywhere after fails only by a shell or a graze while it coasts.
   */
  failure: Failure | null;
  /** What happened after Stop, when the journey was stopped on purpose (fly's `interrupt`). */
  stop: StopOutcome | null;
  /** What was done to the journey on the way (fly's `interrupt`), and what came of it. */
  interrupt: InterruptOutcome | null;
}

/**
 * Something a visitor does to a journey while the autopilot flies it, `atSec` after asking:
 *   stop      press Stop (Navigator.stop, as ui/Prompt.ts does) and watch the ship for coastSec.
 *             With `thenDock`, press E (the prompt's "Orbit ...") the first moment the prompt
 *             offers a body after that (Navigator.candidate), and fly on until docked there.
 *             With `route`, it is the web layer that lets go instead (Navigator.release('asked'),
 *             api.ts undock): the route moved to a page with no body (Projects, the wordmark,
 *             Close or Back to the sky: shell/follow.ts).
 *   redirect  point at another body, `to` (Navigator.travel, as main.ts flyToRow does): the
 *             journey goes there instead, on the autopilot, or by the approach when `to` is
 *             within reach (a body the ship is racing past). With `then`, change your mind again,
 *             and again: each `afterSec` after the one before, point at its `to` (a body raced
 *             past, then back where it was going; a visitor pointing at one name after another).
 *   tap       take the controls back for a moment instead of pressing Stop: hold the brake, an
 *             arrow or the throttle for `steps` steps, let go, and watch the ship for coastSec.
 *             With `again`, a double tap: let go for `gapSteps` steps, then hold `again.input`
 *             for `again.steps` (the throttle pressed afresh while the speed is still the
 *             autopilot's, a thumb lifted off the stick and put back), then let go.
 *   rebuild   the engine is thrown away and built again from its snapshot (core/snapshot.ts, as a
 *             lost WebGL context does: api.ts): a fresh world and Navigator, restored from what
 *             parseSnapshot makes of a JSON round trip, and the journey flown on from there.
 */
export type Interrupt =
  | { kind: 'stop'; atSec: number; coastSec: number; thenDock?: boolean; route?: boolean }
  | {
      kind: 'redirect';
      atSec: number;
      to: string;
      then?: readonly { readonly afterSec: number; readonly to: string }[];
    }
  | {
      kind: 'tap';
      atSec: number;
      input: TapInput;
      steps: number;
      coastSec: number;
      again?: { readonly gapSteps: number; readonly input: TapInput; readonly steps: number };
    }
  | { kind: 'rebuild'; atSec: number };

/**
 * Which control a `tap` takes the ship back with: the brake, an arrow either way, the throttle,
 * or a thumb on the stick (some throttle, some turn).
 */
export type TapInput = 'brake' | 'turn' | 'left' | 'thrust' | 'stick';
const TAPS: Record<TapInput, Readonly<FlightInput>> = {
  brake: { thrust: 0, turn: 0, brake: 1, boost: false },
  turn: { thrust: 0, turn: 1, brake: 0, boost: false },
  left: { thrust: 0, turn: -1, brake: 0, boost: false },
  thrust: { thrust: 1, turn: 0, brake: 0, boost: false },
  stick: { thrust: 0.5, turn: 0.3, brake: 0, boost: false },
};

/** Press Stop `atSec` into the journey, then watch it coast for coastSec. */
export type StopSpec = Extract<Interrupt, { kind: 'stop' }>;

export interface InterruptOutcome {
  kind: 'stop' | 'stopDock' | 'undock' | 'redirect' | 'tap' | 'rebuild';
  /** When it was done (s since the request), and how fast the ship was going then, u/s. */
  atSec: number;
  atSpeed: number;
  /**
   * Where the ship was sent: the redirect's body (the last one, with `then`), the body E docked
   * at, the journey's own body after a rebuild, or null (a plain Stop, a tap, no body offered).
   */
  to: string | null;
  /** How the Navigator took it: a new journey on the autopilot, or the approach of a body within reach. */
  how: 'travel' | 'approach' | null;
  /** From sending it to `to` (or from the rebuild) until docked there, s. NaN if it never was. */
  dockSec: number;
  /** The hardest the ship's velocity changed in one step after the interrupt, u/s². */
  peakAccel: number;
}

export interface StopOutcome {
  /** When Stop was pressed (s since the request) and how fast the ship was going, u/s. */
  atSec: number;
  atSpeed: number;
  /** How far from where Stop was pressed (u) and how long after (s) it was back to the pilot's own top speed. NaN if never. */
  dropU: number;
  dropSec: number;
  /** The furthest it got from where Stop was pressed while watched, u: how far it slid. */
  slideU: number;
  /** Its speed at the end of the watch, u/s: at rest, or circling where the orbit assist caught it. */
  endSpeed: number;
  /** Closest it came to the SURFACE of any body while it coasted, u, and which. */
  closestGapU: number;
  closestBody: string;
  shellTouches: number;
}

export interface Galaxy {
  name: string;
  manifest: UniverseManifest;
}

/** What `watch` sees after every step of a journey: for traces while working on a proposal. */
export interface StepView {
  /** Seconds since the request. */
  t: number;
  state: Readonly<ShipState>;
  world: Readonly<Surroundings>;
  flown: Readonly<FlightInput>;
  mode: AppMode;
}

export function fly(
  galaxy: Galaxy,
  spec: JourneySpec,
  sim: SimTuning,
  limitSec = 60,
  watch?: (view: StepView) => void,
  interrupt?: Interrupt,
): JourneyResult {
  const { manifest } = galaxy;
  const dt = 1 / sim.stepHz;
  const home = homeSystemOf(manifest);
  const spawn = spawnPoint(
    home.position,
    nearestNeighbourOf(manifest, home)?.position ?? null,
    sim.spawn,
  );
  const surroundings = (): Surroundings =>
    createSurroundings(
      { systems: manifest.systems, bodies: manifest.bodies, home: home.position },
      sim.edge.margin,
    );
  // (Everything an engine is made of can be thrown away and built again: see `rebuild` below.)
  let world = surroundings();
  let { field, orbits } = world;
  let state = createShipState(spawn.x, spawn.z, spawn.heading);
  const pilot: { current: Readonly<FlightInput> } = { current: NO_INPUT };
  const flown: FlightInput = { ...NO_INPUT };
  /** Every `docked` the Navigator announced, in order. */
  const dockings: string[] = [];
  const navigatorOf = (ship: ShipState, among: Surroundings): Navigator =>
    new Navigator({
      surroundings: among,
      ship: { state: ship, restore: (to) => void copyShipState(to, ship) },
      pilot,
      params: sim,
      emit: (event, payload) => {
        if (event === 'docked') dockings.push((payload as NavigatorEvents['docked']).id);
      },
    });
  let navigator = navigatorOf(state, world);

  let steps = Math.round(spec.startSec * sim.stepHz);
  const step = (): void => {
    steps += 1;
    flyStep(world, state, pilot.current, sim.flight, sim, dt, steps * dt, flown);
    navigator.fixedUpdate();
    navigator.frameUpdate();
  };

  /**
   * A LOST CONTEXT: the engine's snapshot, through JSON and parseSnapshot as it would come back,
   * and a new world, ship and Navigator built from it the way universe/main.ts builds them.
   */
  const rebuild = (): void => {
    const saved = parseSnapshot(
      JSON.parse(
        JSON.stringify({
          steps,
          ship: state,
          dock: navigator.snapshot(),
          halting: navigator.halting,
          guarding: navigator.guarding,
        }),
      ),
    );
    if (saved === null) throw new Error(`${galaxy.name}: a snapshot that does not parse`);
    world = surroundings();
    ({ field, orbits } = world);
    state = copyShipState(saved.ship, createShipState());
    navigator = navigatorOf(state, world);
    syncSurroundings(world, saved.steps * dt);
    navigator.restore(saved.dock, false, saved);
    navigator.frameUpdate();
  };

  // Where the engine would have the ship: docked (a page opened on a body), or at the spawn point.
  syncSurroundings(world, steps * dt);
  if (spec.from !== null && !navigator.place(spec.from, spec.angle, spec.spin)) {
    throw new Error(`${galaxy.name}: no body "${spec.from}"`);
  }
  navigator.frameUpdate();
  for (let k = Math.round(spec.dwellSec * sim.stepHz); k > 0; k -= 1) step();

  // Where the journey goes: spec.to, until an interrupt sends it somewhere else.
  let goal = spec.to;
  let target = orbits.indexOf(spec.to);
  const start = spec.from === null ? -1 : orbits.indexOf(spec.from);
  if (target < 0) throw new Error(`${galaxy.name}: no body "${spec.to}"`);
  const redirects =
    interrupt?.kind === 'redirect'
      ? [interrupt.to, ...(interrupt.then ?? []).map(({ to }) => to)]
      : [];
  for (const to of redirects) {
    if (orbits.indexOf(to) < 0) throw new Error(`${galaxy.name}: no body "${to}"`);
  }
  const bodyX = (i: number): number => field.positions[i * 2] ?? 0;
  const bodyZ = (i: number): number => field.positions[i * 2 + 1] ?? 0;
  const straightU = Math.hypot(state.x - bodyX(target), state.z - bodyZ(target));

  dockings.length = 0;
  if (!navigator.travel(spec.to, 'pilot'))
    throw new Error(`${galaxy.name}: cannot go to "${spec.to}"`);
  const how = navigator.state.mode === 'autopilot' ? 'travel' : 'approach';
  const began = steps;
  const askedAt = began * dt;

  const startReach = start < 0 ? 0 : sim.assist.soiRadii * (field.ringRadius[start] ?? 0);
  const ring = field.ringRadius[target] ?? 0;
  const onRingBand = 4 * sim.dock.captureDistance;
  const grazeBelow = sim.cushion.depth * 0.5;

  // The whole of every step, not only where it ends: where the bodies and the ship were before it.
  const before = new Float64Array(field.count * 2);
  let fromX = state.x;
  let fromZ = state.z;
  /** Closest (u) the last step came to body j's centre, in j's own frame. */
  const swept = (j: number): number => {
    const ax = fromX - (before[j * 2] ?? 0);
    const az = fromZ - (before[j * 2 + 1] ?? 0);
    const dx = state.x - bodyX(j) - ax;
    const dz = state.z - bodyZ(j) - az;
    const span = dx * dx + dz * dz;
    const t = span < 1e-12 ? 0 : Math.min(1, Math.max(0, -(ax * dx + az * dz) / span));
    return Math.hypot(ax + dx * t, az + dz * t);
  };
  let shellClearU = Infinity;
  const sweep = (): void => {
    for (let j = 0; j < field.count; j += 1) {
      const clear = swept(j) - (field.radius[j] ?? 0) - sim.cushion.shellGap;
      if (clear < shellClearU) shellClearU = clear;
    }
  };
  const remember = (): void => {
    before.set(field.positions);
    fromX = state.x;
    fromZ = state.z;
  };

  let peakSpeed = 0;
  let firstThrust = -1;
  let clear = -1;
  let handOff = how === 'approach' ? 0 : -1;
  let onRing = -1;
  let planU = 0;
  let planEtaSec = 0;
  let profile: JourneyResult['profile'] = '-';
  let closestGapU = Infinity;
  let closestBody = -1;
  let shellTouches = 0;
  let seconds = limitSec;
  let docked = false;
  const pilotTop = (sim.flight.thrustAccel * sim.flight.boostFactor) / sim.flight.forwardDrag;
  let stopped: (StopOutcome & { x: number; z: number }) | null = null;
  let coasting = false;
  /** Steps a tap still holds its control for; then, for a double tap, steps until the second. */
  let tapLeft = 0;
  let gapLeft = 0;
  let again = interrupt?.kind === 'tap' ? (interrupt.again ?? null) : null;
  /** How many of a redirect's `then` have been done, and when the last change of mind was (s). */
  let changes = 0;
  let changedAt = 0;
  let done: InterruptOutcome | null = null;
  let peakAccel = 0;
  let vx = state.vx;
  let vz = state.vz;
  // Speed valleys: the highest speed since the last valley, and the lowest since that.
  let valleys = 0;
  let deepestValley = 0;
  let crest = 0;
  let trough = Infinity;
  /** Send the journey to `id` instead, as pointing at it does. */
  const sendTo = (outcome: InterruptOutcome, id: string, t: number): void => {
    if (!navigator.travel(id, 'pilot')) throw new Error(`${galaxy.name}: cannot go to "${id}"`);
    navigator.frameUpdate();
    goal = id;
    target = orbits.indexOf(id);
    outcome.to = id;
    outcome.how = navigator.state.mode === 'autopilot' ? 'travel' : 'approach';
    outcome.dockSec = t;
    dockings.length = 0;
  };

  while ((steps - began) * dt < limitSec) {
    remember();
    step();
    const t = (steps - began) * dt;
    sweep();
    const accel = Math.hypot(state.vx - vx, state.vz - vz) / dt;
    vx = state.vx;
    vz = state.vz;
    peakAccel = Math.max(peakAccel, accel);
    if (done !== null) done.peakAccel = Math.max(done.peakAccel, accel);

    if (
      interrupt &&
      done === null &&
      t >= interrupt.atSec - dt / 2 &&
      navigator.state.mode === 'autopilot'
    ) {
      done = {
        kind:
          interrupt.kind !== 'stop'
            ? interrupt.kind
            : interrupt.thenDock
              ? 'stopDock'
              : interrupt.route
                ? 'undock'
                : 'stop',
        atSec: t,
        atSpeed: speedOf(state),
        to: null,
        how: null,
        dockSec: NaN,
        peakAccel: 0,
      };
      if (interrupt.kind === 'redirect') {
        sendTo(done, interrupt.to, t);
        changedAt = t;
        continue;
      }
      if (interrupt.kind === 'rebuild') {
        rebuild();
        done.to = goal;
        done.how = navigator.state.mode === 'autopilot' ? 'travel' : 'approach';
        done.dockSec = t;
        continue;
      }
      if (interrupt.kind === 'tap') {
        // The controls, for a moment: the next step takes the journey back (sim/docking.ts,
        // pilotLeaves), and the ship is the pilot's from there.
        pilot.current = TAPS[interrupt.input];
        tapLeft = interrupt.steps;
      } else if (interrupt.route === true) {
        // The web layer lets go (api.ts undock): a page with no body opened on the way.
        navigator.release('asked');
        navigator.frameUpdate();
      } else {
        // Stop, as the prompt's button does it: the journey is let go of and the ship brakes to
        // rest by itself (Navigator.stop), nobody touching the controls.
        navigator.stop('pilot');
        navigator.frameUpdate();
      }
      coasting = true;
      stopped = {
        atSec: t,
        atSpeed: speedOf(state),
        dropU: NaN,
        dropSec: NaN,
        slideU: 0,
        endSpeed: 0,
        closestGapU: Infinity,
        closestBody: '-',
        shellTouches: 0,
        x: state.x,
        z: state.z,
      };
      continue;
    }
    const next = interrupt?.kind === 'redirect' ? interrupt.then?.[changes] : undefined;
    if (next !== undefined && done !== null && t >= changedAt + next.afterSec - dt / 2) {
      changes += 1;
      changedAt = t;
      sendTo(done, next.to, t);
      continue;
    }
    if (coasting && stopped !== null && done !== null) {
      if (tapLeft > 0) {
        tapLeft -= 1;
        if (tapLeft === 0) {
          pilot.current = NO_INPUT;
          if (again !== null) gapLeft = again.gapSteps;
        }
      } else if (gapLeft > 0) {
        gapLeft -= 1;
        if (gapLeft === 0 && again !== null) {
          // The second press of a double tap.
          pilot.current = TAPS[again.input];
          tapLeft = again.steps;
          again = null;
        }
      }
      // Stop, then E: the first body the prompt offers (ui/Prompt.ts, "Orbit ..." in free flight).
      const offered = navigator.candidate;
      if (interrupt?.kind === 'stop' && interrupt.thenDock === true && offered !== null) {
        sendTo(done, offered, t);
        coasting = false;
        continue;
      }
      const away = Math.hypot(state.x - stopped.x, state.z - stopped.z);
      stopped.slideU = Math.max(stopped.slideU, away);
      if (Number.isNaN(stopped.dropU) && speedOf(state) <= pilotTop + 1e-9) {
        stopped.dropU = away;
        stopped.dropSec = t - stopped.atSec;
      }
      if (world.touched >= 0) stopped.shellTouches += 1;
      for (let j = 0; j < field.count; j += 1) {
        const gap = Math.hypot(state.x - bodyX(j), state.z - bodyZ(j)) - (field.radius[j] ?? 0);
        if (gap < stopped.closestGapU) {
          stopped.closestGapU = gap;
          stopped.closestBody = orbits.ids[j] ?? '-';
        }
      }
      stopped.endSpeed = speedOf(state);
      if (
        (interrupt?.kind === 'stop' || interrupt?.kind === 'tap') &&
        t - stopped.atSec >= interrupt.coastSec - dt / 2
      ) {
        break;
      }
      continue;
    }

    peakSpeed = Math.max(peakSpeed, speedOf(state));
    if (navigator.state.mode === 'autopilot') {
      const speed = speedOf(state);
      if (speed > crest && trough === Infinity) crest = speed;
      else if (speed < crest - VALLEY_U_S || trough < Infinity) trough = Math.min(trough, speed);
      if (trough < Infinity && speed > trough + VALLEY_U_S) {
        valleys += 1;
        deepestValley = Math.max(deepestValley, crest - trough);
        crest = speed;
        trough = Infinity;
      }
    }
    if (world.touched >= 0) shellTouches += 1;
    for (let j = 0; j < field.count; j += 1) {
      if (j === start || j === target) continue;
      const gap = swept(j) - (field.radius[j] ?? 0);
      if (gap < closestGapU) {
        closestGapU = gap;
        closestBody = j;
      }
    }

    if (firstThrust < 0 && flown.thrust > 0.05) firstThrust = t;
    if (clear < 0) {
      const out =
        start >= 0
          ? Math.hypot(state.x - bodyX(start), state.z - bodyZ(start)) > startReach
          : speedOf(state) > sim.cruise.keepOutSpeed;
      if (out) clear = t;
    }
    if (how === 'travel' && planU === 0 && world.cruise.path.count > 0) {
      planU = world.cruise.path.length;
      planEtaSec = world.cruise.etaSec;
      const far = world.cruise.far;
      profile =
        far === null ? '-' : far >= 1 ? 'far' : far <= 0 ? 'near' : `far ${Math.round(far * 100)}%`;
    }
    if (handOff < 0 && world.dock.phase !== 'cruise') handOff = t;
    if (handOff >= 0 && onRing < 0) {
      const d = Math.hypot(state.x - bodyX(target), state.z - bodyZ(target));
      if (Math.abs(d - ring) < onRingBand) onRing = t;
    }
    watch?.({ t, state, world, flown, mode: navigator.state.mode });
    if (dockings.includes(goal)) {
      docked = true;
      seconds = t;
      if (done !== null && done.to === goal) done.dockSec = t - done.dockSec;
      break;
    }
  }

  // Docked is when the page opens; the dock's springs may still be settling the ship onto the ring.
  // The first second in orbit is always watched (the springs' hardest work; `watch` sees it too).
  let settledSec = NaN;
  if (docked) {
    const { dock } = world;
    for (let t = seconds; ;) {
      if (
        Number.isNaN(settledSec) &&
        dock.phase === 'docked' &&
        dock.body === target &&
        Math.abs(dock.offset.value) <= SETTLED_U &&
        Math.abs(dock.offset.velocity) <= SETTLED_SPEED
      ) {
        settledSec = t;
      }
      if (t - seconds >= SETTLE_WATCH_SEC || dock.phase !== 'docked') break;
      if (!Number.isNaN(settledSec) && t - seconds >= 1) break;
      remember();
      step();
      t = (steps - began) * dt;
      if (t - seconds <= 1 + dt / 2) sweep();
      watch?.({ t, state, world, flown, mode: navigator.state.mode });
    }
  }

  const end = seconds;
  const handedOver = handOff >= 0 ? handOff : end;
  const takeoff = Math.min(clear >= 0 ? clear : handedOver, handedOver);
  const ringAt = onRing >= 0 ? Math.min(onRing, end) : end;
  const approachSec = ringAt - handedOver;
  if (done !== null && !docked) done.dockSec = NaN;
  // Stopped and then sent somewhere (Stop, then E): what it did while it coasted counts too.
  const touches = shellTouches + (stopped?.shellTouches ?? 0);
  const passedAt = Math.min(closestGapU, stopped?.closestGapU ?? Infinity);
  const failure: Failure | null =
    stopped !== null && done?.to === null
      ? stopped.shellTouches > 0
        ? 'shell'
        : stopped.closestGapU < grazeBelow
          ? 'graze'
          : null
      : !docked
        ? 'timeout'
        : touches > 0
          ? 'shell'
          : shellClearU < 0
            ? 'tunnel'
            : passedAt < grazeBelow
              ? 'graze'
              : null;

  const systemOf = (id: string | null): string =>
    id === null ? 'spawn' : (manifest.bodies.find((body) => body.id === id)?.system ?? '?');
  return {
    kind: spec.kind,
    from: spec.from ?? 'spawn',
    to: spec.to,
    fromSystem: systemOf(spec.from),
    toSystem: systemOf(spec.to),
    askedAt,
    straightU,
    seconds,
    docked,
    settledSec,
    how,
    profile,
    planU,
    planEtaSec,
    peakSpeed,
    takeoffSec: takeoff,
    cruiseSec: handedOver - takeoff,
    approachSec,
    captureSec: end - ringAt,
    firstThrustSec: firstThrust,
    closestGapU,
    closestBody: orbits.ids[closestBody] ?? '-',
    shellClearU,
    shellTouches,
    approachTimedOut:
      docked && handOff >= 0 && end - handOff >= sim.dock.approachTimeoutSec - dt / 2,
    valleys,
    deepestValley,
    peakAccel,
    failure,
    interrupt: done,
    stop:
      stopped === null
        ? null
        : {
            atSec: stopped.atSec,
            atSpeed: stopped.atSpeed,
            dropU: stopped.dropU,
            dropSec: stopped.dropSec,
            slideU: stopped.slideU,
            endSpeed: stopped.endSpeed,
            closestGapU: stopped.closestGapU,
            closestBody: stopped.closestBody,
            shellTouches: stopped.shellTouches,
          },
  };
}

/**
 * STOP MID-JOURNEY: fly `spec` once to find its fastest moment, then fly it again and press Stop
 * right there (fly's `stop`), watching the ship coast for `coastSec`. Journeys are exact
 * repeats, so the second flight is the first one up to that step. Null for a journey that never
 * flew on the autopilot (a body within reach is only approached).
 */
export function stopAtPeak(
  galaxy: Galaxy,
  spec: JourneySpec,
  sim: SimTuning,
  coastSec: number,
  limitSec = 60,
): JourneyResult | null {
  let atSec = -1;
  let peak = 0;
  fly(galaxy, spec, sim, limitSec, ({ t, state, mode }) => {
    const speed = speedOf(state);
    if (mode === 'autopilot' && speed > peak) {
      peak = speed;
      atSec = t;
    }
  });
  if (atSec < 0) return null;
  return fly(galaxy, spec, sim, limitSec, undefined, { kind: 'stop', atSec, coastSec });
}

// --- which journeys ----------------------------------------------------------------------------

export interface Sample {
  /** Ordered pairs of bodies in different systems: all of them, or a seeded sample of this many. */
  between: 'all' | number;
  /** Ordered pairs inside one system (home included): all, or a seeded sample of this many. */
  within: 'all' | number;
  /** From the spawn point, at rest, to every body. */
  spawn: boolean;
  /** Start conditions per pair: time (so where every planet is), place on the ring, way round. */
  starts: number;
}

/** A seeded sample of `count` of `items`, in their own order (all of them for 'all'). */
export function sampleOf<T>(items: T[], count: 'all' | number, seed: string): T[] {
  if (count === 'all' || count >= items.length) return items;
  const rng = createRng(seed);
  const order = items.map((item, index) => ({ item, index, key: rng() }));
  return order
    .sort((a, b) => a.key - b.key)
    .slice(0, Math.max(0, count))
    .sort((a, b) => a.index - b.index)
    .map(({ item }) => item);
}

/**
 * Every journey to fly in `galaxy`, with seeded start conditions: the same galaxy name, pair and
 * seed always give the same start, whatever the tuning, so variants are compared like for like.
 */
export function planJourneys(galaxy: Galaxy, sample: Sample, seed: string): JourneySpec[] {
  const { bodies } = galaxy.manifest;
  const between: Array<[string, string]> = [];
  const within: Array<[string, string]> = [];
  for (const a of bodies) {
    for (const b of bodies) {
      if (a.id === b.id) continue;
      (a.system === b.system ? within : between).push([a.id, b.id]);
    }
  }
  const specs: JourneySpec[] = [];
  const add = (kind: JourneyKind, from: string | null, to: string): void => {
    for (let k = 0; k < sample.starts; k += 1) {
      const rng = createRng(`${seed}|${galaxy.name}|${from ?? 'spawn'}|${to}|${k}`);
      const startSec = from === null ? 0 : rng() * 1200;
      const angle = rng() * TAU;
      const spin = rng() < 0.5 ? -1 : 1;
      // A new visitor reads the hint first; a docked one has been carried round for a moment.
      const dwellSec = from === null ? 0.5 + rng() * 7.5 : 0.5;
      specs.push({ kind, from, to, startSec, angle, spin, dwellSec });
    }
  };
  for (const [a, b] of sampleOf(between, sample.between, `${seed}|${galaxy.name}|between`)) {
    add('between', a, b);
  }
  for (const [a, b] of sampleOf(within, sample.within, `${seed}|${galaxy.name}|within`)) {
    add('within', a, b);
  }
  if (sample.spawn) for (const body of bodies) add('spawn', null, body.id);
  return specs;
}
