/**
 * What a thumb on a virtual stick MEANS. Pure, so it can be tested without a phone.
 *
 * The idea is "drag toward where you want to go", seen from behind the ship:
 *
 *   up            fly straight ahead
 *   up and left   fly ahead while steering left; the further off "up", the harder the turn
 *   left, right   a full turn, still under thrust: you want to GO there, not spin on the spot
 *   straight down the brake (a narrow cone; a thumb pulled down-left still means "turn left")
 *
 * How far the stick is pushed is the throttle, so a gentle push is a gentle cruise.
 */
export interface StickParams {
  /** Share of the stick's travel, from the centre, in which nothing happens. */
  readonly stickDeadZone: number;
  /** Degrees off "straight up" at which the turn is full. */
  readonly stickFullTurnDeg: number;
  /** Half-angle, in degrees, of the cone around "straight down" that means brake. */
  readonly stickBrakeConeDeg: number;
}

export interface StickIntent {
  thrust: number;
  turn: number;
  brake: number;
}

const DEG_PER_RAD = 180 / Math.PI;

/**
 * `x` and `y` are the stick's deflection as shares of its travel, in SCREEN directions: +x is to
 * the right, +y is DOWN (as pointer coordinates are). Values past 1 are treated as 1.
 */
export function mapStick(x: number, y: number, params: StickParams, out: StickIntent): StickIntent {
  out.thrust = 0;
  out.turn = 0;
  out.brake = 0;

  const length = Math.hypot(x, y);
  if (!(length > params.stickDeadZone)) return out; // also catches NaN
  // Rescaled so the throttle starts at 0 at the edge of the dead zone, not with a jump.
  const push = Math.min(1, (length - params.stickDeadZone) / (1 - params.stickDeadZone));

  // 0 = straight up; positive = to the LEFT, which is a positive (counter-clockwise) turn.
  const offUp = Math.atan2(-x, -y) * DEG_PER_RAD;
  if (Math.abs(offUp) > 180 - params.stickBrakeConeDeg) {
    out.brake = push;
    return out;
  }

  out.thrust = push;
  out.turn = Math.max(-1, Math.min(1, offUp / params.stickFullTurnDeg));
  return out;
}
