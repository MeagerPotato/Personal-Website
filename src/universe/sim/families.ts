import type { OrbitTable } from './orbits';

/**
 * FAMILIES: a body and everything that circles it, however deep (a sun, its planets and their
 * moons; a planet and its moons; the home planet, its station and its satellite). This is how far
 * each body's family reaches from the body's centre: its own docking ring plus `pad`, or, where
 * something circles it further out, that one's orbit plus that one's own family. 0 for a body
 * with no ring (nothing to keep clear of, and nothing it lends its reach to).
 *
 * Two readers, so the two agree on what a family is: the autopilot goes round a small family as
 * one disc (pad = its keep-out, sim/autopilot.ts), and the galaxy lights the ship by the sun
 * whose family it is in (pad 0, world/Galaxy.ts: for a system with one sun, that is the system's
 * own radius).
 *
 * Parents come before their children in the table, so going through it backwards meets every
 * child before its parent: one pass settles every family. Pure, and allocation-free.
 */
export function familyReaches(
  orbits: Pick<OrbitTable, 'count' | 'parent' | 'radius'>,
  ringRadius: ArrayLike<number>,
  pad: number,
  out: Float64Array,
): Float64Array {
  for (let j = 0; j < orbits.count; j += 1) {
    const own = ringRadius[j] ?? 0;
    out[j] = own > 0 ? own + pad : 0;
  }
  for (let j = orbits.count - 1; j >= 0; j -= 1) {
    const parent = orbits.parent[j] ?? -1;
    if (parent < 0 || !((out[j] ?? 0) > 0)) continue;
    out[parent] = Math.max(out[parent] ?? 0, (orbits.radius[j] ?? 0) + (out[j] ?? 0));
  }
  return out;
}
