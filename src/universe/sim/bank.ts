import { clamp, smoothstep } from './math';

/** What decides how far the ship leans into a turn (tuning.ship, tuning.flight). */
export interface BankParams {
  /** Radians of lean at the full turn rate. */
  readonly bankRad: number;
  /** u/s. The lean fades in up to this speed: a ship turning on the spot does not lean. */
  readonly bankFullSpeed: number;
}

/**
 * How far the ship leans into a turn, radians: `bankRad` at `fullRate` (rad/s, the pilot's own
 * flight.yawRateSlow) and never more, whoever turns it. A left turn (yawRate > 0) drops the left
 * wing: negative bank. The autopilot turns faster than the pilot can (cruise.flight.yawRateSlow is
 * 7 rad/s against the pilot's 2.6), and the lean it drew, 2.7 times bankRad, was a ship on its side
 * at every bend.
 */
export function bankOf(
  yawRate: number,
  speed: number,
  fullRate: number,
  params: BankParams,
): number {
  const share = fullRate > 0 ? clamp(yawRate / fullRate, -1, 1) : 0;
  return -params.bankRad * share * smoothstep(0, params.bankFullSpeed, speed);
}
