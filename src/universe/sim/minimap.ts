import type { BodyKind } from '../data/types';
import type { ThemeKey } from '../design/tokens';
import type { MiniSystem } from './instruments';
import {
  takeIn,
  unitsPerPx,
  type MapBounds,
  type MapBoundsOut,
  type MapFrame,
  type MapScaleParams,
  type MapView,
  type MapViewParams,
} from './mapView';
import type { Path } from './path';
import { pickBody, type PickParams, type ScreenMap } from './screen';
import { GLYPHS } from './world/glyphs';

/**
 * THE MINIMAP, as pure maths (ui/MiniMap.ts draws it): the star map at another size. The same
 * plane seen from straight above, north up, +X to the left (sim/mapView.ts); the same rule for how
 * big a body is drawn (`displayScales`, with sizes of its own); the same picking (`pickBody`). So
 * the minimap never has a rule the star map lacks. What is its own is here:
 *
 *   WHAT IT LOOKS AT   one of two things, never a view the visitor moved: the whole galaxy, or
 *                      the system the ship is in (`miniScope`, `miniBounds`; then `fitView`).
 *   WHERE THINGS ARE   on a frame of its own, in CSS px from its top left corner, with every
 *                      system that is off the frame pinned at the rim in its direction, so that
 *                      any system is one press away (`projectMini`).
 *   WHAT A PRESS MEANS `pickMini`: a mouse as on the canvas; a finger only where it is clear
 *                      which mark it means.
 *
 * Nothing here knows the galaxy's shape: a frame of any size fits a galaxy of any aspect.
 */

/** The scope that is not a system: the whole galaxy. */
export const GALAXY = -1;

/**
 * WHAT THE MINIMAP SHOWS: the index of the system it is fitted to, or GALAXY. `at` is the system
 * the ship is in (sim/instruments.ts, `systemAt`, which keeps its answer across a system's edge)
 * and `targetSystem` the system of the body it is headed for (-1: none). Inside a system, that
 * system; unless the ship is leaving for another, and anywhere between systems: the galaxy, where
 * the way there can be seen.
 */
export function miniScope(at: number, targetSystem: number): number {
  return at >= 0 && (targetSystem < 0 || targetSystem === at) ? at : GALAXY;
}

/**
 * The rectangle a scope has to show, into `out`: the galaxy (`all`: sim/mapView.ts, `boundsOf`),
 * or the square round one system's reach; either grown to hold the ship at (x, z), which may be
 * out beyond it. `fitView` then fits it into a frame of any shape.
 */
export function miniBounds(
  scope: number,
  systems: readonly MiniSystem[],
  all: MapBounds,
  x: number,
  z: number,
  out: MapBoundsOut,
): MapBoundsOut {
  const system = systems[scope];
  if (!system) return takeIn(all, x, z, out);
  const [cx, cz] = system.position;
  out.minX = cx - system.radius;
  out.maxX = cx + system.radius;
  out.minZ = cz - system.radius;
  out.maxZ = cz + system.radius;
  return takeIn(out, x, z, out);
}

/**
 * Which mark lies on top where two overlap, by kind of body: the SMALLER one, so that a moon can
 * be pressed on its planet and a planet on its sun. This is the `depth` of a mark (`pickBody`
 * takes the nearest of the discs a point is on). 0: no mark at all, for a body nothing docks at
 * (a relay): the minimap flies the ship to what it shows.
 */
export function markDepth(kind: BodyKind): number {
  if (kind === 'link') return 0;
  if (kind === 'moon') return 1;
  return kind === 'sun' || kind === 'home' ? 3 : 2;
}

/** The depth of a system pinned at the rim: under everything that is really there. */
export const PIN_DEPTH = 4;

/** What `projectMini` needs to know of the bodies, by row of the orbit table. */
export interface MiniBodies {
  readonly count: number;
  /** How far out each body is drawn, world units: what the star map measures (MapBodies.radius). */
  readonly radius: ArrayLike<number>;
  /** `markDepth` of its kind, or 0 for a body the ship cannot dock at. */
  readonly depth: ArrayLike<number>;
  /**
   * By system: the row of the body at its heart (its sun, the home planet, a binary's primary
   * sun), which stands for the system when it is off the frame. -1: none.
   */
  readonly centers: ArrayLike<number>;
}

export interface MiniDrawParams {
  /** A mark that would be smaller than this (radius, CSS px) is not drawn, and cannot be pressed. */
  readonly minVisiblePx: number;
  /** A system off the frame is pinned this far inside the frame's edge (CSS px)... */
  readonly rimInsetPx: number;
  /** ...as a mark of this radius. */
  readonly rimRadiusPx: number;
}

/**
 * WHERE EVERY MARK IS, into `out`, by row: CSS px from the frame's top left corner, its radius,
 * and its `depth` (see `markDepth`). A row whose depth is 0 has no mark: the body is too small at
 * this scale (`scales`: sim/mapView.ts, `displayScales`, with the minimap's own sizes), nothing
 * docks at it, or it is off the frame. Its place is written all the same.
 *
 * Then the rim: the body at the heart of each system, when it lies outside the frame less
 * `rimInsetPx`, is put ON that inner edge, on the line from the middle of the frame toward where
 * it really is, with depth PIN_DEPTH. So a mark slides to the rim and stays there as the view
 * closes in on another system, and never jumps.
 *
 * Two systems that lie one behind the other would be one pin on top of the other, and only one
 * of them a press away. So a pin makes way for the pins of the systems BEFORE its own (home, the
 * first, never moves): it steps back along its own line, toward the middle, just until the two
 * touch. Its direction stays true, and it is back at the rim once the two are clear.
 *
 * What is drawn and what can be pressed are the same rows: `pickMini` reads this.
 */
export function projectMini(
  view: Readonly<MapView>,
  frame: MapFrame,
  positions: ArrayLike<number>,
  bodies: MiniBodies,
  scales: ArrayLike<number>,
  params: MiniDrawParams,
  out: ScreenMap,
): ScreenMap {
  const perPx = unitsPerPx(view.span, frame);
  const midX = frame.width / 2;
  const midY = frame.height / 2;
  const rows = Math.min(bodies.count, out.x.length);
  out.count = rows;
  for (let i = 0; i < rows; i += 1) {
    // North up, +X to the left: sim/mapView.ts, `pointOn`.
    const x = midX + (view.x - (positions[i * 2] ?? 0)) / perPx;
    const y = midY + (view.z - (positions[i * 2 + 1] ?? 0)) / perPx;
    const radius = ((bodies.radius[i] ?? 0) * (scales[i] ?? 1)) / perPx;
    const depth = bodies.depth[i] ?? 0;
    const shows =
      depth > 0 &&
      radius >= params.minVisiblePx &&
      x >= 0 &&
      x <= frame.width &&
      y >= 0 &&
      y <= frame.height;
    out.x[i] = x;
    out.y[i] = y;
    out.radius[i] = shows ? radius : 0;
    out.depth[i] = shows ? depth : 0;
    out.ownX[i] = 0;
    out.ownY[i] = 0;
  }

  const reachX = Math.max(0, midX - params.rimInsetPx);
  const reachY = Math.max(0, midY - params.rimInsetPx);
  const apart = 2 * params.rimRadiusPx;
  for (let s = 0; s < bodies.centers.length; s += 1) {
    const row = bodies.centers[s] ?? -1;
    if (row < 0 || row >= rows || !((bodies.depth[row] ?? 0) > 0)) continue;
    const dx = (out.x[row] ?? 0) - midX;
    const dy = (out.y[row] ?? 0) - midY;
    // How much of the way from the middle to the body is inside the inner edge: 1 or more, all.
    const share = Math.min(
      dx === 0 ? Infinity : reachX / Math.abs(dx),
      dy === 0 ? Infinity : reachY / Math.abs(dy),
    );
    if (share >= 1) continue;
    // Px from the middle along the line to the body: as far as the inner edge, less whatever
    // the pins already there need (each seen from this line: so far along it, so far beside).
    // Stepping back from one may meet another, so look again until it is clear of them all.
    const far = Math.hypot(dx, dy);
    let along = share * far;
    let again = true;
    while (again) {
      again = false;
      for (let e = 0; e < s; e += 1) {
        const pin = bodies.centers[e] ?? -1;
        if (pin < 0 || pin >= rows || out.depth[pin] !== PIN_DEPTH) continue;
        const px = (out.x[pin] ?? 0) - midX;
        const py = (out.y[pin] ?? 0) - midY;
        const ahead = (px * dx + py * dy) / far;
        const beside = (px * dy - py * dx) / far;
        const room = Math.sqrt(Math.max(0, apart * apart - beside * beside));
        // (Never past the middle: a pin there has run out of line, and stays.)
        const back = Math.max(0, ahead - room);
        if (Math.abs(along - ahead) < room && back < along) {
          along = back;
          again = true;
        }
      }
    }
    out.x[row] = midX + (dx / far) * along;
    out.y[row] = midY + (dy / far) * along;
    out.radius[row] = params.rimRadiusPx;
    out.depth[row] = PIN_DEPTH;
  }
  return out;
}

/**
 * THE ROW OF THE MARK A POINTER AIMS AT, or -1: (px, py) in CSS px from the frame's top left
 * corner. A mouse picks exactly as on the canvas (`pickBody`, with `reach`: tuning.picking.mouse):
 * the mark it is on, the smaller of two it is on, else the nearest within reach.
 *
 * A finger (`coarse`, with tuning.picking.touch) covers several of these marks at once. The one
 * it is ON is the one it means; one it is merely near counts only if no other mark within reach
 * is less than `ambiguityPx` further off. Between two, it aims at nothing, and nothing flies.
 *
 * `ignore` is a row not worth picking: the body the ship is at, or is headed for.
 */
export function pickMini(
  map: Readonly<ScreenMap>,
  px: number,
  py: number,
  reach: PickParams,
  coarse: boolean,
  ambiguityPx: number,
  ignore = -1,
): number {
  const best = pickBody(map, px, py, reach, ignore);
  if (best < 0 || !coarse) return best;
  const miss = missOf(map, best, px, py);
  if (miss <= 0) return best;
  for (let i = 0; i < map.count; i += 1) {
    if (i === best || i === ignore) continue;
    const radius = map.radius[i] ?? 0;
    if (!((map.depth[i] ?? 0) > 0) || radius < reach.minVisiblePx) continue;
    const other = missOf(map, i, px, py);
    if (other + radius > Math.max(radius, reach.minTargetPx)) continue;
    if (other - miss < ambiguityPx) return -1;
  }
  return best;
}

/** How far (px, py) is from the edge of mark `i`, CSS px: zero or less on it. */
function missOf(map: Readonly<ScreenMap>, i: number, px: number, py: number): number {
  return Math.hypot(px - (map.x[i] ?? 0), py - (map.y[i] ?? 0)) - (map.radius[i] ?? 0);
}

/**
 * THE REST OF A JOURNEY, for the line the minimap draws: at most `max` points of `path` from
 * sample `from` (where the ship is: the autopilot's own index) to its end, evenly picked, into
 * `out` as [x0, z0, x1, z1, ...] in world units. Returns how many: the first is sample `from`,
 * the last the path's end, and fewer than two is no line.
 */
export function routePoints(
  path: Readonly<Path>,
  from: number,
  max: number,
  out: Float64Array,
): number {
  const last = path.count - 1;
  const first = Math.max(0, Math.floor(from));
  const left = last - first + 1;
  const count = Math.max(0, Math.min(left, Math.floor(max), Math.floor(out.length / 2)));
  for (let k = 0; k < count; k += 1) {
    const i = count < 2 ? last : first + Math.round((k * (last - first)) / (count - 1));
    out[k * 2] = path.x[i] ?? 0;
    out[k * 2 + 1] = path.z[i] ?? 0;
  }
  return count;
}

/** To a hundredth: a glyph is some eleven px across. */
const round = (value: number): number => Math.round(value * 100) / 100 + 0;

/**
 * A family's glyph (sim/world/glyphs.ts) as the `d` of an SVG path about (0, 0), `r` px in
 * radius, the way it stands on the map: its apex up (+Z is up the screen, +X to the left).
 * Closed, so that it can be filled, or stroked as an outline.
 */
export function glyphPath(theme: ThemeKey, r: number): string {
  let d = '';
  for (const [x, z] of GLYPHS[theme](r)) d += `${d ? 'L' : 'M'}${round(-x)} ${round(-z)}`;
  return `${d}Z`;
}

/** Everything the minimap is tuned by (design/tuning.ts, `minimap`). */
export interface MiniMapParams extends MapViewParams, MapScaleParams, MiniDrawParams {
  /** 1/s. How quickly the view eases from one scope to the next. A cut under reduced motion. */
  readonly viewOmega: number;
  /**
   * No mark is smaller than this (radius, CSS px), by kind of body: in the galaxy's scope, and
   * in a system's. 0: its true size, which at these scales is nothing.
   */
  readonly minRadiusPx: {
    readonly galaxy: Readonly<Record<BodyKind, number>>;
    readonly system: Readonly<Record<BodyKind, number>>;
  };
  /** CSS px. A finger near two marks aims at one only if the other is this much further off. */
  readonly ambiguityPx: number;
  /** A journey's line is drawn through at most this many points. */
  readonly routePoints: number;
  /** The marks are put in place this often a second (the ship, every frame). */
  readonly bodiesHz: number;
  /** CSS px. The length of the ship's chevron. */
  readonly shipPx: number;
}
