import { isSteering } from '../../sim/flight';
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
  /**
   * The controls were switched off or back on (InputSystem.setEnabled). Nobody `read`s a source
   * while they are off; one that also SHOWS something (a thumb stick) puts it away here.
   */
  setEnabled?(enabled: boolean): void;
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

/**
 * Has the pilot touched a flight control: thrust, a turn, or the brake? The input system's "first
 * input", which puts the first-visit hint away for good. Boost alone is none (sim/flight.ts,
 * isSteering, says why): Shift is also half of Shift+Tab.
 */
export function touchesControls(input: Readonly<FlightInput>): boolean {
  return isSteering(input) || input.brake > 0;
}
