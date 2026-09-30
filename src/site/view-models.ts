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
  completed: 'Completed',
  'in-progress': 'In progress',
  archived: 'Archived',
  planned: 'Planned',
} as const;
export type ProjectStatus = keyof typeof STATUS_LABEL;

/**
 * When a project happened. Work that is still going says so instead of showing a lone month.
 * Undefined for planned work without a date: there is nothing to say yet.
 */
export function projectWhen(data: {
  date?: string | undefined;
  dateEnd?: string | undefined;
  status: ProjectStatus;
}): string | undefined {
  if (data.date === undefined) return undefined;
  const end = data.dateEnd ?? (data.status === 'in-progress' ? 'present' : undefined);
  return formatDateRange(data.date, end);
}

export interface Fact {
  label: string;
  value: string;
}

/** The facts under a project's heading, leaving out the ones planned work does not have yet. */
export function projectFacts(data: {
  date?: string | undefined;
  dateEnd?: string | undefined;
  status: ProjectStatus;
  role?: string | undefined;
}): Fact[] {
  const when = projectWhen(data);
  return [
    { label: 'Status', value: STATUS_LABEL[data.status] },
    ...(when === undefined ? [] : [{ label: 'When', value: when }]),
    ...(data.role === undefined ? [] : [{ label: 'Role', value: data.role }]),
  ];
}

export interface ProjectLink {
  label: string;
  href: string;
  /** "fishai.allenkh.com": shown beside the label, so nobody has to hover to see where it goes. */
  host: string;
}

const LINK_LABEL = { demo: 'Live site', repo: 'Source', video: 'Video' } as const;

/** "https://www.example.com/x" -> "example.com": where a link goes, as people say it. */
const hostOf = (href: string): string => new URL(href).host.replace(/^www\./, '');

/** A project's outbound links, most useful first. */
export function projectLinks(links: {
  demo?: string;
  repo?: string;
  video?: string;
}): ProjectLink[] {
  return (['demo', 'repo', 'video'] as const).flatMap((key) => {
    const href = links[key];
    if (href === undefined) return [];
    return [{ label: LINK_LABEL[key], href, host: hostOf(href) }];
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

/**
 * An entry of the systems collection, in one of its three shapes (src/site/schemas.ts): a solar
 * system (`order`, `theme`: its sun is itself), a binary star (`order`, `theme`, `suns`), or a
 * sun of a binary (no `order`: its binary gives it a place, and a colour family unless it wears
 * one of its own).
 */
export interface SystemLike {
  id: string;
  data: {
    name: string;
    tagline?: string | undefined;
    theme?: ThemeKey | undefined;
    order?: number | undefined;
    suns?: readonly Ref[] | undefined;
    link?: string | undefined;
  };
}

export interface ProjectLike {
  id: string;
  data: {
    title: string;
    summary: string;
    system?: Ref | undefined;
    parent?: Ref | undefined;
    date?: string | undefined;
    status: ProjectStatus;
    /** Only whether there is one matters here: a card with a picture is a better first look. */
    cover?: unknown;
    planet: { biome: BiomeKey };
    flagship: boolean;
    related: readonly Ref[];
    draft: boolean;
  };
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The order of every list of projects: built work before planned work, flagships first, then the
 * newest work, then the id so that a tie never depends on the file system. (Orbits are ordered
 * differently, oldest innermost; a page is read top-down, and the best work should be the first
 * thing a visitor meets.)
 */
const byShowcase = (a: ProjectCard, b: ProjectCard): number =>
  Number(a.planned) - Number(b.planned) ||
  Number(b.flagship) - Number(a.flagship) ||
  compare(b.date, a.date) ||
  compare(a.id, b.id);

export interface ProjectCard {
  id: string;
  href: string;
  title: string;
  summary: string;
  /** "2026-08": when the work started ("" for planned work without a date). Cards sort by it; they do not show it. */
  date: string;
  status: string;
  /** Planned, not built: listed after built work, never featured. */
  planned: boolean;
  /** Has a cover picture: featured before work without one. */
  pictured: boolean;
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

/** The binary star that lists `sunId` among its two suns, if one does. */
const binaryOf = (sunId: string, systems: readonly SystemLike[]): SystemLike | undefined =>
  systems.find((system) => system.data.suns?.some((sun) => sun.id === sunId));

/**
 * The colour family a sun wears: its own (a solar system's, or a sun of a binary that has one),
 * or else its binary's. The galaxy says the same with universe/manifest.ts, `familiesOf`.
 */
const familyOf = (sun: SystemLike, systems: readonly SystemLike[]): ThemeKey | undefined =>
  sun.data.theme ?? binaryOf(sun.id, systems)?.data.theme;

/**
 * The colour family of a project: its sun's, or, for a moon, its planet's sun's (a sun of a
 * binary wears its own, or else its binary's).
 */
export function projectTheme(
  project: ProjectLike,
  systems: readonly SystemLike[],
  projects: readonly ProjectLike[],
): ThemeKey | undefined {
  const parentId = project.data.parent?.id;
  const planet = parentId ? projects.find((entry) => entry.id === parentId) : project;
  const systemId = planet?.data.system?.id;
  const sun = systems.find((system) => system.id === systemId);
  return sun && familyOf(sun, systems);
}

export const toCard = <P extends ProjectLike>(project: P, theme?: ThemeKey): ProjectCard => ({
  id: project.id,
  href: routes.project(project.id),
  title: project.data.title,
  summary: project.data.summary,
  date: project.data.date ?? '',
  status: STATUS_LABEL[project.data.status],
  planned: project.data.status === 'planned',
  pictured: project.data.cover !== undefined,
  biome: project.data.planet.biome,
  theme,
  flagship: project.data.flagship,
  kind: project.data.parent === undefined ? 'planet' : 'moon',
});

/**
 * Does a list of cards name more than one colour family? Then its route line is drawn neutral
 * (src/components/ProjectCards.astro), and only the stations wear a family: on a transit map a
 * station takes its line's colour, and a line in one family through stations of another reads
 * as two lines crossing.
 */
export const mixesSystems = (cards: ReadonlyArray<Pick<ProjectCard, 'theme'>>): boolean =>
  new Set(cards.map((card) => card.theme)).size > 1;

/**
 * The one colour family every card in a list shares, if there is one. The list wears it, so its
 * route line takes its stations' colour on any page (the home page's family is butter; a list of
 * Software's planets there is still a sky line). None for an empty list, a mix, or cards with no
 * family.
 */
export const sharedTheme = (
  cards: ReadonlyArray<Pick<ProjectCard, 'theme'>>,
): ThemeKey | undefined => {
  const themes = new Set(cards.map((card) => card.theme));
  return themes.size === 1 ? [...themes][0] : undefined;
};

export interface PlanetNode extends ProjectCard {
  moons: ProjectCard[];
}

export interface Crumb {
  label: string;
  href: string;
}

/** A sun of a binary star: the binary, and the other sun, which it circles the centre opposite. */
export interface Twin {
  binary: Crumb;
  other: Crumb;
}

/** A sun and its planets: what the projects index lists as one section, and a sun's page shows. */
export interface SunNode {
  id: string;
  href: string;
  name: string;
  tagline: string;
  /**
   * Its system's colour family (for a sun of a binary, the binary's). Missing only in content the
   * build refuses.
   */
  theme: ThemeKey | undefined;
  planets: PlanetNode[];
  /** Set for a sun of a binary star. */
  twin: Twin | undefined;
}

/** A place in the galaxy: a solar system (its sun is itself), or a binary star (primary first). */
export interface SystemNode {
  id: string;
  name: string;
  theme: ThemeKey | undefined;
  suns: SunNode[];
}

/** Drafts are visible in dev and absent from production, exactly as in buildUniverse(). */
export const visibleProjects = <P extends ProjectLike>(
  projects: readonly P[],
  includeDrafts: boolean,
): P[] => projects.filter((project) => includeDrafts || !project.data.draft);

interface Carded {
  project: ProjectLike;
  card: ProjectCard;
}

/** Every project as a card, in showcase order: the order of every list the tree makes. */
function cardsOf(systems: readonly SystemLike[], projects: readonly ProjectLike[]): Carded[] {
  return projects
    .map((project) => ({
      project,
      card: toCard(project, projectTheme(project, systems, projects)),
    }))
    .sort((a, b) => byShowcase(a.card, b.card));
}

/** A sun with its planets, each planet with its moons; and, for a sun of a binary, its twin. */
function sunNode(
  sun: SystemLike,
  systems: readonly SystemLike[],
  cards: readonly Carded[],
): SunNode {
  const binary = binaryOf(sun.id, systems);
  const otherId = binary?.data.suns?.find((entry) => entry.id !== sun.id)?.id;
  const other = systems.find((entry) => entry.id === otherId);
  return {
    id: sun.id,
    href: routes.system(sun.id),
    name: sun.data.name,
    tagline: sun.data.tagline ?? '',
    theme: familyOf(sun, systems),
    planets: cards
      .filter(({ project }) => project.data.system?.id === sun.id)
      .map((planet) => ({
        ...planet.card,
        moons: cards
          .filter(({ project }) => project.data.parent?.id === planet.project.id)
          .map(({ card }) => card),
      })),
    twin:
      binary && other
        ? {
            binary: { label: binary.data.name, href: routes.projects() },
            other: { label: other.data.name, href: routes.system(other.id) },
          }
        : undefined,
  };
}

/**
 * Systems in galaxy order, each with its sun or suns (a binary's primary first), each sun with
 * its planets, each planet with its moons. One exception to the galaxy's order: a system with no
 * built work yet (every planet planned) goes last, so a visitor's first screen is finished work.
 */
export function buildProjectTree(
  systems: readonly SystemLike[],
  projects: readonly ProjectLike[],
): SystemNode[] {
  const cards = cardsOf(systems, projects);
  const byId = new Map(systems.map((system) => [system.id, system]));
  const built = (node: SystemNode): boolean =>
    node.suns.some((sun) => sun.planets.some((planet) => !planet.planned));
  return systems
    .flatMap((system) => {
      // A sun of a binary has no order of its own: it is listed under its binary.
      const order = system.data.order;
      if (order === undefined) return [];
      const suns = system.data.suns?.map((sun) => byId.get(sun.id)) ?? [system];
      const node: SystemNode = {
        id: system.id,
        name: system.data.name,
        theme: system.data.theme,
        suns: suns.flatMap((sun) => (sun ? [sunNode(sun, systems, cards)] : [])),
      };
      return [{ order, node }];
    })
    .sort((a, b) => Number(built(b.node)) - Number(built(a.node)) || a.order - b.order)
    .map(({ node }) => node);
}

/** The entries that have a page of their own, /systems/<id>/: every sun. A binary has none. */
export const sunPages = <S extends SystemLike>(systems: readonly S[]): S[] =>
  systems.filter((system) => system.data.suns === undefined);

/** What a sun's page shows, above and beside its planets. */
export interface SunPage extends SunNode {
  /** The route sign over the name: "Solar system", or "Sun of Projects". */
  eyebrow: string;
  /** For the tab and search results: "Research system" (one sun), or "Software projects". */
  title: string;
  crumbs: Crumb[];
  /** Where the system's work lives when that is a site of its own (the Blog): the first button. */
  link: ProjectLink | undefined;
}

/** A sun's page: a solar system's, or one of the two suns of a binary star. */
export function systemView(
  entry: SystemLike,
  systems: readonly SystemLike[],
  projects: readonly ProjectLike[],
): SunPage {
  const sun = sunNode(entry, systems, cardsOf(systems, projects));
  const binary = binaryOf(entry.id, systems);
  const link = entry.data.link;
  return {
    ...sun,
    eyebrow: binary ? `Sun of ${binary.data.name}` : 'Solar system',
    // "Software projects" says in a tab or a search result what "Software" alone does not.
    title: binary ? `${sun.name} ${binary.data.name.toLowerCase()}` : `${sun.name} system`,
    crumbs: [{ label: 'Projects', href: routes.projects() }],
    link:
      link === undefined ? undefined : { label: 'Visit the site', href: link, host: hostOf(link) },
  };
}

/**
 * "Start here" on the front page: finished work, across the whole galaxy. Flagships first, planet
 * or moon, then planets with a picture, then (only while the list is still short) planets without
 * one; never planned work. Each group in showcase order. A moon that has a card of its own here is
 * not listed again among its planet's moons.
 */
export function featured(
  tree: readonly SystemNode[],
  limit: number,
): Array<PlanetNode | ProjectCard> {
  const planets = tree
    .flatMap((system) => system.suns.flatMap((sun) => sun.planets))
    .filter((planet) => !planet.planned);
  const moons = planets.flatMap((planet) => planet.moons).filter((moon) => !moon.planned);
  const others = planets.filter((planet) => !planet.flagship);
  const chosen = [
    ...[...planets, ...moons].filter((card) => card.flagship).sort(byShowcase),
    ...others.filter((planet) => planet.pictured).sort(byShowcase),
    ...others.filter((planet) => !planet.pictured).sort(byShowcase),
  ].slice(0, limit);
  const shown = new Set(chosen.map((card) => card.id));
  return chosen.map((card) =>
    isPlanet(card) ? { ...card, moons: card.moons.filter((moon) => !shown.has(moon.id)) } : card,
  );
}

/** A planet's card (it lists its moons), as opposed to a moon's. */
export const isPlanet = (card: ProjectCard): card is PlanetNode => 'moons' in card;

export interface ProjectContext {
  /**
   * "Planet of Hardware" (a sun of a binary), "Planet in the Research system" (one sun), or
   * "Moon of Canadian Fish".
   */
  placement: string;
  crumbs: Crumb[];
  theme: ThemeKey | undefined;
  moons: ProjectCard[];
  related: ProjectCard[];
}

/**
 * Where a project sits: its sun, its parent if it is a moon, its moons, its related work. The
 * crumbs name the sun, never a binary: a binary's page is the projects index, the first crumb.
 */
export function projectContext(
  project: ProjectLike,
  systems: readonly SystemLike[],
  projects: readonly ProjectLike[],
): ProjectContext {
  const byId = new Map(projects.map((entry) => [entry.id, entry]));
  const parent = project.data.parent ? byId.get(project.data.parent.id) : undefined;
  const sunId = (parent ?? project).data.system?.id;
  const sun = systems.find((entry) => entry.id === sunId);
  const theme = sun && familyOf(sun, systems);

  const crumbs: Crumb[] = [{ label: 'Projects', href: routes.projects() }];
  if (sun) crumbs.push({ label: sun.data.name, href: routes.system(sun.id) });
  if (parent) crumbs.push({ label: parent.data.title, href: routes.project(parent.id) });

  const placement = parent
    ? `Moon of ${parent.data.title}`
    : !sun
      ? 'Project'
      : binaryOf(sun.id, systems)
        ? `Planet of ${sun.data.name}`
        : `Planet in the ${sun.data.name} system`;

  return {
    placement,
    crumbs,
    theme,
    moons: projects
      .filter((entry) => entry.data.parent?.id === project.id)
      .map((moon) => toCard(moon, theme))
      .sort(byShowcase),
    related: project.data.related.flatMap((reference) => {
      const target = byId.get(reference.id);
      return target ? [toCard(target, projectTheme(target, systems, projects))] : [];
    }),
  };
}
