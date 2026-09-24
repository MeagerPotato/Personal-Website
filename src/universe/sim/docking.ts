import { orbitWish, type AssistParams, type AssistState, type BodyField } from './assist';
import { REFLEX_LEAD_SEC, courseLimits, ownLimits } from './reflex';
import { TAU, angleOf, clamp } from './math';
import { isSteering, speedOf } from './flight';
import { createSpring, stepSpring, type SpringState } from './spring';
import type { FlightInput, FlightParams, ShipState } from './types';

/**
 * DOCKING: asking to stay at a body, and staying there.
 *
 *   free      the ship flies; the orbit assist may hold it near a ring, loosely.
 *   approach  the pilot asked to dock. The assist's virtual pilot (sim/assist.ts) now has the
 *             controls to itself and flies the ship onto the ring, however it came in.
 *   docked    on the ring, the ship stops being flown and is CARRIED: a kinematic orbit in the
 *             body's own frame. Nothing integrates, so nothing drifts, however long a visitor
 *             reads; and a moon can be circled while it circles its planet.
 *
 * The hand-over from flown to carried happens at a small distance from the ring and at whatever
 * pace and nose angle the ship had. What is left over (off the ring, nose off the tangent, the
 * wrong pace) is not snapped away but settles on critically damped springs, which start with the
 * ship's own velocities: position AND velocity are continuous through a capture.
 *
 * The pilot can always leave: steering cancels an approach and leaves a dock. But only FRESH
 * steering counts. Someone who asks to dock with the throttle still held down means "dock".
 *
 * Pure and allocation-free, like the rest of sim/.
 */

/**
 * `cruise`: on the way to a body that is out of reach, flown by the autopilot (sim/autopilot.ts).
 * It is a phase of the DOCK because it is the same promise to the visitor ("you will be in orbit
 * there"), it ends the same ways, and the pilot takes the controls back the same way.
 */
export type DockPhase = 'free' | 'cruise' | 'approach' | 'docked';

export interface DockParams {
  /** The approach hands over to the orbit when the ship is this close to the ring (u) ... */
  readonly captureDistance: number;
  /** ... crossing it slower than this (u/s, in the body's frame). */
  readonly captureRadialSpeed: number;
  /**
   * The approach's pace, u/s, but never more than approachMaxRate rad/s round the body (a small
   * moon is circled calmly). It is flown with the autopilot's drive (sim/autopilot.ts,
   * CruiseParams.flight): whoever asked to dock wants to be there, not to drift there.
   */
  readonly approachSpeed: number;
  readonly approachMaxRate: number;
  /** The approach hurries: this much faster (u/s) for every unit it is still off the ring. */
  readonly hurryPerUnit: number;
  /** An approach that takes longer than this (s) is captured where it is: something was in the way. */
  readonly approachTimeoutSec: number;
  /** Docked: radians per second round the body, but never faster than `maxSpeed` u/s. */
  readonly orbitRate: number;
  readonly maxSpeed: number;
  /** 1/s: how quickly a capture's leftovers settle (the natural frequency of their springs). */
  readonly settleOmega: number;
  /** Steering above this cancels an approach or leaves a dock, once the controls were let go of. */
  readonly leaveDeadZone: number;
}

export interface DockState {
  phase: DockPhase;
  /** Row of the body in the orbit table, or -1. */
  body: number;
  /** +1 counter-clockwise seen from above, -1 clockwise. */
  spin: number;
  /** Seconds in the current phase. */
  phaseSec: number;
  /**
   * Have the controls been let go of since the request? Until then the pilot's input is not news.
   * (While `guarding`: has the throttle been let go of since the ship was handed back?)
   */
  armed: boolean;
  /** Set for one step when the PILOT ended an approach or a dock, so that whoever watches can tell. */
  leftByPilot: boolean;
  /**
   * The ship is not taken into orbit before this phase has lasted this long (s): a journey
   * (`cruise`, or an approach that is a whole journey, a planet asked for from its moon) still
   * takes as long as the shortest journey (CruiseParams.minJourneySec, which the Navigator asks
   * for); 0 for the pilot's own "dock here". What is left of it (holdSec - phaseSec) survives a
   * rebuilt engine (core/snapshot.ts).
   */
  holdSec: number;
  /**
   * STOP was pressed (haltDock): the ship, free again, brakes to rest by itself (haltingInput),
   * until it is at rest or the pilot takes the controls. Survives a rebuilt engine (core/snapshot.ts).
   */
  halting: boolean;
  /**
   * A journey was handed back by a turn or the throttle (pilotLeaves), or a STOP was steered out
   * of while the ship was still fast (haltingInput): the pilot flies, but until the ship is slow
   * enough for the cushions to stop (GUARD_SPEED), or the pilot opens the throttle afresh, the
   * reflex still brakes it for whatever lies on its course (guardInput). Never together with
   * `halting`. Survives a rebuilt engine (core/snapshot.ts).
   */
  guarding: boolean;
  /** Docked: where on the ring the ship is (unwrapped radians) and how fast it goes round (rad/s, signed). */
  angle: number;
  readonly rate: SpringState;
  /** Docked: distance off the ring (u), settling to 0. */
  readonly offset: SpringState;
  /** Docked: heading = the tangent + this; settles to a whole number of turns, so headings stay unwrapped. */
  readonly noseOff: SpringState;
  noseRest: number;
}

export function createDockState(): DockState {
  return {
    phase: 'free',
    body: -1,
    spin: 1,
    phaseSec: 0,
    armed: false,
    leftByPilot: false,
    holdSec: 0,
    halting: false,
    guarding: false,
    angle: 0,
    rate: createSpring(0),
    offset: createSpring(0),
    noseOff: createSpring(0),
    noseRest: 0,
  };
}

/**
 * Is the pilot opening the throttle, past `deadZone`? Boost alone is not: it only multiplies
 * thrust, and Shift is also half of Shift+Tab (sim/flight.ts, isSteering).
 */
function isThrusting(input: Readonly<FlightInput>, deadZone: number): boolean {
  return input.thrust > deadZone;
}

/**
 * Ask to dock at body `i`: fly onto its ring from within reach, or (`far`) travel there first,
 * and not be taken into orbit before `holdSec` has passed. The ship keeps flying; flyStep
 * (sim/surroundings.ts) takes it from here.
 */
export function requestDock(
  dock: DockState,
  i: number,
  pilot: Readonly<FlightInput>,
  far = false,
  holdSec = 0,
): void {
  if (dock.phase !== 'free' && dock.body === i) return;
  dock.phase = far ? 'cruise' : 'approach';
  dock.body = i;
  dock.phaseSec = 0;
  dock.holdSec = holdSec;
  dock.halting = false;
  dock.guarding = false;
  dock.leftByPilot = false;
  // Held controls are not news: they only count once they have been let go of.
  dock.armed = !isSteering(pilot, 0) && !(pilot.brake > 0);
}

/** Let go of the body: the ship is flown again from exactly where and how it was carried. */
export function releaseDock(dock: DockState, assist: AssistState): void {
  if (dock.phase === 'free') return;
  // The assist picks up where the dock left off, the same way round: no lurch on the way out.
  assist.body = dock.body;
  assist.spin = dock.spin;
  dock.phase = 'free';
  dock.body = -1;
  dock.phaseSec = 0;
}

/**
 * STOP: let go of the body, the way releaseDock does, and brake the ship to rest where it is. A
 * journey stopped between two moons at 200 u/s would otherwise coast on into one of them: the
 * autopilot's speed is gone at once (sim/surroundings.ts, dropOutOfWarp), but the pilot's own top
 * speed is still more than a cushion can stop.
 */
export function haltDock(dock: DockState, assist: AssistState): void {
  releaseDock(dock, assist);
  dock.guarding = false;
  dock.halting = true;
}

/**
 * The pilot has the controls back while the ship is still fast (DockState.guarding): keep the
 * reflex on for them until it is slow. A throttle that is held already is not news; only a fresh
 * one says "I am flying this now".
 */
export function guardDock(dock: DockState, pilot: Readonly<FlightInput>, deadZone: number): void {
  dock.halting = false;
  dock.guarding = true;
  dock.armed = !isThrusting(pilot, deadZone);
}

/** u/s. A halting ship this slow is at rest: the orbit assist may have it from here. */
const HALT_REST = 0.5;
/** The brake held, nothing else: what STOP flies (haltingInput). */
const HALT: Readonly<FlightInput> = Object.freeze({ thrust: 0, turn: 0, brake: 1, boost: false });

/**
 * FREE FLIGHT, before the assist: what the pilot flies. After STOP it is the brake, held for them
 * until the ship is at rest (the assist still turns it along a surface it is diving at); any
 * steering of their own ends that at once, and so does being at rest.
 */
export function haltingInput(
  dock: DockState,
  pilot: Readonly<FlightInput>,
  state: Readonly<ShipState>,
  params: DockParams,
): Readonly<FlightInput> {
  if (!dock.halting) return pilot;
  const steering = isSteering(pilot, params.leaveDeadZone);
  if (dock.phase !== 'free' || steering || speedOf(state) < HALT_REST) {
    dock.halting = false;
    // Steered out of a Stop that has not finished: the pilot flies, and the reflex stays on.
    if (steering && dock.phase === 'free') guardDock(dock, pilot, params.leaveDeadZone);
    return pilot;
  }
  return HALT;
}

/**
 * u/s. A ship handed back to its pilot is guarded (DockState.guarding) until it is this slow: the
 * cushions stop a ship that meets them head on at about 30 u/s by themselves (sim/collide.ts), and
 * below freeSpeeds the orbit assist is there too.
 */
const GUARD_SPEED = 25;
/**
 * The guard's reflex gain (sim/reflex.ts), as a share of what the pilot's own brake can do
 * (brakeDrag + forwardDrag of tuning.flight): below 1, so that a ship held to it never meets a shell.
 */
const GUARD_SHARE = 0.8;
/** 1/s: how hard the guard closes on the reflex's limit when the ship is faster than it. */
const GUARD_CATCH = 6;
/** Scratch: what a guarded ship flies. */
const guarded: FlightInput = { thrust: 0, turn: 0, brake: 0, boost: false };

/**
 * FREE FLIGHT, after haltingInput: what a GUARDED ship flies (DockState.guarding). The pilot's own
 * input, with the brake on as the reflex needs it for whatever lies on the ship's course (the
 * way it goes, or the way its nose points, sim/reflex.ts): taken back from a journey among the
 * target's moons at 200 u/s, a ship would otherwise coast on into one of them at the pilot's own
 * top speed, more than a cushion stops. Nothing is on its course in open space, and there it is
 * the pilot's input exactly. The guard ends once the ship is slow (GUARD_SPEED), or the pilot opens
 * the throttle afresh: someone flying at a planet on purpose is left to fly at it.
 */
export function guardInput(
  field: BodyField,
  dock: DockState,
  pilot: Readonly<FlightInput>,
  state: Readonly<ShipState>,
  flight: FlightParams,
  params: DockParams,
): Readonly<FlightInput> {
  if (!dock.guarding) return pilot;
  const thrusting = isThrusting(pilot, params.leaveDeadZone);
  if (!dock.armed && !thrusting) dock.armed = true;
  const speed = speedOf(state);
  if (dock.phase !== 'free' || speed < GUARD_SPEED || (dock.armed && thrusting)) {
    dock.guarding = false;
    return pilot;
  }
  const gain = GUARD_SHARE * (flight.brakeDrag + flight.forwardDrag);
  const limit = courseLimits(field, state, -1, 0, gain, REFLEX_LEAD_SEC, reflex)[0] ?? Infinity;
  if (!(limit < Infinity)) return pilot;
  // What the brake must take out: enough to follow the limit down as the way runs out (it falls
  // at `gain` times the speed; drag does some of that), to close on it from above, and whatever
  // the pilot's own throttle adds. Along the nose, either way: the grip takes the rest.
  const throttle = pilot.thrust > 0 ? Math.min(pilot.thrust, 1) : 0;
  const push = flight.thrustAccel * throttle * (pilot.boost ? flight.boostFactor : 1);
  const decel = (gain - flight.forwardDrag) * speed + GUARD_CATCH * (speed - limit) + push;
  const brake = clamp(decel / (flight.brakeDrag * speed), 0, 1);
  if (!(brake > pilot.brake)) return pilot;
  guarded.thrust = pilot.thrust;
  guarded.turn = pilot.turn;
  guarded.brake = brake;
  guarded.boost = pilot.boost;
  return guarded;
}

/**
 * The pilot's say during an approach or a dock. Returns true when they have just taken the
 * controls back; the dock is then already released.
 */
export function pilotLeaves(
  dock: DockState,
  pilot: Readonly<FlightInput>,
  params: DockParams,
  assist: AssistState,
): boolean {
  dock.leftByPilot = false;
  if (dock.phase === 'free') return false;
  const steering = isSteering(pilot, params.leaveDeadZone);
  // Braking is "stop", not "leave": it ends a journey, and a docked ship has already stopped.
  const active = steering || (dock.phase !== 'docked' && pilot.brake > params.leaveDeadZone);
  if (!dock.armed) {
    if (!active) dock.armed = true;
    return false;
  }
  if (!active) return false;
  const journey = dock.phase !== 'docked';
  releaseDock(dock, assist);
  dock.leftByPilot = true;
  // A journey handed back must not coast on into whatever lies ahead: the pilot's own top speed,
  // 81 u/s, is more than a cushion stops. The brake is Stop, as the prompt's button is (haltDock):
  // it brakes to rest. A turn or the throttle is the pilot flying again, and the reflex stays on
  // for them until the ship is slow (guardInput). (A docked ship is slow already.)
  if (journey) {
    if (steering) guardDock(dock, pilot, params.leaveDeadZone);
    else {
      dock.guarding = false;
      dock.halting = true;
    }
  }
  return true;
}

/**
 * Scratch: the approach's pace, filled from DockParams on every call, and the reflex's limits for
 * every other body and for its own.
 */
const pace = { speed: 0, maxRate: 0, hurry: 0, brakeGain: 0, limit: Infinity, brakeAt: Infinity };
const reflex = new Float64Array(2);
const own = new Float64Array(2);

/** What the approach needs of the autopilot's own tuning (sim/autopilot.ts, CruiseParams). */
export interface ApproachDrive {
  /** The drive it flies with. */
  readonly flight: FlightParams;
  /** 1/s: how hard it brakes off speed it does not want (the autopilot's throttle gain). */
  readonly speedGain: number;
  /** 1/s: the reflex's gain (sim/reflex.ts). */
  readonly openSpaceGain: number;
}

/**
 * APPROACH, before the flight step: what the virtual pilot flies, written into `out`. Fly it with
 * `drive.flight`, the autopilot's (CruiseParams.flight). The way round is the assist's choice, so
 * an approach out of a loose orbit carries straight on. An approach can begin at any speed (a body
 * asked for while the autopilot races past it), and brakes off what it does not want as the
 * autopilot would, with the same reflex for whatever lies on its course (sim/reflex.ts).
 */
export function approachInput(
  field: BodyField,
  state: Readonly<ShipState>,
  drive: ApproachDrive,
  assistParams: AssistParams,
  params: DockParams,
  dock: DockState,
  assist: AssistState,
  out: FlightInput,
): FlightInput {
  if (assist.body !== dock.body) {
    assist.body = dock.body;
    assist.spin = 0;
  }
  assist.weight = 1;
  pace.speed = params.approachSpeed;
  pace.maxRate = params.approachMaxRate;
  pace.hurry = params.hurryPerUnit;
  pace.brakeGain = drive.speedGain;
  // The reflex counts the body the approach is for as well, with the plain berth (ownLimits), and
  // past its limit the ship brakes in full (WishPace.brakeAt): a ship diving at the body is
  // stopped, one on its way onto the ring never meets that limit. Left out (as the autopilot
  // leaves out the body its plan arrives at), a body asked for just after one beside it, the ship
  // already closing on it at 44 u/s from 8 u above, had its shell touched at 14 u/s.
  courseLimits(field, state, dock.body, 0, drive.openSpaceGain, REFLEX_LEAD_SEC, reflex);
  own.fill(Infinity);
  pace.brakeAt = ownLimits(field, state, dock.body, 0, drive.openSpaceGain, own)[0] ?? Infinity;
  pace.limit = Math.min(reflex[0] ?? Infinity, pace.brakeAt);
  return orbitWish(field, dock.body, state, drive.flight, assistParams, assist, out, pace);
}

/**
 * The pace at which the approach flies onto the ring of radius `ring`, u/s: what the autopilot
 * slows down to before it hands a ship over (sim/autopilot.ts).
 */
export function approachPace(ring: number, params: DockParams): number {
  return Math.min(params.approachSpeed, params.approachMaxRate * ring);
}

/**
 * An approach is captured going round no faster than this many times its own pace (approachPace),
 * the bound a journey arrives under too (sim/autopilot.ts, ARRIVAL_PACE). A ship that skims the
 * ring faster (the pilot's E at speed, beside a small moon) is flown on until it has slowed:
 * captured as it was, the springs would take the excess out of it at once, at twice settleOmega
 * times the excess (380 u/s^2 measured, where an ordinary capture sees 30 to 50).
 */
const CAPTURE_PACE = 2.5;

/**
 * APPROACH, after the flight step: is the ship on the ring? Then it is captured: carried from
 * here on, starting with exactly the motion it has.
 */
export function tryCapture(
  field: BodyField,
  state: Readonly<ShipState>,
  params: DockParams,
  dock: DockState,
  assist: AssistState,
  dt: number,
): boolean {
  dock.phaseSec += dt;
  const i = dock.body;
  const ring = field.ringRadius[i] ?? 0;
  const rx = state.x - (field.positions[i * 2] ?? 0);
  const rz = state.z - (field.positions[i * 2 + 1] ?? 0);
  const d = Math.hypot(rx, rz);
  if (d < 1e-6) return false;
  const vx = state.vx - (field.velocities[i * 2] ?? 0);
  const vz = state.vz - (field.velocities[i * 2 + 1] ?? 0);
  const outward = (vx * rx + vz * rz) / d;
  // Counter-clockwise speed along the ring: the tangent is (r.z, -r.x) / d.
  const swirl = (vx * rz - vz * rx) / d;
  const spin = assist.spin === 0 ? (swirl < 0 ? -1 : 1) : assist.spin;

  const onRing =
    Math.abs(d - ring) < params.captureDistance &&
    Math.abs(outward) < params.captureRadialSpeed &&
    swirl * spin > 0 &&
    Math.abs(swirl) <= approachPace(ring, params) * CAPTURE_PACE &&
    dock.phaseSec >= dock.holdSec;
  if (!onRing && dock.phaseSec < params.approachTimeoutSec) return false;

  capture(dock, spin, angleOf(rx, rz), d - ring, outward, swirl / d, state);
  return true;
}

/**
 * A JOURNEY'S END (sim/autopilot.ts): the ship came in beside the ring, travelling along it, and
 * is carried from here on, the `spin` way round, with exactly the motion it has. It needs no
 * approach of its own: the springs take it the rest of the way onto the ring and down to the
 * docked pace, the same as they settle a capture's leftovers, while the camera turns to the body.
 */
export function arrive(
  field: BodyField,
  state: Readonly<ShipState>,
  dock: DockState,
  spin: number,
): void {
  const i = dock.body;
  const rx = state.x - (field.positions[i * 2] ?? 0);
  const rz = state.z - (field.positions[i * 2 + 1] ?? 0);
  const d = Math.max(Math.hypot(rx, rz), 1e-6);
  const vx = state.vx - (field.velocities[i * 2] ?? 0);
  const vz = state.vz - (field.velocities[i * 2 + 1] ?? 0);
  const outward = (vx * rx + vz * rz) / d;
  const swirl = (vx * rz - vz * rx) / d;
  const ring = field.ringRadius[i] ?? 0;
  capture(dock, spin < 0 ? -1 : 1, angleOf(rx, rz), d - ring, outward, swirl / d, state);
}

/** Put a ship straight into orbit at `angle` round body `i`, at rest in it (a page opened on a planet). */
export function dockAt(
  field: BodyField,
  state: ShipState,
  params: DockParams,
  dock: DockState,
  i: number,
  angle: number,
  spin = 1,
): void {
  dock.body = i;
  const ring = field.ringRadius[i] ?? 0;
  const way = spin < 0 ? -1 : 1;
  capture(dock, way, angle, 0, 0, way * dockedRate(ring, params), null);
  // Nose along the ring, in whichever whole turn the ship's heading already is: unwrapped
  // headings stay comparable across the cut.
  const tangent = angle + (way * Math.PI) / 2;
  dock.noseRest = Math.round((state.heading - tangent) / TAU) * TAU;
  dock.noseOff.value = dock.noseRest;
  dock.noseOff.velocity = 0;
  carry(field, state, dock);
}

/** DOCKED: one step of being carried round the body. Writes the ship's whole state. */
export function stepDocked(
  field: BodyField,
  state: ShipState,
  params: DockParams,
  dock: DockState,
  dt: number,
): void {
  dock.phaseSec += dt;
  const ring = field.ringRadius[dock.body] ?? 0;
  stepSpring(dock.rate, dock.spin * dockedRate(ring, params), params.settleOmega, dt);
  stepSpring(dock.offset, 0, params.settleOmega, dt);
  stepSpring(dock.noseOff, dock.noseRest, params.settleOmega, dt);
  dock.angle += dock.rate.value * dt;
  carry(field, state, dock);
}

function dockedRate(ring: number, params: DockParams): number {
  return Math.min(params.orbitRate, params.maxSpeed / Math.max(ring, 1e-6));
}

function capture(
  dock: DockState,
  spin: number,
  angle: number,
  offset: number,
  outwardSpeed: number,
  rate: number,
  state: Readonly<ShipState> | null,
): void {
  dock.phase = 'docked';
  dock.halting = false;
  dock.guarding = false;
  dock.spin = spin;
  dock.phaseSec = 0;
  dock.leftByPilot = false;
  dock.angle = angle;
  dock.rate.value = rate;
  dock.rate.velocity = 0;
  dock.offset.value = offset;
  dock.offset.velocity = outwardSpeed;
  if (state) {
    // Everything the nose is off the tangent by, whole turns included: headings are unwrapped.
    const off = state.heading - (angle + (spin * Math.PI) / 2);
    dock.noseOff.value = off;
    dock.noseOff.velocity = state.yawRate - rate;
    dock.noseRest = Math.round(off / TAU) * TAU;
  }
}

/** Where the dock says the ship is, written over the ship's state. */
function carry(field: BodyField, state: ShipState, dock: DockState): void {
  const i = dock.body;
  const r = (field.ringRadius[i] ?? 0) + dock.offset.value;
  const sin = Math.sin(dock.angle);
  const cos = Math.cos(dock.angle);
  const rate = dock.rate.value;
  state.x = (field.positions[i * 2] ?? 0) + r * sin;
  state.z = (field.positions[i * 2 + 1] ?? 0) + r * cos;
  // d/dt of the above: the body's own motion, going round, and settling onto the ring.
  state.vx = (field.velocities[i * 2] ?? 0) + r * rate * cos + dock.offset.velocity * sin;
  state.vz = (field.velocities[i * 2 + 1] ?? 0) - r * rate * sin + dock.offset.velocity * cos;
  state.heading = dock.angle + (dock.spin * Math.PI) / 2 + dock.noseOff.value;
  state.yawRate = rate + dock.noseOff.velocity;
}
