import type { BiomeKey, ThemeKey } from '../design/tokens';

// INPUT: what the content layer hands over. Plain data, no framework types, so buildUniverse()
// runs in Vitest exactly as it runs in the build (docs/PLAN.md §5.4).

export type PlanetSize = 's' | 'm' | 'l';
export type DockKind = 'home' | 'station' | 'satellite';

export interface SystemInput {
  id: string;
  name: string;
  href: string;
  theme: ThemeKey;
  /** Slot in the galaxy's honeycomb, 1 upwards (slot 0 is the home system). Explicit, so it is stable. */
  order: number;
  position: 'auto' | readonly [number, number];
}

export interface ProjectInput {
  id: string;
  title: string;
  href: string;
  /** Exactly one of `system` (a planet) or `parent` (a moon of that project). */
  system?: string | undefined;
  parent?: string | undefined;
  /** "YYYY-MM". Older projects orbit closer in. */
  date: string;
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

export interface UniverseInput {
  systems: readonly SystemInput[];
  projects: readonly ProjectInput[];
  pages: readonly PageInput[];
  /**
   * The page that lists every project. It is nobody's own page, so it is shown from the sun of
   * the first system: that is where the projects are. (From Phase 3, with more systems, the map.)
   */
  projectsHref?: string | undefined;
  /** true in dev, false in production builds. */
  includeDrafts: boolean;
}

// OUTPUT: /universe.json. Everything the engine needs to place, draw and label the galaxy, and
// nothing it does not (no prose: that lives in the HTML pages).

export type BodyKind = 'sun' | 'planet' | 'moon' | DockKind;

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
  /** The page this body docks to. The router maps URL -> body through this. */
  href: string;
  /** Id of the ManifestSystem it belongs to. */
  system: string;
  /** Body it orbits, or null when it sits at the centre of its system. */
  parent: string | null;
  radius: number;
  /** Radius of the docking orbit around it. Computed once here so layout and engine agree. */
  dockRadius: number;
  orbit: Orbit | null;
  /** Seeds the procedural look, so a planet is the same planet on every visit. */
  seed: string;
  biome?: BiomeKey;
  rings?: boolean;
  decorMoons?: number;
  flagship?: boolean;
}

export interface ManifestSystem {
  id: string;
  name: string;
  theme: ThemeKey;
  /** Centre on the flight plane: [x, z]. */
  position: readonly [number, number];
  /** Reach of its outermost docking orbit: nothing of this system lies further out. */
  radius: number;
  /** Id of the body at the centre (a sun, or the home planet). */
  center: string;
}

/** A motorway between two related projects. Undirected: a < b, and each pair appears once. */
export interface ManifestLane {
  a: string;
  b: string;
}

export interface UniverseManifest {
  version: 1;
  systems: ManifestSystem[];
  bodies: ManifestBody[];
  lanes: ManifestLane[];
  /**
   * Pages that are not a body's own page but are SHOWN FROM one: path -> body id. A body's own
   * `href` needs no entry. Absent in manifests from before it existed.
   */
  alsoAt?: Record<string, string>;
}
