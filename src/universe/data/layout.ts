import { tuning } from '../design/tuning';
import { createRng } from '../sim/rng';

// Where everything sits, decided at BUILD time and baked into /universe.json. Pure functions of
// their arguments and of tuning.layout: same input, same galaxy, on every machine.
//
// Stability rule (docs/PLAN.md §5.4): anything random is seeded by the body's OWN id, never by
// its index in a list. Systems keep their place for ever (their slot is the explicit `order`), and
// adding a newer project or a new system moves nothing. The one thing that can shift is a ring's
// radius: a back-dated project, or a new moon, widens the rings from that planet outwards. Angles
// never change. Phase 3's galaxy.lock.json pins even that.

const L = tuning.layout;
const TAU = Math.PI * 2;

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

/**
 * Centre of a system on the flight plane. Slot 0 is the origin (home). Slot k sits on a sunflower
 * spiral, which keeps neighbours evenly spaced however many systems are added, then moves by a
 * small seeded jitter so the pattern never reads as mechanical.
 */
export function slotPosition(order: number, systemId: string): [number, number] {
  if (order === 0) return [0, 0];

  const distance = L.slotDistance * Math.sqrt(order);
  const angle = (order * L.goldenAngleDeg * Math.PI) / 180;

  const rng = createRng(`slot:${systemId}`);
  const jitterDistance = L.slotJitter * Math.sqrt(rng()); // sqrt: uniform over the disc
  const jitterAngle = rng() * TAU;

  return [
    distance * Math.cos(angle) + jitterDistance * Math.cos(jitterAngle),
    distance * Math.sin(angle) + jitterDistance * Math.sin(jitterAngle),
  ];
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
