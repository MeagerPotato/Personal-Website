import type { Path } from './path';

/**
 * HOW FAST, WHERE: the speed the autopilot wants at every sample of a path. The same three
 * passes as a robot's motion profile: a ceiling from the bends (a bend of radius R at speed v
 * pushes sideways with v²/R, and that is capped; and it takes a turn rate of v/R, which the ship
 * only has so much of), a pass BACKWARDS from the end so that every
 * slow place is braked for in time, and a pass FORWARDS from the speed the ship has now so that
 * nothing is asked to speed up faster than it can.
 */
export interface ProfileParams {
  /** u/s on the straights. */
  readonly cruiseSpeed: number;
  /** u/s²: speeding up, slowing down, and sideways in a bend. */
  readonly accel: number;
  readonly decel: number;
  readonly lateralAccel: number;
  /**
   * 1/s. The ship's brake is a drag: it takes off a share of the speed every second, so at low
   * speed it has little to take off, and `decel` is more than the ship can do. Slowing down takes
   * at least 1 / brakeRate units of path for every u/s. Keep it below the ship's own
   * (brakeDrag + forwardDrag).
   */
  readonly brakeRate: number;
  /** rad/s: no bend is taken faster than the ship can turn. Keep it below the ship's own limit. */
  readonly yawRate: number;
  /** u/s. The profile never asks for less: a ship told to stand still never arrives. */
  readonly minSpeed: number;
}

/**
 * Fill `speeds` (one per sample of `path`) and return the seconds the journey will take. The
 * ship has `startSpeed` now and should have `endSpeed` for the last `endRun` units of the path:
 * whoever takes over near the end (the docking approach) takes over somewhere along that stretch.
 * `ceiling`, when given, caps the speed at every sample on top of everything else.
 *
 * A ship that is too fast for what lies ahead cannot be helped by arithmetic: the profile then
 * simply starts lower than the ship is, and the pursuit brakes as hard as it can.
 */
export function speedProfile(
  path: Readonly<Path>,
  startSpeed: number,
  endSpeed: number,
  endRun: number,
  params: ProfileParams,
  speeds: Float64Array,
  ceiling: Float64Array | null = null,
): number {
  const { count, s, curvature } = path;
  if (count === 0) return 0;
  const floor = params.minSpeed;

  // 1. Backwards from the end: the bends' ceiling, and braking in time for whatever is slower.
  const slow = Math.max(floor, Math.min(endSpeed, params.cruiseSpeed));
  const slowFrom = path.length - endRun;
  let next = slow;
  speeds[count - 1] = next;
  for (let i = count - 2; i >= 0; i -= 1) {
    const bend = curvature[i] ?? 0;
    const limit = Math.min(
      (s[i] ?? 0) >= slowFrom ? slow : params.cruiseSpeed,
      ceiling ? (ceiling[i] ?? Infinity) : Infinity,
      bend > 1e-9
        ? Math.min(Math.sqrt(params.lateralAccel / bend), params.yawRate / bend)
        : Infinity,
    );
    const ds = (s[i + 1] ?? 0) - (s[i] ?? 0);
    next = Math.max(
      floor,
      Math.min(limit, Math.sqrt(next * next + 2 * params.decel * ds), next + params.brakeRate * ds),
    );
    speeds[i] = next;
  }

  // 2. Forwards from the speed the ship has.
  let before = Math.max(floor, Math.min(startSpeed, speeds[0] ?? floor));
  speeds[0] = before;
  let seconds = 0;
  for (let i = 1; i < count; i += 1) {
    const ds = (s[i] ?? 0) - (s[i - 1] ?? 0);
    const reachable = Math.sqrt(before * before + 2 * params.accel * ds);
    const here = Math.min(speeds[i] ?? floor, reachable);
    speeds[i] = here;
    seconds += (2 * ds) / (before + here);
    before = here;
  }
  return seconds;
}
