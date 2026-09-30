import { smoothstep } from './math';

/**
 * THE LIGHT OF THE BODY THE SHIP IS NEAR. Every body is lit by one light (world/Galaxy.ts: the
 * first sun up its chain of parents, or the distant key light round home), and a ship on its ring
 * must be lit by that same light: the orbit camera frames the two together, and two lights would
 * show. So near a body, the body's light CLAIMS the ship: fully on the body's docking ring and
 * inside it, letting go by `letGoRadii` ring radii (tuning.world.shipLightClaimRadii, a little
 * past the sphere in which the orbit assist holds a ship: sim/assist.ts, pullOf), and not at all
 * beyond. A body nothing docks at (a relay) claims nothing: no ship circles it.
 *
 * What the claims then do to the ship's light is world/Galaxy.ts's (lightAt). Pure and
 * allocation-free, like the rest of sim/.
 */

/** The bodies as the ship's light sees them. Row i is body i of the orbit table. */
export interface LitBodies {
  readonly count: number;
  /** Where each body is: [x0, z0, x1, z1, ...] in world units. */
  readonly positions: ArrayLike<number>;
  /** The ring a ship circles each body on, from its centre (the manifest's dockRadius). */
  readonly ringRadius: ArrayLike<number>;
  /** 1 for a body a ship may dock at, 0 for one it never may (sim/assist.ts, BodyField.docks). */
  readonly docks: ArrayLike<number>;
  /** Which light lights each body: an index into the caller's list of lights, or -1 for none. */
  readonly light: ArrayLike<number>;
}

/**
 * How firmly each light claims a ship at (x, z), written into `out` (one slot per light, 0 to 1):
 * the firmest claim of any body it lights, so that a moon beside its planet, or a planet near its
 * sun, never adds up to more than one of them. Returns the firmest claim of all: 0 where the ship
 * is near no body, 1 on a ring.
 */
export function lightClaims(
  bodies: LitBodies,
  x: number,
  z: number,
  letGoRadii: number,
  out: Float64Array,
): number {
  out.fill(0);
  let firmest = 0;
  for (let i = 0; i < bodies.count; i += 1) {
    const ring = bodies.ringRadius[i] ?? 0;
    const light = bodies.light[i] ?? -1;
    if (!(ring > 0) || bodies.docks[i] === 0 || light < 0 || light >= out.length) continue;
    const d = Math.hypot(
      x - (bodies.positions[i * 2] ?? 0),
      z - (bodies.positions[i * 2 + 1] ?? 0),
    );
    const claim = 1 - smoothstep(ring, letGoRadii * ring, d);
    if (!(claim > 0)) continue;
    if (claim > (out[light] ?? 0)) out[light] = claim;
    if (claim > firmest) firmest = claim;
  }
  return firmest;
}
