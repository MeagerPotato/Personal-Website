import { clamp, lerp } from './math';
import type { FlightInput, FlightParams, ShipState, Vec2 } from './types';

/**
 * The flight model: arcade, forgiving, and impossible to get lost in. It is a car more than a
 * spacecraft: the ship thrusts along its nose, drag sets a top speed, and a strong sideways grip
 * makes it go where it points (docs/PLAN.md, Appendix A).
 *
 * In the ship's own frame the model is two linear equations,
 *
 *   forward:  v' = thrust - (forwardDrag + brake) * v
 *   sideways: v' = -lateralGrip * v
 *
 * which are integrated EXACTLY over the step (exponential decay) instead of with Euler steps.
 * Same cost, and two properties worth having in a file a designer tunes: top speed is exactly
 * thrustAccel / forwardDrag, and no value of any drag can make the simulation blow up.
 *
 * Pure and allocation-free: it mutates the state it is given, reads no clock, and the same inputs
 * always produce the same bits, so a recorded flight replays exactly.
 */

export const NO_INPUT: Readonly<FlightInput> = Object.freeze({
  thrust: 0,
  turn: 0,
  brake: 0,
  boost: false,
});

const NO_ACCELERATION: Readonly<Vec2> = Object.freeze({ x: 0, z: 0 });

export function createShipState(x = 0, z = 0, heading = 0): ShipState {
  return { x, z, vx: 0, vz: 0, heading, yawRate: 0 };
}

export function copyShipState(from: Readonly<ShipState>, to: ShipState): ShipState {
  to.x = from.x;
  to.z = from.z;
  to.vx = from.vx;
  to.vz = from.vz;
  to.heading = from.heading;
  to.yawRate = from.yawRate;
  return to;
}

export function speedOf(state: Readonly<ShipState>): number {
  return Math.hypot(state.vx, state.vz);
}

/**
 * Is the pilot FLYING: thrusting or turning, past `deadZone`? Boost is not flying: it only
 * multiplies thrust (stepFlight, below), so on its own it moves nothing. And Shift is also half of
 * Shift+Tab, which only moves the focus back one control: that must never take a reader out of
 * orbit, off their page or off a journey (sim/docking.ts), nor count as having flown
 * (core/input/intents.ts).
 */
export function isSteering(input: Readonly<FlightInput>, deadZone = 0): boolean {
  return input.thrust > deadZone || Math.abs(input.turn) > deadZone;
}

/** Top speed in a straight line, u/s. */
export function topSpeed(params: FlightParams, boost = false): number {
  return (params.thrustAccel * (boost ? params.boostFactor : 1)) / params.forwardDrag;
}

/** Fast ships turn wider: the turn rate falls from `yawRateSlow` to `yawRateFast` with speed. */
export function maxYawRate(speed: number, params: FlightParams): number {
  const t = params.yawRateFastSpeed > 0 ? clamp(speed / params.yawRateFastSpeed, 0, 1) : 1;
  return lerp(params.yawRateSlow, params.yawRateFast, t);
}

/** A stick value that might be NaN, or out of range after two sources were added together. */
const sanitize = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? clamp(value, min, max) : 0;

/** v' = accel - drag * v, advanced by exactly dt. */
function decayToward(velocity: number, accel: number, drag: number, dt: number): number {
  if (drag < 1e-9) return velocity + accel * dt;
  const keep = Math.exp(-drag * dt);
  return velocity * keep + (accel / drag) * (1 - keep);
}

/**
 * Advance the ship by one step of `dt` seconds. `external` is whatever else pushes on it this
 * step (orbit assist, the pull back from the edge of the world), as an acceleration in u/s².
 */
export function stepFlight(
  state: ShipState,
  input: Readonly<FlightInput>,
  params: FlightParams,
  dt: number,
  external: Readonly<Vec2> = NO_ACCELERATION,
): ShipState {
  const thrust = sanitize(input.thrust, 0, 1);
  const turn = sanitize(input.turn, -1, 1);
  const brake = sanitize(input.brake, 0, 1);

  // 1. Steering. The turn rate eases toward what the stick asks for, then turns the nose.
  const targetYawRate = turn * maxYawRate(speedOf(state), params);
  const yawKeep = params.yawResponseSec > 1e-9 ? Math.exp(-dt / params.yawResponseSec) : 0;
  state.yawRate = targetYawRate + (state.yawRate - targetYawRate) * yawKeep;
  state.heading += state.yawRate * dt;

  // 2. Thrust, drag and grip, in the frame of the nose as it points now.
  const forwardX = Math.sin(state.heading);
  const forwardZ = Math.cos(state.heading);
  const forwardSpeed = state.vx * forwardX + state.vz * forwardZ;
  const sideSpeed = state.vx * forwardZ - state.vz * forwardX;

  const push = params.thrustAccel * thrust * (input.boost ? params.boostFactor : 1);
  const nextForward = decayToward(
    forwardSpeed,
    push,
    params.forwardDrag + params.brakeDrag * brake,
    dt,
  );
  const nextSide = decayToward(sideSpeed, 0, params.lateralGrip, dt);

  // 3. Back to world axes, plus whatever else pushes on the ship.
  state.vx = nextForward * forwardX + nextSide * forwardZ + external.x * dt;
  state.vz = nextForward * forwardZ - nextSide * forwardX + external.z * dt;

  // 4. Move with the NEW velocity (semi-implicit), which is what keeps orbits from spiralling out.
  state.x += state.vx * dt;
  state.z += state.vz * dt;
  return state;
}
