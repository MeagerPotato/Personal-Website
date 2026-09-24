import type { ManifestBody, ManifestSystem, UniverseManifest } from './data/types';

export type { ManifestBody, ManifestSystem, UniverseManifest } from './data/types';

/**
 * The galaxy as the engine receives it: /universe.json, built at build time by data/build.ts and
 * fetched by the web layer. It is our own output, so this does not re-validate every field; it
 * guards against the two things that really happen. A visitor whose tab has been open across a
 * deploy can get a NEWER manifest than their engine understands (version skew), and a captive
 * portal or an error page can answer with something that is not the manifest at all. Either way
 * the engine refuses to start and the shell falls back to plain mode, where the content already is.
 */
export function readManifest(data: unknown): UniverseManifest {
  const manifest = data as Partial<UniverseManifest> | null;
  if (typeof manifest !== 'object' || manifest === null) {
    throw new Error('universe manifest: not an object');
  }
  if (manifest.version !== 1) {
    throw new Error(`universe manifest: version ${String(manifest.version)}, this engine reads 1`);
  }
  if (!Array.isArray(manifest.systems) || !Array.isArray(manifest.bodies)) {
    throw new Error('universe manifest: systems or bodies missing');
  }
  if (manifest.systems.length === 0 || manifest.bodies.length === 0) {
    throw new Error('universe manifest: empty');
  }
  return manifest as UniverseManifest;
}

/** The system a visitor starts in: the one whose centre is the home planet. */
export function homeSystemOf(manifest: UniverseManifest): ManifestSystem {
  const homeBody = manifest.bodies.find((body) => body.kind === 'home');
  const home = manifest.systems.find((system) => system.id === homeBody?.system);
  const first = manifest.systems[0];
  if (!home && !first) throw new Error('universe manifest: no systems');
  return (home ?? first) as ManifestSystem;
}

/** u. Neighbours closer than this to equally near are a tie. */
const NEIGHBOUR_TIE = 1;

/**
 * The other system whose centre is closest to `system`, or null when it is alone. Of neighbours
 * about equally near (the first three slots stand round home at the same distance: data/layout.ts)
 * the one listed first, which is the one with the lowest `order`: whatever the rounding of their
 * positions, and however many systems are added later, it stays the same one.
 */
export function nearestNeighbourOf(
  manifest: UniverseManifest,
  system: ManifestSystem,
): ManifestSystem | null {
  let nearest: ManifestSystem | null = null;
  let best = Infinity;
  for (const other of manifest.systems) {
    if (other.id === system.id) continue;
    const distance = Math.hypot(
      other.position[0] - system.position[0],
      other.position[1] - system.position[1],
    );
    if (distance < best - NEIGHBOUR_TIE) {
      best = distance;
      nearest = other;
    }
  }
  return nearest;
}

export function centerBodyOf(manifest: UniverseManifest, system: ManifestSystem): ManifestBody {
  const center = manifest.bodies.find((body) => body.id === system.center);
  if (!center) throw new Error(`universe manifest: system '${system.id}' has no centre body`);
  return center;
}
