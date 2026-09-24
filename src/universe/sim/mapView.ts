import { clamp, lerp, smoothstep } from './math';

/**
 * THE STAR MAP, as pure maths (docs/PLAN.md §3, Appendix A): what the map looks at, how dragging
 * and zooming change that, and how big every body is drawn on it.
 *
 * The map is the flight plane seen from straight above, north up: +Z is up the screen, and so +X
 * is to the LEFT (the same way round as the chase view when the ship heads along +Z). Seen from
 * straight above through any lens, a plane is simply scaled: one number, `unitsPerPx`, says how
 * many world units a CSS pixel covers, everywhere on the map.
 */

/** What the map looks at: the point in the middle of the free view, and how much of the plane shows. */
export interface MapView {
  x: number;
  z: number;
  /** World units across the SHORTER side of the free view. Smaller is closer. */
  span: number;
}

/** The part of the viewport that the info panel leaves free, in CSS px. */
export interface MapFrame {
  readonly width: number;
  readonly height: number;
}

/** Everything there is to see: a rectangle on the flight plane. */
export interface MapBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** The same rectangle, to be written into (`takeIn`). */
export type MapBoundsOut = { -readonly [K in keyof MapBounds]: MapBounds[K] };

export interface MapViewParams {
  /** The closest the map may zoom (world units across the shorter side). */
  readonly spanMin: number;
  /**
   * The furthest, as a share of the view that shows everything (`fitSpan`): 1 is not an inch
   * further. Past it there is only empty space, and names too small to read.
   */
  readonly zoomOutPastFit: number;
  /** Showing everything leaves this much room round it: 1.25 = a quarter more than it needs... */
  readonly fitMargin: number;
  /**
   * ...and this much more on every side, in CSS px: a body at the edge of the galaxy has its name
   * beside it (ui/Labels.ts), and a margin in pixels is the same room for it on any screen.
   */
  readonly fitPadPx: number;
}

/** The rectangle that holds every system, its outermost orbit included. */
export function boundsOf(
  systems: ReadonlyArray<{ readonly position: readonly [number, number]; readonly radius: number }>,
): MapBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const { position, radius } of systems) {
    minX = Math.min(minX, position[0] - radius);
    maxX = Math.max(maxX, position[0] + radius);
    minZ = Math.min(minZ, position[1] - radius);
    maxZ = Math.max(maxZ, position[1] + radius);
  }
  return systems.length > 0 ? { minX, maxX, minZ, maxZ } : { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
}

/**
 * `bounds` grown to take in the point (x, z), written to `out`: what the map shows is the galaxy
 * AND the ship, which may be out beyond its edge (sim/collide.ts lets it go that far).
 */
export function takeIn(bounds: MapBounds, x: number, z: number, out: MapBoundsOut): MapBoundsOut {
  out.minX = Math.min(bounds.minX, x);
  out.maxX = Math.max(bounds.maxX, x);
  out.minZ = Math.min(bounds.minZ, z);
  out.maxZ = Math.max(bounds.maxZ, z);
  return out;
}

export function unitsPerPx(span: number, frame: MapFrame): number {
  return span / Math.max(1, Math.min(frame.width, frame.height));
}

/**
 * The span at which `bounds` fits the frame snugly, margin and padding and all: as close as the
 * map can be and still show everything. However much the galaxy has grown, it always fits.
 */
export function fitSpan(bounds: MapBounds, frame: MapFrame, params: MapViewParams): number {
  const width = Math.max(1, frame.width);
  const height = Math.max(1, frame.height);
  // The padding comes off every side; but a frame too small for it still gets half of itself.
  const pad = Math.max(0, params.fitPadPx) * 2;
  const innerWidth = Math.max(width - pad, width / 2);
  const innerHeight = Math.max(height - pad, height / 2);
  // X runs across the screen and Z up it.
  const perPx = Math.max(
    ((bounds.maxX - bounds.minX) * params.fitMargin) / innerWidth,
    ((bounds.maxZ - bounds.minZ) * params.fitMargin) / innerHeight,
  );
  return Math.max(params.spanMin, perPx * Math.min(width, height));
}

/** The furthest the map may zoom out: the view that shows everything (never closer than spanMin). */
export function spanLimit(bounds: MapBounds, frame: MapFrame, params: MapViewParams): number {
  return Math.max(params.spanMin, fitSpan(bounds, frame, params) * params.zoomOutPastFit);
}

/** The view that shows everything: what the map opens on. */
export function fitView(
  bounds: MapBounds,
  frame: MapFrame,
  params: MapViewParams,
  out: MapView,
): MapView {
  out.x = (bounds.minX + bounds.maxX) / 2;
  out.z = (bounds.minZ + bounds.maxZ) / 2;
  out.span = fitSpan(bounds, frame, params);
  return out;
}

/**
 * Keep the zoom within its limits, and the view on the galaxy: a view smaller than the galaxy
 * (one way, or both) can be moved up to its edge and fitPadPx past it, not further; one bigger
 * than it keeps all of it in view, fitPadPx inside its edges. So nothing is ever dragged off, and
 * the empty space round the galaxy is never more than the view that shows all of it has.
 */
export function clampView(
  view: MapView,
  bounds: MapBounds,
  frame: MapFrame,
  params: MapViewParams,
): MapView {
  view.span = clamp(view.span, params.spanMin, spanLimit(bounds, frame, params));
  const perPx = unitsPerPx(view.span, frame);
  const pad = Math.max(0, params.fitPadPx) * perPx;
  view.x = keepOn(view.x, bounds.minX, bounds.maxX, (Math.max(1, frame.width) / 2) * perPx - pad);
  view.z = keepOn(view.z, bounds.minZ, bounds.maxZ, (Math.max(1, frame.height) / 2) * perPx - pad);
  return view;
}

/**
 * The middle of a view that reaches `half` either side of it, kept where the view shows nothing
 * outside [min, max]; or, when it is wider than that, where all of [min, max] is in it.
 */
function keepOn(at: number, min: number, max: number, half: number): number {
  const low = min + half;
  const high = max - half;
  return clamp(at, Math.min(low, high), Math.max(low, high));
}

/**
 * Drag the map by (dx, dy) CSS px: the world goes with the pointer, so the middle of the view
 * moves the other way. Right on screen is -X and down is -Z, hence the signs.
 */
export function panBy(view: MapView, dx: number, dy: number, frame: MapFrame): MapView {
  const perPx = unitsPerPx(view.span, frame);
  view.x += dx * perPx;
  view.z += dy * perPx;
  return view;
}

/**
 * Zoom by `factor` (above 1 = further out) so that whatever is under the point (px, py) stays
 * under it. The point is in CSS px from the MIDDLE of the free view, x to the right and y down.
 */
export function zoomAbout(
  view: MapView,
  factor: number,
  px: number,
  py: number,
  frame: MapFrame,
  limits: { readonly min: number; readonly max: number },
): MapView {
  const before = unitsPerPx(view.span, frame);
  view.span = clamp(view.span * factor, limits.min, limits.max);
  const after = unitsPerPx(view.span, frame);
  // The world point under the pointer is x - px * perPx (and likewise for z): keep it.
  view.x += px * (after - before);
  view.z += py * (after - before);
  return view;
}

/** The world point under (px, py), measured like `zoomAbout` measures it. Written to `out` as [x, z]. */
export function pointUnder(
  view: Readonly<MapView>,
  px: number,
  py: number,
  frame: MapFrame,
  out: Float64Array,
): Float64Array {
  const perPx = unitsPerPx(view.span, frame);
  out[0] = view.x - px * perPx;
  out[1] = view.z - py * perPx;
  return out;
}

export interface MapScaleParams {
  /**
   * A body orbiting another shows once there is room for it: nothing while its disc would touch
   * its parent's, full size once they are this many CSS px apart.
   */
  readonly clearPx: number;
}

/** What `displayScales` needs to know of the bodies, by row of the orbit table. */
export interface MapBodies {
  readonly count: number;
  /** Row of the body each one circles, or -1. Parents come before their children. */
  readonly parent: ArrayLike<number>;
  /** Radius of that circle, world units. */
  readonly orbitRadius: ArrayLike<number>;
  /** How big the body is, world units. */
  readonly radius: ArrayLike<number>;
  /** The smallest it may look on the map (radius, CSS px), by what kind of body it is. */
  readonly minRadiusPx: ArrayLike<number>;
}

/**
 * HOW BIG EVERY BODY IS DRAWN, as a factor on its true size. Off the map (`weight` 0) that is 1.
 * On it (`weight` 1) the galaxy is a few pixels per hundred units, so a body is blown up until it
 * is at least its kind's minimum size, and one that would then sit on top of the body it circles
 * (a moon, from far out) is not drawn at all: 0. In between, while the camera pulls out, the two
 * are mixed, so nothing pops.
 *
 * Everything that shows or measures a body reads these (world/Galaxy.ts draws with them,
 * ui/BodiesOnScreen.ts measures with them), so a disc, its name and where it can be clicked
 * always agree.
 */
export function displayScales(
  bodies: MapBodies,
  perPx: number,
  weight: number,
  params: MapScaleParams,
  out: Float64Array,
): Float64Array {
  const w = clamp(weight, 0, 1);
  for (let i = 0; i < bodies.count; i += 1) {
    if (w === 0 || !(perPx > 0)) {
      out[i] = 1;
      continue;
    }
    // Sizes mix by ratio (halfway to eight times as big is about three times), presence by share.
    // A body that is on its way out does not grow first: what it grows by shrinks with its room.
    const room = roomOnMap(bodies, i, perPx, params);
    out[i] = Math.pow(grownOnMap(bodies, i, perPx), w * room) * lerp(1, room, w);
  }
  return out;
}

/** The factor that brings body `i` up to its kind's smallest size on the map. Never below 1. */
function grownOnMap(bodies: MapBodies, i: number, perPx: number): number {
  const radius = Math.max(bodies.radius[i] ?? 0, 1e-6);
  return Math.max(1, ((bodies.minRadiusPx[i] ?? 0) * perPx) / radius);
}

/**
 * Is there space on the map between body `i` and the body it circles? 0 to 1. A body with no room
 * takes what circles IT along, whatever room those have.
 */
function roomOnMap(bodies: MapBodies, i: number, perPx: number, params: MapScaleParams): number {
  const parent = bodies.parent[i] ?? -1;
  // (Parents come before their children, so this ends.)
  if (parent < 0 || parent >= i) return 1;
  const own = (bodies.radius[i] ?? 0) * grownOnMap(bodies, i, perPx);
  const theirs = (bodies.radius[parent] ?? 0) * grownOnMap(bodies, parent, perPx);
  const gapPx = ((bodies.orbitRadius[i] ?? 0) - theirs - own) / perPx;
  return Math.min(smoothstep(0, params.clearPx, gapPx), roomOnMap(bodies, parent, perPx, params));
}
