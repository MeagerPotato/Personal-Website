import { orbitWish, type AssistParams, type AssistState, type BodyField } from './assist';
import { TAU, angleOf } from './math';
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
  /** Have the controls been let go of since the request? Until then the pilot's input is not news. */
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
    angle: 0,
    rate: createSpring(0),
    offset: createSpring(0),
    noseOff: createSpring(0),
    noseRest: 0,
  };
}

function isSteering(input: Readonly<FlightInput>, deadZone: number): boolean {
  return input.thrust > deadZone || Math.abs(input.turn) > deadZone || input.boost;
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
  releaseDock(dock, assist);
  dock.leftByPilot = true;
  return true;
}

/** Scratch: the approach's pace, filled from DockParams on every call. */
const pace = { speed: 0, maxRate: 0, hurry: 0 };

/**
 * APPROACH, before the flight step: what the virtual pilot flies, written into `out`. Fly it with
 * `drive`, the autopilot's (CruiseParams.flight). The way round is the assist's choice, so an
 * approach out of a loose orbit carries straight on.
 */
export function approachInput(
  field: BodyField,
  state: Readonly<ShipState>,
  drive: FlightParams,
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
  return orbitWish(field, dock.body, state, drive, assistParams, assist, out, pace);
}

/**
 * The pace at which the approach flies onto the ring of radius `ring`, u/s: what the autopilot
 * slows down to before it hands a ship over (sim/autopilot.ts).
 */
export function approachPace(ring: number, params: DockParams): number {
  return Math.min(params.approachSpeed, params.approachMaxRate * ring);
}

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
