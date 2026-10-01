import type { BiomeKey, ThemeKey } from '../design/tokens';

// INPUT: what the content layer hands over. Plain data, no framework types, so buildUniverse()
// runs in Vitest exactly as it runs in the build (docs/PLAN.md §5.4).

export type PlanetSize = 's' | 'm' | 'l';
export type DockKind = 'home' | 'station' | 'satellite';

/**
 * One of three shapes, told apart by which keys are set (buildUniverse checks the combination):
 * a SYSTEM with one sun (`order`, `theme`: its sun is itself), a BINARY STAR (`order`, `theme`,
 * `suns`: two suns circling one centre, and no sun of its own), or a SUN OF A BINARY (no
 * `order`: it goes where its binary goes, and wears its own `theme` if it has one, else its
 * binary's). Planets name a sun, never a binary.
 */
export interface SystemInput {
  id: string;
  name: string;
  /** Its sun's page. A binary has no sun of its own: its page is the projects index. */
  href: string;
  /**
   * The colour family of a system, or of a binary; a sun of a binary may wear one of its own,
   * and without one wears its binary's.
   */
  theme?: ThemeKey | undefined;
  /**
   * Slot in the galaxy's honeycomb, 1 upwards (slot 0 is the home system). Explicit, so it is
   * stable. A sun of a binary has none.
   */
  order?: number | undefined;
  /** A binary star: its two suns, PRIMARY FIRST (the projects index is shown from the first). */
  suns?: readonly string[] | undefined;
  /** Where its slot is: 'auto' (the honeycomb) or hand-placed. Only a system or a binary has one. */
  position: 'auto' | readonly [number, number];
}

export interface ProjectInput {
  id: string;
  title: string;
  href: string;
  /** Exactly one of `system` (a planet) or `parent` (a moon of that project). */
  system?: string | undefined;
  parent?: string | undefined;
  /** "YYYY-MM". Older projects orbit closer in; planned work without a date, outermost. */
  date?: string | undefined;
  /** Work that is planned, not built. Only planned work may leave out its date. */
  planned?: boolean | undefined;
  size: PlanetSize;
  biome: BiomeKey;
  rings: boolean;
  decorMoons: number;
  seed?: string | undefined;
  flagship: boolean;
  related: readonly string[];
  draft: boolean;
}

export interface PageInput {
  id: string;
  title: string;
  href: string;
  dock: DockKind;
}

/**
 * A profile on another site (src/site/profiles.ts): a relay on the Contact satellite's ring, at
 * `slot` steps of 45 degrees ahead of the satellite. Its `href` is the profile itself, never a
 * page of this site, so the ship can never dock at it.
 */
export interface LinkInput {
  /** The network: "github". Its body is "link/github". */
  id: string;
  title: string;
  href: string;
  /** 1 to 7; 0 is the satellite. Never renumbered: it is where the relay is. */
  slot: number;
}

export interface UniverseInput {
  systems: readonly SystemInput[];
  projects: readonly ProjectInput[];
  pages: readonly PageInput[];
  /** Allen's profiles elsewhere, as relays round the home planet. None when left out. */
  links?: readonly LinkInput[] | undefined;
  /**
   * The page that lists every project. It is nobody's own page, so it is shown from the sun of
   * the first system (for a binary, its primary sun): that is where the projects are. (From
   * Phase 3, with more systems, the map.)
   */
  projectsHref?: string | undefined;
  /** true in dev, false in production builds. */
  includeDrafts: boolean;
}

// OUTPUT: /universe.json. Everything the engine needs to place, draw and label the galaxy, and
// nothing it does not (no prose: that lives in the HTML pages).

/** `link`: a profile on another site, circling home as a relay; it is only ever in the way. */
export type BodyKind = 'sun' | 'planet' | 'moon' | DockKind | 'link';

export interface Orbit {
  /** Distance from the parent's centre, in world units. */
  radius: number;
  /** Angle at t = 0, radians, counter-clockwise seen from above. */
  phase: number;
  periodSec: number;
}

export interface ManifestBody {
  /** Unique across the galaxy: "system/code", "project/fishai", "page/about". */
  id: string;
  kind: BodyKind;
  title: string;
  /**
   * The page this body docks to. The router maps URL -> body through this. For a `link`, the
   * other site it stands for: never routed, never docked at.
   */
  href: string;
  /** Id of the ManifestSystem it belongs to. */
  system: string;
  /** Body it orbits, or null when it sits at the centre of its system. */
  parent: string | null;
  radius: number;
  /**
   * How far its solid reaches in the plane the ship flies in, when that is past `radius`: an
   * emblem world's signs, rings and fins (design/worlds/reach.ts, `radius x reach`). The collision
   * field's surface (sim/surroundings.ts); the docking ring stays `dockRadius`. Absent: `radius`.
   */
  solidRadius?: number;
  /** Radius of the docking orbit around it. Computed once here so layout and engine agree. */
  dockRadius: number;
  orbit: Orbit | null;
  /** Seeds the procedural look, so a planet is the same planet on every visit. */
  seed: string;
  biome?: BiomeKey;
  rings?: boolean;
  decorMoons?: number;
  flagship?: boolean;
  /** Planned work, not built yet: drawn and labelled as such. Absent for everything else. */
  planned?: true;
  /**
   * A sun of a binary that wears a colour family of its own (Hardware's coral beside Software's
   * sky): its planets and moons wear it too (manifest.ts, `familiesOf`). Absent: its system's.
   */
  theme?: ThemeKey;
  /**
   * Only ever `false`, for a body the ship can never dock at (a link): no orbit is offered round
   * it, and nothing flies there. It is still solid, so it is only in the way. Absent for every
   * body that can be docked at.
   */
  docks?: false;
}

export interface ManifestSystem {
  id: string;
  name: string;
  theme: ThemeKey;
  /** Centre on the flight plane: [x, z]. */
  position: readonly [number, number];
  /** Reach of its outermost docking orbit: nothing of this system lies further out. */
  radius: number;
  /**
   * Id of the body at the centre (a sun, or the home planet). A binary star's centre is empty:
   * this is its primary sun, which circles `position` like the other.
   */
  center: string;
}

/** A motorway between two related projects. Undirected: a < b, and each pair appears once. */
export interface ManifestLane {
  a: string;
  b: string;
}

export interface UniverseManifest {
  /** 2 since links (bodies the ship must never dock at): an engine that reads 1 would dock at one. */
  version: 2;
  systems: ManifestSystem[];
  bodies: ManifestBody[];
  lanes: ManifestLane[];
  /**
   * Pages that are not a body's own page but are SHOWN FROM one: path -> body id. A body's own
   * `href` needs no entry. Absent in manifests from before it existed.
   */
  alsoAt?: Record<string, string>;
}
