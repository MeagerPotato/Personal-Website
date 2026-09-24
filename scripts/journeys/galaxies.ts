import { readdirSync, readFileSync } from 'node:fs';
import { parseFrontmatter } from '@astrojs/internal-helpers/frontmatter';
import { z } from 'astro/zod';
import { entryIdFromPath } from '../../src/site/routes';
import { pageSchema, projectSchema, systemSchema } from '../../src/site/schemas';
import {
  toUniverseInput,
  type PageEntry,
  type ProjectEntry,
  type SystemEntry,
} from '../../src/site/universe-input';
import { buildUniverse } from '../../src/universe/data/build';
import { slotPosition } from '../../src/universe/data/layout';
import type {
  PlanetSize,
  ProjectInput,
  SystemInput,
  UniverseInput,
  UniverseManifest,
} from '../../src/universe/data/types';
import type { ThemeKey } from '../../src/universe/design/tokens';
import { tuning } from '../../src/universe/design/tuning';
import { createRng } from '../../src/universe/sim/rng';
import { mergeInto, type DeepPartial } from './merge';

// THE GALAXIES a journey is measured in: the real one, read from src/content exactly as the build
// reads it (Astro's own frontmatter reader, the real schemas, the real toUniverseInput and
// buildUniverse), and bigger ones made of the real one plus typical systems of the future, laid
// out by the real layout code in the free slots 2, 3, 4...
//
// Nothing here edits source. Layout changes are applied to tuning.layout IN PLACE for the length
// of one build (data/layout.ts and data/build.ts read that object) and put back afterwards; a
// different slot formula is handed to buildUniverse as explicit positions, its own escape hatch.

export type Layout = (typeof tuning)['layout'];
export type Slot = [x: number, z: number];

/** Where slot `order` of system `id` is. `real` is the real one (data/layout.ts, slotPosition). */
export type SlotFormula = (order: number, id: string, real: (order: number) => Slot) => Slot;

export interface LayoutOverrides {
  /** Merged into tuning.layout for the build: clusterAxisDeg, maxSystemRadius, minSystemGap... */
  layout?: DeepPartial<Layout>;
  /**
   * The OLD sunflower spiral instead of the honeycomb, with any power of the order: slot k sits
   * 1000 u * k^slotExponent out (0.5 is exactly the spiral this site used), k golden angles
   * round, nudged by up to 100 u seeded by the id (OLD_SPIRAL).
   */
  slotExponent?: number;
  /** Any formula at all (from code, not JSON). Wins over slotExponent. */
  slot?: SlotFormula;
  /** Hand-placed systems by id, as content can do with `position: [x, z]`. Wins over both. */
  positions?: Record<string, Slot>;
}

// --- the real galaxy -----------------------------------------------------------------------------

const CONTENT = new URL('../../src/content/', import.meta.url);

/** image() and reference() as the build resolves them, minus the files: a path, and `{ id }`. */
const helpers = {
  image: () => z.string(),
  reference: () => z.string().transform((id) => ({ id })),
};

function readEntries<T>(folder: string, pattern: 'file' | 'folder', parse: (data: unknown) => T) {
  const base = new URL(`${folder}/`, CONTENT);
  const entries: Array<{ id: string; data: T }> = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const path =
      pattern === 'file'
        ? entry.isFile() && entry.name.endsWith('.md')
          ? entry.name
          : null
        : entry.isDirectory()
          ? `${entry.name}/index.md`
          : null;
    if (path === null) continue;
    let source: string;
    try {
      source = readFileSync(new URL(path, base), 'utf8');
    } catch {
      continue; // A folder without an index.md is not an entry (glob '*/index.md').
    }
    const { frontmatter } = parseFrontmatter(source);
    try {
      entries.push({ id: entryIdFromPath(path), data: parse(frontmatter) });
    } catch (error) {
      throw new Error(`src/content/${folder}/${path}: ${String(error)}`, { cause: error });
    }
  }
  return entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The content the build reads, as the plain input of buildUniverse(). Production drafts rule by default. */
export function readRealInput(includeDrafts = false): UniverseInput {
  const systems: SystemEntry[] = readEntries('systems', 'file', (data) =>
    systemSchema().parse(data),
  );
  const projects: ProjectEntry[] = readEntries('projects', 'folder', (data) =>
    projectSchema(helpers).parse(data),
  );
  const pages: PageEntry[] = readEntries('pages', 'file', (data) => pageSchema().parse(data));
  return toUniverseInput({ systems, projects, pages, includeDrafts });
}

// --- typical systems of the future ---------------------------------------------------------------

interface SyntheticPlanet {
  id: string;
  size: PlanetSize;
  date: string;
  moons?: ReadonlyArray<{ id: string; size: PlanetSize }>;
}

interface SyntheticSystem {
  id: string;
  name: string;
  theme: ThemeKey;
  planets: readonly SyntheticPlanet[];
}

/**
 * Filled into the free slots in this order. Rocketry and Berkeley are the two systems Phase 3
 * plans (docs/PLAN.md); the rest are placeholders. Every one is typical: 3 to 5 planets of mixed
 * sizes and a moon or two. Their ids seed their jitter, as a real system's would.
 */
export const SYNTHETIC: readonly SyntheticSystem[] = [
  {
    id: 'rocketry',
    name: 'Model Rocketry',
    theme: 'coral',
    planets: [
      { id: 'arc-team', size: 'm', date: '2023-05' },
      {
        id: 'staged-recovery',
        size: 'l',
        date: '2024-07',
        moons: [{ id: 'payload', size: 'm' }],
      },
      { id: 'l1-cert', size: 's', date: '2025-02' },
      { id: 'avionics', size: 'm', date: '2025-09' },
    ],
  },
  {
    id: 'berkeley',
    name: 'Berkeley',
    theme: 'butter',
    planets: [
      { id: 'coursework', size: 's', date: '2026-08' },
      {
        id: 'club',
        size: 'm',
        date: '2026-09',
        moons: [
          { id: 'club-site', size: 's' },
          { id: 'club-launch', size: 's' },
        ],
      },
      { id: 'research', size: 'l', date: '2026-10' },
      { id: 'hackathon', size: 's', date: '2026-11' },
      { id: 'lab', size: 'm', date: '2027-01' },
    ],
  },
  {
    id: 'robotics',
    name: 'Robotics',
    theme: 'mint',
    planets: [
      { id: 'rover', size: 'm', date: '2024-03', moons: [{ id: 'rover-arm', size: 's' }] },
      { id: 'drone', size: 'l', date: '2025-04' },
      { id: 'line-follower', size: 's', date: '2025-11' },
    ],
  },
  {
    id: 'writing',
    name: 'Writing',
    theme: 'lilac',
    planets: [
      { id: 'essays', size: 's', date: '2024-01' },
      { id: 'papers', size: 'm', date: '2025-03' },
      {
        id: 'newsletter',
        size: 'm',
        date: '2025-08',
        moons: [
          { id: 'newsletter-archive', size: 's' },
          { id: 'newsletter-guests', size: 's' },
        ],
      },
      { id: 'book', size: 'l', date: '2026-02' },
    ],
  },
  {
    id: 'games',
    name: 'Games',
    theme: 'sky',
    planets: [
      { id: 'jam-entry', size: 'm', date: '2024-10' },
      { id: 'puzzle', size: 's', date: '2025-06' },
      { id: 'engine', size: 'l', date: '2026-01', moons: [{ id: 'engine-editor', size: 'm' }] },
    ],
  },
  {
    id: 'music',
    name: 'Music',
    theme: 'coral',
    planets: [
      { id: 'band', size: 'm', date: '2023-09' },
      { id: 'synth', size: 'm', date: '2024-05', moons: [{ id: 'synth-patches', size: 's' }] },
      { id: 'covers', size: 's', date: '2024-12' },
      { id: 'recital', size: 's', date: '2025-05' },
      { id: 'score', size: 'm', date: '2026-04' },
    ],
  },
];

const project = (id: string, over: Partial<ProjectInput>): ProjectInput => ({
  id,
  title: id,
  href: `/projects/${id}/`,
  date: '2026-01',
  size: 'm',
  biome: 'terra',
  rings: false,
  decorMoons: 0,
  flagship: false,
  related: [],
  draft: false,
  ...over,
});

/**
 * The real content plus synthetic systems until there are `systemCount` systems, home included.
 * Each takes the lowest order no real system claims, so this keeps working as Allen adds systems.
 */
export function grow(real: UniverseInput, systemCount: number): UniverseInput {
  const taken = new Set(real.systems.map((system) => system.order));
  const ids = new Set([...real.systems, ...real.projects].map((entry) => entry.id));
  const systems: SystemInput[] = [...real.systems];
  const projects: ProjectInput[] = [...real.projects];
  let order = 1;
  for (const extra of SYNTHETIC) {
    if (systems.length + 1 >= systemCount) break;
    if (ids.has(extra.id)) continue;
    while (taken.has(order)) order += 1;
    taken.add(order);
    systems.push({
      id: extra.id,
      name: extra.name,
      href: `/systems/${extra.id}/`,
      theme: extra.theme,
      order,
      position: 'auto',
    });
    for (const planet of extra.planets) {
      const id = `${extra.id}-${planet.id}`;
      projects.push(project(id, { system: extra.id, size: planet.size, date: planet.date }));
      for (const moon of planet.moons ?? []) {
        projects.push(
          project(`${extra.id}-${moon.id}`, { parent: id, size: moon.size, date: planet.date }),
        );
      }
    }
  }
  if (systems.length + 1 < systemCount) {
    throw new Error(`only ${systems.length + 1} systems can be made; add more to SYNTHETIC`);
  }
  return { ...real, systems, projects };
}

// --- building, with the layout overridden ----------------------------------------------------------

/** Run `build` with `layout` merged into tuning.layout, and put tuning.layout back afterwards. */
export function withLayout<T>(layout: DeepPartial<Layout> | undefined, build: () => T): T {
  if (layout === undefined) return build();
  const live = tuning.layout as unknown as Record<string, unknown>;
  const saved = structuredClone(live);
  try {
    mergeInto(live, layout as Record<string, unknown>, 'layout.');
    return build();
  } finally {
    mergeInto(live, saved, 'layout.');
  }
}

/**
 * The sunflower spiral the galaxy was laid out on until the honeycomb (data/layout.ts) replaced
 * it, kept here to compare against: slot k sat 1000 u * k^0.5 out, k golden angles round, nudged
 * by up to 100 u seeded by the system's id.
 */
export const OLD_SPIRAL = { slotDistance: 1000, goldenAngleDeg: 137.5, slotJitter: 100 } as const;

/** The old spiral (OLD_SPIRAL) with any power of the order: 0.5 is the spiral exactly. */
export function spiralWithExponent(exponent: number): SlotFormula {
  return (order, id) => {
    if (order === 0) return [0, 0];
    const { slotDistance, goldenAngleDeg, slotJitter } = OLD_SPIRAL;
    const distance = slotDistance * order ** exponent;
    const angle = (order * goldenAngleDeg * Math.PI) / 180;
    const rng = createRng(`slot:${id}`);
    const jitterDistance = slotJitter * Math.sqrt(rng());
    const jitterAngle = rng() * Math.PI * 2;
    return [
      distance * Math.cos(angle) + jitterDistance * Math.cos(jitterAngle),
      distance * Math.sin(angle) + jitterDistance * Math.sin(jitterAngle),
    ];
  };
}

/** buildUniverse over `input`, with every layout override applied. Throws what the build throws. */
export function buildGalaxy(
  input: UniverseInput,
  overrides: LayoutOverrides = {},
): UniverseManifest {
  for (const id of Object.keys(overrides.positions ?? {})) {
    if (!input.systems.some((system) => system.id === id)) {
      throw new Error(`positions: no system "${id}" (home always sits at [0, 0])`);
    }
  }
  return withLayout(overrides.layout, () => {
    const formula =
      overrides.slot ??
      (overrides.slotExponent === undefined ? null : spiralWithExponent(overrides.slotExponent));
    const systems = input.systems.map((system): SystemInput => {
      const placed = overrides.positions?.[system.id];
      if (placed) return { ...system, position: placed };
      if (formula === null || system.position !== 'auto') return system;
      return { ...system, position: formula(system.order, system.id, slotPosition) };
    });
    return buildUniverse({ ...input, systems });
  });
}
