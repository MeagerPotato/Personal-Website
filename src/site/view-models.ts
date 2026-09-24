import type { BiomeKey, ThemeKey } from '../universe/design/tokens';
import { routes } from './routes';

// Everything a page needs to know, worked out in plain functions, so that the .astro files stay
// markup-only ("thin Astro", docs/PLAN.md §5.1) and the logic is testable without a framework.

// --- dates ---------------------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function splitYearMonth(value: string): { year: string; month: string } {
  const [year = '', monthNumber = ''] = value.split('-');
  return { year, month: MONTHS[Number(monthNumber) - 1] ?? '' };
}

/** "2026-08" -> "Aug 2026". A lookup table, not Intl: the same text on every machine. */
export function formatYearMonth(value: string): string {
  const { year, month } = splitYearMonth(value);
  return `${month} ${year}`.trim();
}

/** "2025-06".."2025-08" -> "Jun – Aug 2025"; across years -> "Sep 2022 – May 2026". */
export function formatDateRange(start: string, end?: string): string {
  if (end === undefined || end === start) return formatYearMonth(start);
  if (end === 'present') return `${formatYearMonth(start)} – present`;
  const from = splitYearMonth(start);
  const to = splitYearMonth(end);
  return from.year === to.year
    ? `${from.month} – ${to.month} ${to.year}`
    : `${formatYearMonth(start)} – ${formatYearMonth(end)}`;
}

export const STATUS_LABEL = {
  shipped: 'Shipped',
  'in-progress': 'In progress',
  archived: 'Archived',
} as const;
export type ProjectStatus = keyof typeof STATUS_LABEL;

/** When a project happened. Work that is still going says so instead of showing a lone month. */
export function projectWhen(data: {
  date: string;
  dateEnd?: string;
  status: ProjectStatus;
}): string {
  const end = data.dateEnd ?? (data.status === 'in-progress' ? 'present' : undefined);
  return formatDateRange(data.date, end);
}

export interface ProjectLink {
  label: string;
  href: string;
  /** "fishai.allenkh.com": shown beside the label, so nobody has to hover to see where it goes. */
  host: string;
}

const LINK_LABEL = { demo: 'Live site', repo: 'Source', video: 'Video' } as const;

/** A project's outbound links, most useful first. */
export function projectLinks(links: {
  demo?: string;
  repo?: string;
  video?: string;
}): ProjectLink[] {
  return (['demo', 'repo', 'video'] as const).flatMap((key) => {
    const href = links[key];
    if (href === undefined) return [];
    return [{ label: LINK_LABEL[key], href, host: new URL(href).host.replace(/^www\./, '') }];
  });
}

/** "https://www.linkedin.com/in/x" -> "linkedin.com/in/x": a URL as people say it. */
export const displayUrl = (url: string): string =>
  url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

/** What each body of the home system is called (the `dock` field of a page). */
export const DOCK_LABEL = {
  home: 'Home planet',
  station: 'Resume station',
  satellite: 'Comms satellite',
} as const;

// --- the project tree --------------------------------------------------------------------------------

interface Ref {
  id: string;
}

export interface SystemLike {
  id: string;
  data: { name: string; tagline: string; theme: ThemeKey; order: number };
}

export interface ProjectLike {
  id: string;
  data: {
    title: string;
    summary: string;
    system?: Ref | undefined;
    parent?: Ref | undefined;
    date: string;
    status: ProjectStatus;
    planet: { biome: BiomeKey };
    flagship: boolean;
    related: readonly Ref[];
    draft: boolean;
  };
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The order of every list of projects: flagships first, then the newest work, then the id so that
 * a tie never depends on the file system. (Orbits are ordered differently, oldest innermost; a
 * page is read top-down, and the best work should be the first thing a visitor meets.)
 */
const byShowcase = (a: ProjectCard, b: ProjectCard): number =>
  Number(b.flagship) - Number(a.flagship) || compare(b.date, a.date) || compare(a.id, b.id);

export interface ProjectCard {
  id: string;
  href: string;
  title: string;
  summary: string;
  /** "2026-08": when the work started. Cards sort by it; they do not show it. */
  date: string;
  status: string;
  biome: BiomeKey;
  /**
   * The colour family the card wears: its system's, and for a moon its planet's system's. A list
   * can mix systems (the home page's "Start here", "Connected by motorway"), and every planet
   * keeps its own colour in it. Missing only for a project whose system is gone.
   */
  theme: ThemeKey | undefined;
  flagship: boolean;
  kind: 'planet' | 'moon';
}

/** The system a project belongs to: its own, or, for a moon, its planet's. */
export function projectTheme(
  project: ProjectLike,
  systems: readonly SystemLike[],
  projects: readonly ProjectLike[],
): ThemeKey | undefined {
  const parentId = project.data.parent?.id;
  const planet = parentId ? projects.find((entry) => entry.id === parentId) : project;
  const systemId = planet?.data.system?.id;
  return systems.find((system) => system.id === systemId)?.data.theme;
}

export const toCard = <P extends ProjectLike>(project: P, theme?: ThemeKey): ProjectCard => ({
  id: project.id,
  href: routes.project(project.id),
  title: project.data.title,
  summary: project.data.summary,
  date: project.data.date,
  status: STATUS_LABEL[project.data.status],
  biome: project.data.planet.biome,
  theme,
  flagship: project.data.flagship,
  kind: project.data.parent === undefined ? 'planet' : 'moon',
});

export interface PlanetNode extends ProjectCard {
  moons: ProjectCard[];
}

export interface SystemNode {
  id: string;
  href: string;
  name: string;
  tagline: string;
  theme: ThemeKey;
  planets: PlanetNode[];
}

/** Drafts are visible in dev and absent from production, exactly as in buildUniverse(). */
export const visibleProjects = <P extends ProjectLike>(
  projects: readonly P[],
  includeDrafts: boolean,
): P[] => projects.filter((project) => includeDrafts || !project.data.draft);

/** Systems in galaxy order, each with its planets, each planet with its moons. */
export function buildProjectTree(
  systems: readonly SystemLike[],
  projects: readonly ProjectLike[],
): SystemNode[] {
  const cards = projects.map((project) => ({
    project,
    card: toCard(project, projectTheme(project, systems, projects)),
  }));
  cards.sort((a, b) => byShowcase(a.card, b.card));
  return [...systems]
    .sort((a, b) => a.data.order - b.data.order)
    .map((system) => ({
      id: system.id,
      href: routes.system(system.id),
      name: system.data.name,
      tagline: system.data.tagline,
      theme: system.data.theme,
      planets: cards
        .filter(({ project }) => project.data.system?.id === system.id)
        .map((planet) => ({
          ...planet.card,
          moons: cards
            .filter(({ project }) => project.data.parent?.id === planet.project.id)
            .map(({ card }) => card),
        })),
    }));
}

/** Planets for the front page: the same showcase order, across the whole galaxy. */
export function featuredPlanets(tree: readonly SystemNode[], limit: number): PlanetNode[] {
  return tree
    .flatMap((system) => system.planets)
    .sort(byShowcase)
    .slice(0, limit);
}

export interface Crumb {
  label: string;
  href: string;
}

export interface ProjectContext {
  /** "Planet in the Code system" / "Moon of FishAI". */
  placement: string;
  crumbs: Crumb[];
  theme: ThemeKey | undefined;
  moons: ProjectCard[];
  related: ProjectCard[];
}

/** Where a project sits: its system, its parent if it is a moon, its moons, its related work. */
export function projectContext(
  project: ProjectLike,
  systems: readonly SystemLike[],
  projects: readonly ProjectLike[],
): ProjectContext {
  const byId = new Map(projects.map((entry) => [entry.id, entry]));
  const parent = project.data.parent ? byId.get(project.data.parent.id) : undefined;
  const systemId = (parent ?? project).data.system?.id;
  const system = systems.find((entry) => entry.id === systemId);

  const crumbs: Crumb[] = [{ label: 'Projects', href: routes.projects() }];
  if (system) crumbs.push({ label: system.data.name, href: routes.system(system.id) });
  if (parent) crumbs.push({ label: parent.data.title, href: routes.project(parent.id) });

  const placement = parent
    ? `Moon of ${parent.data.title}`
    : system
      ? `Planet in the ${system.data.name} system`
      : 'Project';

  return {
    placement,
    crumbs,
    theme: system?.data.theme,
    moons: projects
      .filter((entry) => entry.data.parent?.id === project.id)
      .map((moon) => toCard(moon, system?.data.theme))
      .sort(byShowcase),
    related: project.data.related.flatMap((reference) => {
      const target = byId.get(reference.id);
      return target ? [toCard(target, projectTheme(target, systems, projects))] : [];
    }),
  };
}
