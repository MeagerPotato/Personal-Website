import type { ManifestBody, ManifestSystem, UniverseManifest } from './data/types';
import type { ThemeKey } from './design/tokens';
import { hashSeed } from './sim/rng';

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
  // Only its own version. 2 brought bodies that must never be docked at (a link), which an engine
  // that reads 1 would dock at: across that deploy each refuses the other, and the page stays plain.
  if (manifest.version !== 2) {
    throw new Error(`universe manifest: version ${String(manifest.version)}, this engine reads 2`);
  }
  if (!Array.isArray(manifest.systems) || !Array.isArray(manifest.bodies)) {
    throw new Error('universe manifest: systems or bodies missing');
  }
  if (manifest.systems.length === 0 || manifest.bodies.length === 0) {
    throw new Error('universe manifest: empty');
  }
  return manifest as UniverseManifest;
}

const byId = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * A FINGERPRINT OF WHERE THINGS ARE, which the engine stamps on every snapshot it writes
 * (core/snapshot.ts). A tab can outlive a deploy that moved the galaxy: a new system, more room
 * between them, a planet added to a family, which moves its outer rings (docs/PLAN.md §5.4). A
 * snapshot from before would put the ship where it was in the OLD galaxy, which here may be
 * inside a planet, and dock it on a ring that has gone elsewhere; with this, it is not believed.
 *
 * Only what decides where a body is and how big it is goes in: every system's centre and reach,
 * every body's place in the tree, size, solid, docking ring and orbit, in order of id (the order a list
 * is written in moves nothing). Titles, hrefs and looks stay out, so a copy edit, a new biome or
 * a renamed page never costs a returning visitor their place. A new field that moves or sizes a
 * body belongs here too. 32 bits (sim/rng.ts's string hash), as eight hex digits: it only has to
 * tell one deploy's galaxy from another's.
 */
export function galaxyKey(manifest: UniverseManifest): string {
  const lines: string[] = [];
  for (const { id, position, radius } of [...manifest.systems].sort(byId)) {
    lines.push(`system ${id} ${position[0]} ${position[1]} ${radius}`);
  }
  for (const body of [...manifest.bodies].sort(byId)) {
    const { orbit } = body;
    const around = orbit === null ? '-' : `${orbit.radius} ${orbit.phase} ${orbit.periodSec}`;
    // Its solid, only when it has one of its own: a key from before the field stays the same.
    const solid = body.solidRadius === undefined ? '' : ` solid ${body.solidRadius}`;
    lines.push(
      `body ${body.id} ${body.system} ${body.parent ?? '-'} ${body.radius} ${body.dockRadius} ${around}${solid}`,
    );
  }
  return hashSeed(lines.join('\n')).toString(16).padStart(8, '0');
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

/**
 * The colour FAMILY every body wears, by id: that of the first sun up its chain of parents that
 * wears one of its own (a sun of a binary may: Hardware's coral beside Software's sky), else its
 * system's. What the galaxy draws in it: the glow of a planet's ring and the lines of the orbits
 * (world/Galaxy.ts); its name tag's glyph (ui/Labels.ts). The pages say the same with
 * src/site/view-models.ts, `familyOf`. A body of a system the manifest does not list has none.
 */
export function familiesOf(manifest: UniverseManifest): ReadonlyMap<string, ThemeKey> {
  const themes = new Map(manifest.systems.map((system) => [system.id, system.theme]));
  const byId = new Map(manifest.bodies.map((body) => [body.id, body]));
  const families = new Map<string, ThemeKey>();
  for (const body of manifest.bodies) {
    let theme = themes.get(body.system);
    if (theme === undefined) continue;
    for (let at: ManifestBody | undefined = body; at; at = byId.get(at.parent ?? '')) {
      if (at.kind === 'sun' && at.theme !== undefined) {
        theme = at.theme;
        break;
      }
    }
    families.set(body.id, theme);
  }
  return families;
}

export function centerBodyOf(manifest: UniverseManifest, system: ManifestSystem): ManifestBody {
  const center = manifest.bodies.find((body) => body.id === system.center);
  if (!center) throw new Error(`universe manifest: system '${system.id}' has no centre body`);
  return center;
}
