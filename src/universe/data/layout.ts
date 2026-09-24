import { tuning } from '../design/tuning';
import { createRng } from '../sim/rng';

// Where everything sits, decided at BUILD time and baked into /universe.json. Pure functions of
// their arguments and of tuning.layout: same input, same galaxy, on every machine.
//
// Stability rule (docs/PLAN.md §5.4): anything random is seeded by the body's OWN id, never by
// its index in a list. Systems keep their place for ever (their slot is the explicit `order`, and
// slot k is placed knowing only slots 0 to k - 1), and adding a newer project or a new system
// moves nothing. The one thing that can shift is a ring's radius: a back-dated project, or a new
// moon, widens the rings from that planet outwards. Angles never change. Phase 3's
// galaxy.lock.json pins even that.

const L = tuning.layout;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

export function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Radius of the docking orbit around a body of the given radius. */
export function dockRadius(bodyRadius: number): number {
  return bodyRadius + Math.max(L.dockMin, L.dockScale * bodyRadius);
}

/** Kepler-flavoured, not Kepler: outer rings are slower, and nothing needs a mass. */
export function orbitPeriod(orbitRadius: number): number {
  return L.periodAtStartSec * (orbitRadius / L.orbitStart) ** L.periodExponent;
}

/** Angle at t = 0. Seeded by the body's id alone. */
export function orbitPhase(bodyId: string): number {
  return createRng(`phase:${bodyId}`)() * TAU;
}

export interface HomeRing {
  kind: 'station' | 'satellite';
  /** Radius of the body. */
  radius: number;
  /** Its docking orbit. */
  footprint: number;
}

/**
 * The home system: the home planet at the centre, and the station's and the satellite's rings
 * round it, station inside. Both rings are always reserved, whether or not their pages exist yet,
 * so publishing one can never move the other; and so the home system is always the same size.
 */
export function homeRings(): Array<Ring<HomeRing>> {
  const centerDock = dockRadius(L.home.planetRadius);
  const slots = (['station', 'satellite'] as const).map((kind) => {
    const radius = kind === 'station' ? L.home.stationRadius : L.home.satelliteRadius;
    return { kind, radius, footprint: dockRadius(radius) };
  });
  return stackRings(slots, centerDock + L.moonGap, L.moonGap);
}

/** How far the home system reaches: its outermost docking orbit. The same for every galaxy. */
export function homeReach(): number {
  return reach(homeRings(), dockRadius(L.home.planetRadius));
}

/**
 * u. The room between slots must be the build's tripwires (data/build.ts) plus this much, so that
 * rounding positions to 2 places can never close a gap the build then complains about.
 */
const SLOT_SLACK = 1;
/** u. Two pockets this close to equally far from the hub are a tie. */
const TIE = 1e-3;

/**
 * Centre of the system in slot `order` on the flight plane. Slot 0 is the origin (home).
 *
 * WHERE A SLOT IS DEPENDS ON THREE NUMBERS AND THE ORDER, and on nothing else:
 * `tuning.layout.homeRoom` (how far every slot keeps from home, centre to centre),
 * `tuning.layout.slotRoom` (how far any two slots keep from each other) and
 * `tuning.layout.clusterAxisDeg`. Not on how big a body or its docking ring is: a design tweak of
 * those (dockMin, the home planet's radius) must never carry the galaxy off with it. The build
 * checks instead that the room is enough (`slotRoomProblems`): a system of the largest size it
 * accepts (`maxSystemRadius`) fits in every slot, `minSystemGap` clear of full-size neighbours and
 * of the home system as it really is. That is what lets a slot be placed without knowing what
 * will live in it, and so never move. Changing any of the three moves every system: a test pins
 * where they are (data/layout.test.ts), and Phase 3's galaxy.lock.json takes over from it.
 *
 * The slots pack round home like the cells of a honeycomb, as tight as that room allows. Tight
 * matters: every journey between systems is a stretch of this, and the star map frames all of
 * it. (A spiral that keeps going outwards puts its newest systems ever further from the rest:
 * with 4 systems its farthest pair was three times as far apart as this, with 8 two and a half.)
 *
 *   1      on the axis (`clusterAxisDeg`), homeRoom from home;
 *   2, 3   a triangle round home with it: the smallest three full-size systems round home can be;
 *   4 on   the free POCKET (a place touching two slots already there, as close as allowed)
 *          nearest to slot 1, which becomes the hub of the honeycomb. Of two equally near, the
 *          one that keeps the galaxy balanced on the axis; then the one at the larger angle.
 *
 * So the galaxy grows round the hub in mirror pairs, and with an even number of systems it is
 * symmetric about the axis: on the diagonal of the map, that frames as a square, which suits a
 * wide screen and a tall one alike. Farthest pair of centres today: 610 u with 2 systems, 1,057
 * with 4, 1,814 with 6, 1,965 with 8.
 *
 * Slot k is computed from slots 0 to k - 1 alone: adding systems never moves one already placed.
 */
export function slotPosition(order: number): [number, number] {
  if (!Number.isInteger(order) || order < 0) throw new RangeError(`no slot ${order}`);
  const limits = slotLimits();
  const key = `${limits.homeRoom}|${limits.pairRoom}|${limits.axisDeg}`;
  if (cache.key !== key || cache.slots.length <= order) {
    cache = { key, slots: honeycomb(Math.max(order + 1, cache.slots.length * 2, 8), limits) };
  }
  const slot = cache.slots[order] ?? [0, 0];
  return [slot[0], slot[1]];
}

export interface SlotLimits {
  /** How far every slot keeps from home (centre to centre), u. */
  readonly homeRoom: number;
  /** How far any two slots keep from each other, u. */
  readonly pairRoom: number;
  /** Which way slot 1 stands from home: degrees from +x toward +z. */
  readonly axisDeg: number;
}

/** The limits tuning.layout sets: its three slot keys, and nothing else (see slotPosition). */
export function slotLimits(): SlotLimits {
  return { homeRoom: L.homeRoom, pairRoom: L.slotRoom, axisDeg: L.clusterAxisDeg };
}

/**
 * Is there room in every slot for everything the build accepts? Each slot must fit a system of
 * `maxSystemRadius`, `minSystemGap` clear of a full-size neighbour and of the home system as it
 * really is (`homeReach`, which follows the home planet's size and the docking rings). The build
 * fails with these (data/build.ts) rather than let a slot move: making room moves the galaxy.
 */
export function slotRoomProblems(): string[] {
  const problems: string[] = [];
  const moving = 'Raising it moves every system (docs/PLAN.md §5.4, galaxy.lock.json).';
  const fromHome = homeReach() + L.maxSystemRadius + L.minSystemGap + SLOT_SLACK;
  if (L.homeRoom < fromHome) {
    problems.push(
      `tuning.layout.homeRoom is ${L.homeRoom} u, but the home system reaches ` +
        `${round(homeReach())} u and a system ${L.maxSystemRadius} u, ${L.minSystemGap} u clear ` +
        `of it: that needs ${round(fromHome)} u. ${moving}`,
    );
  }
  const apart = 2 * L.maxSystemRadius + L.minSystemGap + SLOT_SLACK;
  if (L.slotRoom < apart) {
    problems.push(
      `tuning.layout.slotRoom is ${L.slotRoom} u, but two systems of ${L.maxSystemRadius} u, ` +
        `${L.minSystemGap} u apart, need ${round(apart)} u. ${moving}`,
    );
  }
  return problems;
}

/** Slots already worked out, and the limits they were worked out for (the harness varies them). */
let cache: { key: string; slots: ReadonlyArray<readonly [number, number]> } = {
  key: '',
  slots: [],
};

/**
 * The first `count` slots of the honeycomb (slotPosition), home's included. Each is worked out
 * from the ones before it alone, so the first k of any longer list are these same k.
 */
export function honeycomb(count: number, limits: SlotLimits): Array<[number, number]> {
  const { homeRoom, pairRoom } = limits;
  const axis = limits.axisDeg * DEG;
  const room = (k: number): number => (k === 0 ? homeRoom : pairRoom);

  // Round home in a triangle: far enough from home, and from each other.
  const first = Math.max(homeRoom, pairRoom / Math.sqrt(3));
  const slots: Array<[number, number]> = [[0, 0]];
  for (const turn of [0, 1, -1]) {
    const angle = axis + (turn * TAU) / 3;
    slots.push([first * Math.cos(angle), first * Math.sin(angle)]);
  }

  const hub = slots[1] ?? [0, 0];
  const axisX = Math.cos(axis);
  const axisZ = Math.sin(axis);
  // Which side of the axis, and how far: > 0 at a larger angle (from +x toward +z) than the axis.
  const sideOf = (x: number, z: number): number => axisX * z - axisZ * x;
  const point = new Float64Array(4);
  while (slots.length < count) {
    let lean = 0;
    for (const [x, z] of slots) lean += sideOf(x, z);
    let best: [number, number] | null = null;
    let bestHub = Infinity;
    let bestLean = Infinity;
    let bestSide = -Infinity;
    for (let a = 0; a < slots.length; a += 1) {
      for (let b = a + 1; b < slots.length; b += 1) {
        const found = pockets(slots[a], room(a), slots[b], room(b), point);
        for (let p = 0; p < found; p += 1) {
          const x = point[p * 2] ?? 0;
          const z = point[p * 2 + 1] ?? 0;
          if (!isFree(x, z, slots, room)) continue;
          const toHub = Math.hypot(x - hub[0], z - hub[1]);
          const side = sideOf(x, z);
          const balance = Math.abs(lean + side);
          const better =
            toHub < bestHub - TIE ||
            (toHub <= bestHub + TIE &&
              (balance < bestLean - TIE || (balance <= bestLean + TIE && side > bestSide)));
          if (!better) continue;
          best = [x, z];
          bestHub = toHub;
          bestLean = balance;
          bestSide = side;
        }
      }
    }
    // Two circles round a finite set always meet somewhere outside all the others.
    if (best === null) throw new Error(`no pocket for slot ${slots.length}`);
    slots.push(best);
  }
  return slots.slice(0, count);
}

/** Where the circle of radius ra round a meets the circle of radius rb round b: 0 to 2 points. */
function pockets(
  a: readonly [number, number] | undefined,
  ra: number,
  b: readonly [number, number] | undefined,
  rb: number,
  out: Float64Array,
): number {
  if (!a || !b) return 0;
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (d < 1e-9 || d > ra + rb || d < Math.abs(ra - rb)) return 0;
  const along = (d * d + ra * ra - rb * rb) / (2 * d);
  const aside = Math.sqrt(Math.max(0, ra * ra - along * along));
  const ux = (b[0] - a[0]) / d;
  const uz = (b[1] - a[1]) / d;
  const mx = a[0] + ux * along;
  const mz = a[1] + uz * along;
  out[0] = mx - uz * aside;
  out[1] = mz + ux * aside;
  out[2] = mx + uz * aside;
  out[3] = mz - ux * aside;
  return 2;
}

/** Is (x, z) at least `room(k)` from every slot k? */
function isFree(
  x: number,
  z: number,
  slots: ReadonlyArray<readonly [number, number]>,
  room: (k: number) => number,
): boolean {
  for (const [k, slot] of slots.entries()) {
    if (Math.hypot(x - slot[0], z - slot[1]) < room(k) - 1e-6) return false;
  }
  return true;
}

export interface RingItem {
  /** How far this item reaches from its own centre: its docking orbit, or its outermost moon's. */
  footprint: number;
}

export interface Ring<T extends RingItem> {
  item: T;
  /** Orbit radius, measured from the centre the rings share. */
  radius: number;
}

/**
 * Packs items onto concentric rings, innermost first, so that no two footprints overlap and
 * nothing comes closer to the centre than `innerEdge`.
 */
export function stackRings<T extends RingItem>(
  items: readonly T[],
  innerEdge: number,
  gap: number,
  minFirstRadius = 0,
): Array<Ring<T>> {
  const rings: Array<Ring<T>> = [];
  let edge = innerEdge;
  for (const item of items) {
    const floor = rings.length === 0 ? minFirstRadius : 0;
    const radius = Math.max(edge + item.footprint, floor);
    rings.push({ item, radius });
    edge = radius + item.footprint + gap;
  }
  return rings;
}

/** How far a set of rings reaches: the outermost ring plus its footprint, or `fallback` if empty. */
export function reach(rings: ReadonlyArray<Ring<RingItem>>, fallback: number): number {
  const outermost = rings.at(-1);
  return outermost === undefined ? fallback : outermost.radius + outermost.item.footprint;
}
