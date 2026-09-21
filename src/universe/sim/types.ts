/**
 * Shared shapes of the simulation. Conventions (docs/PLAN.md, Appendix A):
 *
 * - The world is flown on a flat plane: X and Z, with Y up. One unit is about a metre at toy scale.
 * - Angles are radians, COUNTER-CLOCKWISE seen from above, and angle 0 points along +Z. A unit
 *   vector at angle a is (sin a, cos a): see `sim/math.ts`. This is exactly what three.js does
 *   for `object.rotation.y = a`, so a heading can be copied straight onto a mesh.
 * - Headings are NOT wrapped to a range. Interpolating between two states is then a plain lerp.
 *
 * Logic owns these contracts; `design/tuning.ts` fills in the values with `satisfies`, so a design
 * edit that breaks a shape is a type error, not a surprise at runtime.
 */

export interface Vec2 {
  x: number;
  z: number;
}

/** Everything the flight model integrates. Plain numbers, so a copy is a snapshot. */
export interface ShipState {
  /** Position on the flight plane, in units. */
  x: number;
  z: number;
  /** Velocity, in units per second. */
  vx: number;
  vz: number;
  /** Where the nose points. Unwrapped radians. */
  heading: number;
  /** Radians per second; positive turns counter-clockwise (to the pilot's left). */
  yawRate: number;
}

/** What a pilot (a person, the autopilot, a replay) asks of the ship during one step. */
export interface FlightInput {
  /** 0 to 1. There is no reverse. */
  thrust: number;
  /** -1 to 1. Positive steers to the pilot's left (counter-clockwise from above). */
  turn: number;
  /** 0 to 1. */
  brake: number;
  boost: boolean;
}

export interface FlightParams {
  /** Forward acceleration at full thrust, u/s². */
  readonly thrustAccel: number;
  /** Multiplies thrust while boosting. */
  readonly boostFactor: number;
  /** Drag along the nose, 1/s. Top speed is thrustAccel / forwardDrag. */
  readonly forwardDrag: number;
  /** Extra drag along the nose at full brake, 1/s. */
  readonly brakeDrag: number;
  /** Drag across the nose, 1/s. High = the ship goes where it points; low = it drifts. */
  readonly lateralGrip: number;
  /** Turn rate at a standstill, rad/s. */
  readonly yawRateSlow: number;
  /** Turn rate at `yawRateFastSpeed` and beyond, rad/s: fast ships turn wider. */
  readonly yawRateFast: number;
  readonly yawRateFastSpeed: number;
  /** How quickly the turn rate follows the stick: a time constant in seconds. */
  readonly yawResponseSec: number;
}
