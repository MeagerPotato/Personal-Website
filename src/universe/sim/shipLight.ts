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
 * It lets go along a smoothstep, which starts flat. The orbit assist holds a ship about 0.15 u
 * off the ring, and at Robotics, where the blend leans up to 57 degrees off the body's light on
 * the ring, a straight let-go would leave that ship 0.6 degrees off and one along √u 6, where the
 * smoothstep leaves 0.02. Shapes that start steeper turned the light at most 1.4 degrees a frame
 * less for a pilot leaving at boost (docs/PLAN.md §5.4, the Projects binary), so the flat start
 * won.
 *
 * What the claims then do to the ship's light is world/Galaxy.ts's (lightAt): it turns the light
 * it would have had away from every body toward the claiming one, by the claim (turnToward).
 * Pure and allocation-free, like the rest of sim/.
 */

/** A direction in space, as a three.js Vector3 holds one (sim/ never imports three). */
export interface Direction {
  x: number;
  y: number;
  z: number;
}

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

/**
 * Turns the unit direction `from` toward the unit direction `to` by `t` (0 to 1) of the angle
 * between them, the short way round (a slerp), into `out`, which may be either of them. By ANGLE:
 * a quarter of the way is a quarter of the turn. Blending the two directions as vectors instead
 * would crowd a wide turn into the middle of the way (of 150 degrees, 124 in the middle half),
 * and the ship's light would turn that much faster for a ship crossing where a body lets go of it
 * (leaving Robotics' ring by the Projects binary's gap at boost, 34 degrees in a frame at worst
 * instead of 23: tests/ship-light.test.ts pins it). Two opposite directions have no one short way
 * between them: there `from` stands until `t` is 1, and then it is `to`.
 */
export function turnToward(
  from: Readonly<Direction>,
  to: Readonly<Direction>,
  t: number,
  out: Direction,
): Direction {
  const share = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const { x: ax, y: ay, z: az } = from;
  const { x: bx, y: by, z: bz } = to;
  const cos = Math.min(1, Math.max(-1, ax * bx + ay * by + az * bz));
  const angle = Math.acos(cos);
  const sin = Math.sin(angle);
  if (sin > 1e-9) {
    const a = Math.sin((1 - share) * angle) / sin;
    const b = Math.sin(share * angle) / sin;
    const x = ax * a + bx * b;
    const y = ay * a + by * b;
    const z = az * a + bz * b;
    // Unit to within rounding already; made unit again, as three.js's Vector3.normalize() would.
    const scale = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    out.x = x * scale;
    out.y = y * scale;
    out.z = z * scale;
  } else if (cos > 0 || share >= 1) {
    out.x = bx;
    out.y = by;
    out.z = bz;
  } else {
    out.x = ax;
    out.y = ay;
    out.z = az;
  }
  return out;
}
