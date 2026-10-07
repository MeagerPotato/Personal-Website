import { angleDelta, angleOf, clamp } from './math';

/**
 * THE FLIGHT DECK, as pure maths (ui/FlightDeck.ts draws it): KSP's cluster of instruments at the
 * bottom of the view. Everything here READS the simulation and turns it into what an instrument
 * shows: a bearing, a mark's place on the ball, a number of g, which lamp is lit. An instrument
 * never shows a number the simulation does not have, and nothing here decides how the ship flies.
 *
 * Two questions are answered here and nowhere else: WHETHER the deck shows (`deckShows`) and HOW
 * BIG it is (`deckLayout`). No media query decides either.
 *
 * Angles are the universe's (sim/types.ts): a heading is counter-clockwise seen from above, 0
 * along +Z. A BEARING is what a compass says: degrees, clockwise, 000 is north, which is +Z and
 * up on the star map.
 */

const HALF_PI = Math.PI / 2;
const DEG_PER_RAD = 180 / Math.PI;
const RAD_PER_DEG = Math.PI / 180;

// --- whether, and how big ------------------------------------------------------------------------

/** `full`: the whole cluster. `strip`: one pill in the Map button's row. `off`: no room for either. */
export type DeckLayout = 'full' | 'strip' | 'off';

export interface DeckRoomParams {
  /** The free view must be at least this big for the whole cluster: [width, height], in rem. */
  readonly fullMinRem: readonly [width: number, height: number];
  /** ...and at least this big for the strip. */
  readonly stripMinRem: readonly [width: number, height: number];
}

/**
 * How big the deck is, as a function of the FREE view alone: the viewport less what the info
 * panel covers, `freeW` by `freeH` CSS px. Under a bottom sheet (`sheet`) there is no deck: the
 * strip of sky left over is the docked body's, or the ship's. The limits are in rem (`remPx`, the
 * root font size), so a page zoomed to 200 % gets the strip where its cluster would not fit.
 */
export function deckLayout(
  freeW: number,
  freeH: number,
  sheet: boolean,
  remPx: number,
  params: DeckRoomParams,
): DeckLayout {
  if (sheet) return 'off';
  const rem = remPx > 0 ? remPx : 16;
  const width = freeW / rem;
  const height = freeH / rem;
  if (width >= params.fullMinRem[0] && height >= params.fullMinRem[1]) return 'full';
  if (width >= params.stripMinRem[0] && height >= params.stripMinRem[1]) return 'strip';
  return 'off';
}

/**
 * Does the deck show? While the ship is under way and the visitor is looking at the sky: not
 * docked (someone is reading a page) and not on the star map (where the flight controls are off).
 * A journey is under way too, whoever started it.
 */
export function deckShows(docked: boolean, mapOpen: boolean): boolean {
  return !docked && !mapOpen;
}

// --- the ball --------------------------------------------------------------------------------------

/** A heading as a compass bearing: degrees clockwise from north (+Z), in [0, 360). Never 360. */
export function bearingOf(heading: number): number {
  return (((-heading * DEG_PER_RAD) % 360) + 360) % 360;
}

/** The bearing as the heading chip says it: a whole number of degrees, 0 to 359. */
export function wholeBearing(heading: number): number {
  return Math.round(bearingOf(heading)) % 360;
}

/**
 * Where (toX, toZ) lies as seen from a ship at (x, z) with this heading: radians off the nose, in
 * (-PI, PI]. 0 is dead ahead, positive is to the pilot's LEFT (counter-clockwise, as everywhere).
 * A point the ship is on is dead ahead.
 */
export function relativeBearing(
  x: number,
  z: number,
  heading: number,
  toX: number,
  toZ: number,
): number {
  const dx = toX - x;
  const dz = toZ - z;
  if (dx === 0 && dz === 0) return 0;
  return angleDelta(heading, angleOf(dx, dz));
}

/** Is something at this relative bearing behind the ship (more than a quarter turn off the nose)? */
export function isBehind(relative: number): boolean {
  return Math.abs(relative) > HALF_PI;
}

/**
 * Where a mark at this relative bearing sits across the ball, as a share of its lane's half
 * width: 0 under the nose, negative to the left (a mark to the pilot's left is on the left of the
 * ball), and -1 or 1 for everything behind the ship: pinned at the rim on its side.
 */
export function markerShare(relative: number): number {
  // (A mark dead ahead is 0, not -0: what is written into the page is the number as it prints.)
  return -Math.sin(clamp(relative, -HALF_PI, HALF_PI)) + 0;
}

/**
 * How far round the compass a mark at `markDeg` is from the nose at `bearingDeg`: degrees in
 * [-180, 180), positive clockwise, which on the ball is to the RIGHT.
 */
export function offBearing(markDeg: number, bearingDeg: number): number {
  return ((((markDeg - bearingDeg + 180) % 360) + 360) % 360) - 180;
}

/** The ball has a meridian every 30 degrees of the compass: twelve, north first, clockwise. */
export const MERIDIANS = 12;

/**
 * THE BALL'S MERIDIANS for a nose at `bearingDeg`, on a globe of `radius`, into `out` as twelve
 * pairs [rx, side]. The globe is seen from the pilot's seat, so the half of it ahead is in view:
 * a meridian within a quarter turn of the nose is the half of an ellipse from pole to pole, `rx`
 * wide, bulging to the left (side -1) or the right (side +1); the one dead ahead is a straight
 * line (rx 0, side +1). `side` 0: behind the ship, not drawn. As the ship turns each one slides
 * across and meets the rim exactly where it goes out of view, so nothing pops.
 */
export function meridians(bearingDeg: number, radius: number, out: Float64Array): Float64Array {
  for (let k = 0; k < MERIDIANS; k += 1) {
    const off = offBearing(k * 30, bearingDeg);
    const shown = Math.abs(off) < 90;
    out[k * 2] = shown ? radius * Math.abs(Math.sin(off * RAD_PER_DEG)) : 0;
    out[k * 2 + 1] = !shown ? 0 : off < 0 ? -1 : 1;
  }
  return out;
}

// --- the gauges and the lamps ----------------------------------------------------------------------

export interface GParams {
  /** u/s² that read as one g. A unit is about a metre, so the Earth's 9.81. */
  readonly gUnit: number;
  /** The arc is full at this many g; past it the peg lights. */
  readonly gFull: number;
}

/**
 * The g the ship pulled over one step: how much its velocity changed (`dvx`, `dvz`, u/s) in `dt`
 * seconds, in g, from 0 up to `gFull`. It is clamped, never skipped: a journey handed back at
 * 700 u/s sheds its speed at some 300 g (sim/surroundings.ts, dropOutOfWarp), and that is where
 * the gauge should peg, not freeze.
 */
export function gOf(dvx: number, dvz: number, dt: number, params: GParams): number {
  if (!(dt > 0) || !(params.gUnit > 0)) return 0;
  const g = Math.hypot(dvx, dvz) / dt / params.gUnit;
  return Number.isFinite(g) ? clamp(g, 0, params.gFull) : params.gFull;
}

/**
 * How many chevrons the speed wears: one for each of `tiers` (u/s, rising) it has reached. The
 * pilot's own drive never reaches the first, so a chevron says "the autopilot has it".
 */
export function warpTier(speed: number, tiers: readonly number[]): number {
  let tier = 0;
  for (const from of tiers) if (speed >= from) tier += 1;
  return tier;
}

/** What the visitor is doing, as state/appMachine.ts names it (`AppMode`). */
export type DeckMode = 'flight' | 'autopilot' | 'approach' | 'docked';

export interface Lamps {
  /** The ship flies itself: a journey, an approach, or the brake that Stop holds. */
  auto: boolean;
  /** The pilot flies, and something helps: the orbit assist, or the reflex after a hand-back. */
  assist: boolean;
}

/**
 * WHICH LAMP IS LIT. AUTO while something else has the controls: the autopilot (a journey), the
 * ring's own pilot (an approach), or Stop's brake (`halting`). ASSIST while the pilot flies and
 * is helped: the orbit assist does more than `assistOn` of the flying (`assistWeight`, 0 to 1), or
 * the reflex still guards a ship taken back at speed (`guarding`). Never both, and none in orbit.
 */
export function lampsOf(
  mode: DeckMode,
  halting: boolean,
  guarding: boolean,
  assistWeight: number,
  assistOn: number,
  out: Lamps = { auto: false, assist: false },
): Lamps {
  out.auto = mode === 'autopilot' || mode === 'approach' || (mode === 'flight' && halting);
  out.assist = !out.auto && mode === 'flight' && (guarding || assistWeight > assistOn);
  return out;
}

/**
 * The seconds a journey still takes, as shown: whole, and never more than was shown before
 * (`previous`; Infinity when the journey starts). The autopilot plans again twice a second, and a
 * plan may find the way a little longer than the last one did: a countdown that counted up would
 * read as a fault.
 */
export function etaShown(previous: number, etaSec: number): number {
  if (!Number.isFinite(etaSec)) return previous;
  return Math.min(previous, Math.ceil(Math.max(0, etaSec)));
}

/**
 * A distance as the scope's chip says it, its figures and its unit: two figures, in metres under
 * a kilometre ("470", "m") and in kilometres to a tenth from there ("1.1", "km"). A unit is a
 * metre, as for the speed.
 */
export function rangeShown(units: number): [figures: string, unit: string] {
  return units < 995 ? [`${Number(units.toPrecision(2))}`, 'm'] : [(units / 1000).toFixed(1), 'km'];
}

// --- whereabouts -----------------------------------------------------------------------------------

/** As much of a system as "which one is the ship in" needs (the manifest's systems fit). */
export interface MiniSystem {
  /** Centre on the flight plane: [x, z]. */
  readonly position: readonly [number, number];
  /** Reach of its outermost docking orbit. */
  readonly radius: number;
}

export interface ScopeParams {
  /** The ship is IN a system once it is within this many of its radii from its centre... */
  readonly enterRadii: number;
  /** ...and stays in it until it is this many out: no flicker at the edge. */
  readonly leaveRadii: number;
}

/**
 * WHICH SYSTEM THE SHIP IS IN: its index in `systems`, or -1 between systems. `previous` is the
 * last answer (-1 at first): a system is entered at `enterRadii` of its radius and only left at
 * `leaveRadii`. Inside two at once (no galaxy we build has that), the one it was in already,
 * else the one whose centre is nearest, counted in its own radii.
 */
export function systemAt(
  previous: number,
  x: number,
  z: number,
  systems: readonly MiniSystem[],
  params: ScopeParams,
): number {
  const radii = (system: MiniSystem): number =>
    system.radius > 0
      ? Math.hypot(x - system.position[0], z - system.position[1]) / system.radius
      : Infinity;
  const kept = systems[previous];
  if (kept && radii(kept) <= params.leaveRadii) return previous;
  let best = -1;
  let bestRadii = params.enterRadii;
  for (let i = 0; i < systems.length; i += 1) {
    const system = systems[i];
    if (!system) continue;
    const out = radii(system);
    if (out <= bestRadii) {
      best = i;
      bestRadii = out;
    }
  }
  return best;
}

// --- every knob ------------------------------------------------------------------------------------

/** Everything the deck is tuned by (design/tuning.ts, `instruments`). */
export interface InstrumentParams extends DeckRoomParams, ScopeParams, GParams {
  /** u/s. Slower than this the ship is going nowhere, and the prograde mark is put away. */
  readonly progradeMinSpeed: number;
  /** 1/s: how quickly the g arc follows the g. */
  readonly gOmega: number;
  /** 1/s: how quickly the throttle arc follows the throttle (the flame's own rate). */
  readonly throttleOmega: number;
  /** The orbit assist counts as helping once it does more than this share of the flying. */
  readonly assistOn: number;
  /** u/s, rising: the speeds from which the speed wears one, two, three chevrons. */
  readonly warpTiers: readonly number[];
  /** The digits change at most this often a second... */
  readonly digitsHz: number;
  /** ...and this often for a visitor who asked for less motion. */
  readonly digitsHzReduced: number;
}
