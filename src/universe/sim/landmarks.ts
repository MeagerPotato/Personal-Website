/**
 * LANDMARKS. Every card of a page's deck (src/shell/cards.ts) points at something on the body its
 * page belongs to: a LANDMARK, a place in the body's own frame given as a latitude and a
 * longitude, like a part stood on a world (sim/world/placement.ts, `dirOf`: +Y is north,
 * longitude 0 is the body's +Z and 90 its +X). Opening the card turns the camera to it
 * (camera/OrbitCam.ts, `face`) and ends the card's leader on it.
 *
 * A landmark is COORDINATES, never a reference to a part: the parts a visitor sees up close are a
 * chunk of their own (design/worlds/closeup.ts), and pointing at one must not pull that chunk in.
 * `part` only names the part it was read off, so that a test can hold the two together.
 *
 * Which card points where is the design's (design/worlds/landmarks.ts). A card nobody gave a
 * landmark gets one all the same, on a ring round the body: so every card has somewhere to point,
 * and an authored one only makes it mean something.
 */
export interface Landmark {
  /** Degrees north of the body's equator. */
  readonly lat: number;
  /** Degrees round the body's axis: 0 is its +Z, 90 its +X. */
  readonly lon: number;
  /** How far above the surface, in the body's radii. None: on it. */
  readonly alt?: number;
  /** It stands on something that does not turn with the body (About Me's Circle Line). */
  readonly hold?: boolean;
  /** The part of the body's rows it was read off (tests/landmarks.test.ts compares the two). */
  readonly part?: string;
}

/** A body's landmarks, by card: the id of the card's heading (`rockets` for /about/#rockets). */
export type Landmarks = Readonly<Partial<Record<string, Landmark>>>;

/** Every body's, by its id in /universe.json. */
export type LandmarkTable = Readonly<Partial<Record<string, Landmarks>>>;

/** Where the cards with no landmark of their own point (design/tuning.ts, `deck`). */
export interface DefaultRingParams {
  readonly defaultLatDeg: number;
  /** Where the first card's is; the others follow evenly, all the way round. */
  readonly defaultLonDeg: number;
}

/** The engine's side of a page's deck of cards (design/tuning.ts, `deck`). */
export interface DeckParams extends DefaultRingParams {
  /** The station a card's leader ends in: its radius, CSS px. */
  readonly stopRadiusPx: number;
}

/** The landmark of card `index` of `count` (from 0) when nobody gave it one. */
export function defaultLandmark(index: number, count: number, ring: DefaultRingParams): Landmark {
  return { lat: ring.defaultLatDeg, lon: ring.defaultLonDeg + (360 * index) / Math.max(1, count) };
}

/** Where card `key` of `body` points: its own landmark, or its place on the ring. */
export function landmarkOf(
  table: LandmarkTable,
  body: string,
  key: string,
  index: number,
  count: number,
  ring: DefaultRingParams,
): Landmark {
  return table[body]?.[key] ?? defaultLandmark(index, count, ring);
}

/**
 * A landmark in its body's own frame, the body's radius being `unit`: the same direction as
 * `dirOf` gives a part stood at that latitude and longitude, out to its height.
 */
export function landmarkPoint<T extends { x: number; y: number; z: number }>(
  mark: Landmark,
  unit: number,
  out: T,
): T {
  const lat = (mark.lat * Math.PI) / 180;
  const lon = (mark.lon * Math.PI) / 180;
  const reach = unit * (1 + (mark.alt ?? 0));
  out.x = reach * Math.cos(lat) * Math.sin(lon);
  out.y = reach * Math.sin(lat);
  out.z = reach * Math.cos(lat) * Math.cos(lon);
  return out;
}

/**
 * The point of a disc's edge nearest to `from`: where a straight line from a card to a body's
 * middle meets the body's limb on screen. Lines drawn to it from all round never cross. (From the
 * very middle there is no nearest point: the edge straight to the right, then.)
 */
export function limbPoint<T extends { x: number; y: number }>(
  centreX: number,
  centreY: number,
  radius: number,
  fromX: number,
  fromY: number,
  out: T,
): T {
  const dx = fromX - centreX;
  const dy = fromY - centreY;
  const far = Math.hypot(dx, dy);
  const k = far > 1e-9 ? radius / far : 0;
  out.x = far > 1e-9 ? centreX + dx * k : centreX + radius;
  out.y = centreY + dy * k;
  return out;
}
