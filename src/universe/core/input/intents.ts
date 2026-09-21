import type { FlightInput } from '../../sim/types';

/**
 * Devices do not move the ship. Each one only says what the pilot WANTS (an intent), the input
 * system merges them into one FlightInput per simulation step, and the flight model does the
 * rest. The autopilot and the replay recorder are just two more sources of the same intents,
 * which is why a recorded flight replays exactly (docs/PLAN.md §3, §5.5).
 */
export interface InputSource {
  /** Add what this device currently wants into `out`, using `addIntent`. */
  read(out: FlightInput): void;
  dispose(): void;
}

export function clearIntent(out: FlightInput): FlightInput {
  out.thrust = 0;
  out.turn = 0;
  out.brake = 0;
  out.boost = false;
  return out;
}

/**
 * Merge one device's wishes into the total. Thrust and brake take the strongest request, turns
 * add up (a key and a stick pushing opposite ways cancel), boost is on if anyone asks.
 */
export function addIntent(
  out: FlightInput,
  thrust: number,
  turn: number,
  brake: number,
  boost: boolean,
): FlightInput {
  out.thrust = Math.min(1, Math.max(out.thrust, thrust));
  out.brake = Math.min(1, Math.max(out.brake, brake));
  out.turn = Math.min(1, Math.max(-1, out.turn + turn));
  out.boost = out.boost || boost;
  return out;
}

/** Is the pilot asking for anything? Used for "first input" and to cancel the autopilot. */
export function isSteering(input: Readonly<FlightInput>, deadZone = 0): boolean {
  return (
    input.thrust > deadZone ||
    input.brake > deadZone ||
    Math.abs(input.turn) > deadZone ||
    input.boost
  );
}
