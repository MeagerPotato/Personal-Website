import type { BiomeKey, ThemeKey } from '../universe/design/tokens';
import type {
  DockKind,
  PageInput,
  PlanetSize,
  ProjectInput,
  SystemInput,
  UniverseInput,
} from '../universe/data/types';
import { routes } from './routes';

// Content entries -> the plain input of buildUniverse(). Structural types only: this file knows
// the SHAPE a validated entry has, not the framework that loaded it.

interface Entry<Data> {
  id: string;
  data: Data;
}

/** What reference() resolves to. */
interface Ref {
  id: string;
}

/** A solar system, a binary star (it lists `suns`), or a sun of a binary (no order, no suns). */
export type SystemEntry = Entry<{
  name: string;
  theme?: ThemeKey | undefined;
  order?: number | undefined;
  position?: 'auto' | [number, number] | undefined;
  suns?: readonly Ref[] | undefined;
}>;

export type ProjectEntry = Entry<{
  title: string;
  system?: Ref | undefined;
  parent?: Ref | undefined;
  date?: string | undefined;
  status: 'shipped' | 'completed' | 'in-progress' | 'archived' | 'planned';
  planet: {
    size: PlanetSize;
    biome: BiomeKey;
    rings: boolean;
    decorMoons: number;
    seed?: string | undefined;
  };
  flagship: boolean;
  related: readonly Ref[];
  draft: boolean;
}>;

export type PageEntry = Entry<{ title: string; dock: DockKind }>;

/** A binary star has no page of its own: the projects index is its page (it shows both suns). */
export const toSystemInput = ({ id, data }: SystemEntry): SystemInput => ({
  id,
  name: data.name,
  href: data.suns === undefined ? routes.system(id) : routes.projects(),
  theme: data.theme,
  order: data.order,
  ...(data.suns === undefined ? {} : { suns: data.suns.map((sun) => sun.id) }),
  position: data.position ?? 'auto',
});

export const toProjectInput = ({ id, data }: ProjectEntry): ProjectInput => ({
  id,
  title: data.title,
  href: routes.project(id),
  system: data.system?.id,
  parent: data.parent?.id,
  date: data.date,
  planned: data.status === 'planned',
  size: data.planet.size,
  biome: data.planet.biome,
  rings: data.planet.rings,
  decorMoons: data.planet.decorMoons,
  seed: data.planet.seed,
  flagship: data.flagship,
  related: data.related.map((reference) => reference.id),
  draft: data.draft,
});

export const toPageInput = ({ id, data }: PageEntry): PageInput => ({
  id,
  title: data.title,
  href: routes.page(id),
  dock: data.dock,
});

export function toUniverseInput(content: {
  systems: readonly SystemEntry[];
  projects: readonly ProjectEntry[];
  pages: readonly PageEntry[];
  includeDrafts: boolean;
}): UniverseInput {
  return {
    systems: content.systems.map(toSystemInput),
    projects: content.projects.map(toProjectInput),
    pages: content.pages.map(toPageInput),
    projectsHref: routes.projects(),
    includeDrafts: content.includeDrafts,
  };
}
