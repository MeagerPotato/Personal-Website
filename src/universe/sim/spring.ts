/**
 * A critically damped spring, solved EXACTLY: the fastest way to reach a target without ever
 * overshooting it. It is how the camera follows the ship, and how anything eases toward a value
 * that keeps moving.
 *
 * Exact means frame-rate independent: one step of 1/30 s lands in the same place as two steps of
 * 1/60 s (to rounding), so the camera feels the same on a slow phone and a fast laptop, and no
 * frame time, however long, can make it oscillate or explode.
 *
 * `omega` is the natural frequency in rad/s: higher is snappier. The spring covers about 63% of a
 * step change in 2.15 / omega seconds (at omega = 14, about 0.15 s).
 */
export interface SpringState {
  value: number;
  velocity: number;
}

export function createSpring(value = 0): SpringState {
  return { value, velocity: 0 };
}

/**
 * Advance the spring by `dt` seconds. `target` is where the target is at the END of the step and
 * `targetVelocity` how fast it moved during it (leave it out for a target that stands still).
 *
 * Knowing the target's velocity is what keeps a chase camera steady: behind a target that moves at
 * a constant speed u the spring trails by exactly 2u / omega, whatever the frame time. Without it
 * the trail would depend on the frame time, and uneven frames would show up as judder.
 */
export function stepSpring(
  spring: SpringState,
  target: number,
  omega: number,
  dt: number,
  targetVelocity = 0,
): SpringState {
  if (!(omega > 0) || !(dt > 0)) return spring;
  // Relative to the moving target, e'' + 2 omega e' + omega^2 e = -2 omega u, which solves to
  // e(t) = lag + (a + b t) exp(-omega t), with lag = -2u / omega the steady trail.
  const lag = (-2 * targetVelocity) / omega;
  const error = spring.value - (target - targetVelocity * dt);
  const a = error - lag;
  const b = spring.velocity - targetVelocity + omega * a;
  const decay = Math.exp(-omega * dt);
  spring.value = target + lag + (a + b * dt) * decay;
  spring.velocity = targetVelocity + (b - omega * (a + b * dt)) * decay;
  return spring;
}

/** Jump to a value and stop there (a cut, not an ease: deep links, reduced motion). */
export function snapSpring(spring: SpringState, value: number): SpringState {
  spring.value = value;
  spring.velocity = 0;
  return spring;
}
