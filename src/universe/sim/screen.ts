/**
 * WHERE THE BODIES ARE ON SCREEN. Pure maths for whoever needs to know: picking (what is under
 * the pointer?) and labels (where does a name go?). The camera arrives as the sixteen numbers of
 * its view-projection matrix, so all of this runs headless.
 *
 * Every body lies on the flat XZ plane (y = 0), like everything else that can be flown to.
 */

export interface ScreenMap {
  /** How many rows are filled in. Rows are the rows of the orbit table (sim/orbits.ts). */
  count: number;
  /** CSS px from the left and from the top of the view. Meaningless where `depth` is not positive. */
  readonly x: Float64Array;
  readonly y: Float64Array;
  /** How big the body looks: its radius, in CSS px. */
  readonly radius: Float64Array;
  /** Units in front of the camera. Zero or less: beside it or behind it. */
  readonly depth: Float64Array;
}

export function createScreenMap(capacity: number): ScreenMap {
  return {
    count: 0,
    x: new Float64Array(capacity),
    y: new Float64Array(capacity),
    radius: new Float64Array(capacity),
    depth: new Float64Array(capacity),
  };
}

/**
 * Fill `out` with where `count` bodies appear through a perspective camera.
 *
 * `viewProjection` is projection x view, column-major (three's `Matrix4.elements`). `focal` is
 * element 5 of the PROJECTION matrix: how many half-view-heights a unit spans at a distance of one
 * unit. `positions` is [x0, z0, x1, z1, ...] in world units, `radii` likewise by row.
 */
export function projectBodies(
  viewProjection: ArrayLike<number>,
  focal: number,
  width: number,
  height: number,
  positions: ArrayLike<number>,
  radii: ArrayLike<number>,
  count: number,
  out: ScreenMap,
): ScreenMap {
  const m = viewProjection;
  const rows = Math.min(count, out.x.length);
  out.count = rows;
  for (let i = 0; i < rows; i += 1) {
    const x = positions[i * 2] ?? 0;
    const z = positions[i * 2 + 1] ?? 0;
    // Clip space, for a point with y = 0 and w = 1. For a perspective camera, clip w is the
    // distance in front of it.
    const cw = (m[3] ?? 0) * x + (m[11] ?? 0) * z + (m[15] ?? 0);
    out.depth[i] = cw;
    if (!(cw > 0)) {
      out.radius[i] = 0;
      continue;
    }
    const cx = (m[0] ?? 0) * x + (m[8] ?? 0) * z + (m[12] ?? 0);
    const cy = (m[1] ?? 0) * x + (m[9] ?? 0) * z + (m[13] ?? 0);
    out.x[i] = (cx / cw / 2 + 0.5) * width;
    out.y[i] = (0.5 - cy / cw / 2) * height;
    out.radius[i] = ((radii[i] ?? 0) * focal * height) / 2 / cw;
  }
  return out;
}

export interface PickParams {
  /** A body that looks smaller than this (radius, CSS px) can still be hit within this radius. */
  readonly minTargetPx: number;
  /** A body that looks smaller than this (radius, CSS px) cannot be picked: nobody can see it. */
  readonly minVisiblePx: number;
}

/**
 * The row of the body under the point (px, py), or -1. A point right ON a body's disc beats a
 * point that is merely near one, the nearer of two discs wins (it is the one in front), and of two
 * bodies the point is merely near, the one whose edge is closer wins. `ignore` is a row that is
 * not worth picking: where the ship already is, or is going.
 */
export function pickBody(
  map: Readonly<ScreenMap>,
  px: number,
  py: number,
  params: PickParams,
  ignore = -1,
): number {
  let best = -1;
  let bestOn = false;
  let bestScore = Infinity;
  for (let i = 0; i < map.count; i += 1) {
    if (i === ignore) continue;
    const depth = map.depth[i] ?? 0;
    const radius = map.radius[i] ?? 0;
    if (!(depth > 0) || radius < params.minVisiblePx) continue;
    const d = Math.hypot(px - (map.x[i] ?? 0), py - (map.y[i] ?? 0));
    if (d > Math.max(radius, params.minTargetPx)) continue;
    const on = d <= radius;
    const score = on ? depth : d - radius;
    if ((on && !bestOn) || (on === bestOn && score < bestScore)) {
      best = i;
      bestOn = on;
      bestScore = score;
    }
  }
  return best;
}

export interface TapParams {
  /** A press that travels further than this (CSS px) is a drag, not a tap. */
  readonly tapMaxPx: number;
  /** A press that lasts longer than this is a hold, not a tap. */
  readonly tapMaxSec: number;
}

/** Was a press that went down at (x0, y0) and came up `seconds` later at (x1, y1) a tap? */
export function isTap(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  seconds: number,
  params: TapParams,
): boolean {
  return seconds <= params.tapMaxSec && Math.hypot(x1 - x0, y1 - y0) <= params.tapMaxPx;
}
