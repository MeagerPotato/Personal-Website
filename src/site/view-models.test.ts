import { describe, expect, it } from 'vitest';
import {
  buildProjectTree,
  displayUrl,
  featured,
  isPlanet,
  formatDateRange,
  mixesSystems,
  sharedTheme,
  formatYearMonth,
  projectContext,
  projectFacts,
  projectLinks,
  projectTheme,
  projectWhen,
  sunPages,
  systemView,
  toCard,
  visibleProjects,
  type PlanetNode,
  type ProjectLike,
  type SunNode,
  type SystemLike,
  type SystemNode,
} from './view-models';

const system = (
  id: string,
  order: number,
  theme: SystemLike['data']['theme'] = 'sky',
): SystemLike => ({
  id,
  data: { name: id.toUpperCase(), tagline: `About ${id}`, theme, order },
});

const project = (id: string, data: Partial<ProjectLike['data']> = {}): ProjectLike => ({
  id,
  data: {
    title: id.toUpperCase(),
    summary: `Summary of ${id}`,
    date: '2026-01',
    status: 'shipped',
    planet: { biome: 'terra' },
    flagship: false,
    related: [],
    draft: false,
    ...data,
  },
});

const SYSTEMS = [system('robots', 2, 'coral'), system('code', 1)];
const PROJECTS = [
  project('newer', { system: { id: 'code' }, date: '2026-08' }),
  project('older', { system: { id: 'code' }, date: '2025-03', flagship: true }),
  project('moon-b', { parent: { id: 'older' }, date: '2026-02', planet: { biome: 'dune' } }),
  project('moon-a', { parent: { id: 'older' }, date: '2026-02' }),
  project('rover', { system: { id: 'robots' }, date: '2024-05', related: [{ id: 'newer' }] }),
];

/** Every planet of a system, sun by sun. */
const planetsOf = (node: SystemNode | undefined): PlanetNode[] =>
  node?.suns.flatMap((sun) => sun.planets) ?? [];

const COVER = { src: 'cover.png', alt: 'A picture' };

// Allen's tree: Projects, a binary star whose suns are Software (primary) and Hardware; Research,
// whose only work is planned; and Hackathons. Listed out of order on purpose.
const TREE: SystemLike[] = [
  { id: 'research', data: { name: 'Research', tagline: 'Questions.', theme: 'lilac', order: 2 } },
  { id: 'hardware', data: { name: 'Hardware', tagline: 'Rockets and robots.' } },
  {
    id: 'projects',
    data: {
      name: 'Projects',
      theme: 'sky',
      order: 1,
      suns: [{ id: 'software' }, { id: 'hardware' }],
    },
  },
  { id: 'hackathons', data: { name: 'Hackathons', tagline: 'Clocks.', theme: 'coral', order: 3 } },
  { id: 'software', data: { name: 'Software', tagline: 'Software I wrote.' } },
];
const TREE_PROJECTS = [
  project('cyberpatriot', { system: { id: 'software' }, date: '2022-09' }),
  project('canadian-fish', { system: { id: 'software' }, date: '2026-08', cover: COVER }),
  project('fishai', { parent: { id: 'canadian-fish' }, flagship: true, cover: COVER }),
  project('fish-online', { parent: { id: 'canadian-fish' }, status: 'planned', date: undefined }),
  project('days2meet', { system: { id: 'software' }, date: '2026-08', cover: COVER }),
  project('robotics', { system: { id: 'hardware' }, date: '2023-07' }),
  project('model-rocketry', { system: { id: 'hardware' }, date: '2023-07' }),
  project('sports', { system: { id: 'research' }, status: 'planned', date: undefined }),
  project('kalshi', { parent: { id: 'sports' }, status: 'planned', date: undefined }),
  project('hackgt', { system: { id: 'hackathons' }, date: '2026-09' }),
];
const entryOf = (id: string): SystemLike => TREE.find((entry) => entry.id === id) as SystemLike;
const projectOf = (id: string): ProjectLike =>
  TREE_PROJECTS.find((entry) => entry.id === id) as ProjectLike;

describe('dates', () => {
  it('formats a year-month without Intl, so every machine agrees', () => {
    expect(formatYearMonth('2026-08')).toBe('Aug 2026');
    expect(formatYearMonth('2025-12')).toBe('Dec 2025');
  });

  it('collapses a range inside one year and spells out one across years', () => {
    expect(formatDateRange('2025-06', '2025-08')).toBe('Jun – Aug 2025');
    expect(formatDateRange('2022-09', '2026-05')).toBe('Sep 2022 – May 2026');
    expect(formatDateRange('2026-08')).toBe('Aug 2026');
    expect(formatDateRange('2026-08', '2026-08')).toBe('Aug 2026');
  });

  it('says "present" for work that is still going, and only for that', () => {
    expect(projectWhen({ date: '2026-08', status: 'in-progress' })).toBe('Aug 2026 – present');
    expect(projectWhen({ date: '2026-08', status: 'shipped' })).toBe('Aug 2026');
    expect(projectWhen({ status: 'planned' })).toBeUndefined();
    expect(projectWhen({ date: '2026-11', status: 'planned' })).toBe('Nov 2026');
    expect(projectWhen({ date: '2026-08', dateEnd: '2026-09', status: 'in-progress' })).toBe(
      'Aug – Sep 2026',
    );
  });
});

describe('projectFacts', () => {
  it('lists status, when and role for built work', () => {
    expect(
      projectFacts({ date: '2026-08', status: 'shipped', role: 'Solo' }).map((f) => f.label),
    ).toEqual(['Status', 'When', 'Role']);
  });

  it('leaves out what planned work does not have yet', () => {
    expect(projectFacts({ status: 'planned' })).toEqual([{ label: 'Status', value: 'Planned' }]);
  });

  it('calls finished work that was never a product "Completed", with the years it ran', () => {
    expect(
      projectFacts({
        date: '2022-09',
        dateEnd: '2026-05',
        status: 'completed',
        role: 'Windows specialist, then team captain and instructor',
      }).slice(0, 2),
    ).toEqual([
      { label: 'Status', value: 'Completed' },
      { label: 'When', value: 'Sep 2022 – May 2026' },
    ]);
  });
});

describe('links', () => {
  it('orders a project’s links by usefulness and shows where each one goes', () => {
    expect(
      projectLinks({
        repo: 'https://github.com/MeagerPotato/FishAI',
        demo: 'https://www.example.com/play',
      }),
    ).toEqual([
      { label: 'Live site', href: 'https://www.example.com/play', host: 'example.com' },
      { label: 'Source', href: 'https://github.com/MeagerPotato/FishAI', host: 'github.com' },
    ]);
    expect(projectLinks({})).toEqual([]);
  });

  it('writes a URL the way people say it', () => {
    expect(displayUrl('https://www.linkedin.com/in/someone/')).toBe('linkedin.com/in/someone');
    expect(displayUrl('https://allenkh.com')).toBe('allenkh.com');
  });
});

describe('buildProjectTree', () => {
  const tree = buildProjectTree(SYSTEMS, PROJECTS);

  it('orders systems by their galaxy slot, not by file order', () => {
    expect(tree.map((node) => node.id)).toEqual(['code', 'robots']);
    expect(tree[0]).toMatchObject({ name: 'CODE', theme: 'sky' });
    // A solar system has one sun, itself.
    expect(tree[0]?.suns.map((sun) => [sun.id, sun.href, sun.name, sun.theme])).toEqual([
      ['code', '/systems/code/', 'CODE', 'sky'],
    ]);
  });

  it('orders planets flagship first, then newest first, and hangs moons on their planet', () => {
    const [code] = tree.map(planetsOf);
    expect(code?.map((planet) => planet.id)).toEqual(['older', 'newer']);
    const unflagged = PROJECTS.map((entry) => ({
      ...entry,
      data: { ...entry.data, flagship: false },
    }));
    const [plain] = buildProjectTree(SYSTEMS, unflagged).map(planetsOf);
    expect(plain?.map((planet) => planet.id)).toEqual(['newer', 'older']);
    // Same month: the id breaks the tie, so the order never depends on the file system.
    expect(code?.[0]?.moons.map((moon) => moon.id)).toEqual(['moon-a', 'moon-b']);
    expect(code?.[1]?.moons).toEqual([]);
  });

  it('never lists a moon as a planet', () => {
    const planetIds = tree.flatMap(planetsOf).map((planet) => planet.id);
    expect(planetIds).not.toContain('moon-a');
  });

  it('turns a project into a card', () => {
    expect(toCard(PROJECTS[2] as ProjectLike, 'sky')).toStrictEqual({
      id: 'moon-b',
      href: '/projects/moon-b/',
      title: 'MOON-B',
      summary: 'Summary of moon-b',
      date: '2026-02',
      status: 'Shipped',
      planned: false,
      pictured: false,
      biome: 'dune',
      theme: 'sky',
      flagship: false,
      kind: 'moon',
    });
  });

  it('lists planned work after built work, even a planned flagship, and gives it no date', () => {
    const [code] = buildProjectTree(SYSTEMS, [
      ...PROJECTS,
      project('someday', {
        system: { id: 'code' },
        date: undefined,
        status: 'planned',
        flagship: true,
      }),
    ]);
    expect(planetsOf(code).map((planet) => planet.id)).toEqual(['older', 'newer', 'someday']);
    expect(planetsOf(code)[2]).toMatchObject({ planned: true, status: 'Planned', date: '' });
  });

  it('paints every card in its own system, a moon in its planet’s', () => {
    const [code, robots] = tree.map(planetsOf);
    expect(code?.map((planet) => planet.theme)).toEqual(['sky', 'sky']);
    expect(code?.[0]?.moons.map((moon) => moon.theme)).toEqual(['sky', 'sky']);
    expect(robots?.map((planet) => planet.theme)).toEqual(['coral']);
  });
});

describe('visibleProjects', () => {
  const withDraft = [...PROJECTS, project('secret', { system: { id: 'code' }, draft: true })];

  it('hides drafts in production and shows them in dev, exactly like buildUniverse()', () => {
    expect(visibleProjects(withDraft, false).map((entry) => entry.id)).not.toContain('secret');
    expect(visibleProjects(withDraft, true).map((entry) => entry.id)).toContain('secret');
  });
});

describe('projectTheme', () => {
  it('finds a planet’s system, and a moon’s through its planet', () => {
    const byId = (id: string): ProjectLike =>
      PROJECTS.find((entry) => entry.id === id) as ProjectLike;
    expect(projectTheme(byId('rover'), SYSTEMS, PROJECTS)).toBe('coral');
    expect(projectTheme(byId('newer'), SYSTEMS, PROJECTS)).toBe('sky');
    expect(projectTheme(byId('moon-a'), SYSTEMS, PROJECTS)).toBe('sky');
  });

  it('has no family for a project whose system (or planet) is not there', () => {
    const orphan = project('orphan', { system: { id: 'gone' } });
    const lostMoon = project('lost', { parent: { id: 'nowhere' } });
    expect(projectTheme(orphan, SYSTEMS, PROJECTS)).toBeUndefined();
    expect(projectTheme(lostMoon, SYSTEMS, PROJECTS)).toBeUndefined();
  });
});

describe('mixesSystems', () => {
  it('is true only when the cards name more than one family', () => {
    expect(mixesSystems([{ theme: 'sky' }, { theme: 'sky' }])).toBe(false);
    expect(mixesSystems([{ theme: 'sky' }, { theme: 'coral' }])).toBe(true);
    // A card whose system is gone has no family: next to one that has, that is a mix.
    expect(mixesSystems([{ theme: 'sky' }, { theme: undefined }])).toBe(true);
    expect(mixesSystems([])).toBe(false);
  });
});

describe('sharedTheme', () => {
  it('names the family only when every card is in it', () => {
    expect(sharedTheme([{ theme: 'sky' }, { theme: 'sky' }])).toBe('sky');
    expect(sharedTheme([{ theme: 'sky' }, { theme: 'coral' }])).toBeUndefined();
    expect(sharedTheme([{ theme: 'sky' }, { theme: undefined }])).toBeUndefined();
    expect(sharedTheme([{ theme: undefined }])).toBeUndefined();
    expect(sharedTheme([])).toBeUndefined();
  });
});

describe('featured', () => {
  const ids = (cards: ReadonlyArray<{ id: string }>): string[] => cards.map((card) => card.id);

  it('puts flagships first, then the newest work, and respects the limit', () => {
    const tree = buildProjectTree(SYSTEMS, PROJECTS);
    // A mixed list: each planet keeps its own system's colours.
    expect(featured(tree, 3).map((card) => card.theme)).toEqual(['sky', 'sky', 'coral']);
    // "rover" sits in another system and is the oldest of the three: newest-first is galaxy-wide.
    expect(ids(featured(tree, 3))).toEqual(['older', 'newer', 'rover']);
    expect(ids(featured(tree, 1))).toEqual(['older']);
  });

  it('never features planned work, however few built planets there are', () => {
    const tree = buildProjectTree(SYSTEMS, [
      project('only', { system: { id: 'code' } }),
      project('someday', { system: { id: 'code' }, status: 'planned', flagship: true }),
    ]);
    expect(ids(featured(tree, 3))).toEqual(['only']);
  });

  it('features a flagship moon, and lists it once', () => {
    const tree = buildProjectTree(SYSTEMS, [
      project('home', { system: { id: 'code' }, cover: COVER }),
      project('star', { parent: { id: 'home' }, flagship: true }),
      project('quiet', { parent: { id: 'home' } }),
      project('later', { parent: { id: 'home' }, status: 'planned', flagship: true }),
    ]);
    const cards = featured(tree, 3);
    expect(ids(cards)).toEqual(['star', 'home']);
    // Its planet's card lists the rest of the family, not the moon that has a card of its own.
    const planet = cards[1];
    expect(planet && isPlanet(planet) ? ids(planet.moons) : []).toEqual(['quiet', 'later']);
  });

  it('prefers work with a picture, and takes work without one only to fill the list', () => {
    const tree = buildProjectTree(SYSTEMS, [
      project('bare-new', { system: { id: 'code' }, date: '2026-09' }),
      project('shown-old', { system: { id: 'code' }, date: '2024-01', cover: COVER }),
      project('shown-mid', { system: { id: 'robots' }, date: '2025-01', cover: COVER }),
    ]);
    expect(ids(featured(tree, 2))).toEqual(['shown-mid', 'shown-old']);
    expect(ids(featured(tree, 3))).toEqual(['shown-mid', 'shown-old', 'bare-new']);
  });
});

describe('projectContext', () => {
  it('places a planet in its system', () => {
    const context = projectContext(PROJECTS[1] as ProjectLike, SYSTEMS, PROJECTS);
    expect(context.placement).toBe('Planet in the CODE system');
    expect(context.theme).toBe('sky');
    expect(context.crumbs).toEqual([
      { label: 'Projects', href: '/projects/' },
      { label: 'CODE', href: '/systems/code/' },
    ]);
    expect(context.moons.map((moon) => moon.id)).toEqual(['moon-a', 'moon-b']);
    expect(context.moons.map((moon) => moon.theme)).toEqual(['sky', 'sky']);
  });

  it('places a moon under its planet, and inherits the planet’s system', () => {
    const context = projectContext(PROJECTS[3] as ProjectLike, SYSTEMS, PROJECTS);
    expect(context.placement).toBe('Moon of OLDER');
    expect(context.theme).toBe('sky');
    expect(context.crumbs.map((crumb) => crumb.href)).toEqual([
      '/projects/',
      '/systems/code/',
      '/projects/older/',
    ]);
    expect(context.moons).toEqual([]);
  });

  it('lists related projects, and skips one that is not visible (a draft in production)', () => {
    const rover = PROJECTS[4] as ProjectLike;
    expect(projectContext(rover, SYSTEMS, PROJECTS).related.map((card) => card.id)).toEqual([
      'newer',
    ]);
    // Related work from another system wears that system's colours, not this page's.
    expect(projectContext(rover, SYSTEMS, PROJECTS).related[0]?.theme).toBe('sky');
    const withoutNewer = PROJECTS.filter((entry) => entry.id !== 'newer');
    expect(projectContext(rover, SYSTEMS, withoutNewer).related).toEqual([]);
  });
});

describe('a binary star in the project tree', () => {
  const tree = buildProjectTree(TREE, TREE_PROJECTS);
  const suns = tree.flatMap((system) => system.suns);
  const sun = (id: string): SunNode | undefined => suns.find((entry) => entry.id === id);

  it('lists its two suns together, primary first, in the galaxy order of the binary', () => {
    expect(tree.map((system) => [system.id, system.name, system.theme])).toEqual([
      ['projects', 'Projects', 'sky'],
      ['hackathons', 'Hackathons', 'coral'],
      ['research', 'Research', 'lilac'],
    ]);
    // One section per sun on the projects index, never one for the binary itself.
    expect(suns.map((entry) => entry.id)).toEqual([
      'software',
      'hardware',
      'hackathons',
      'research',
    ]);
    expect(sun('hardware')).toMatchObject({
      href: '/systems/hardware/',
      name: 'Hardware',
      tagline: 'Rockets and robots.',
      theme: 'sky',
    });
  });

  it('hangs planets on the sun they name, and moons on their planet, in the binary’s colours', () => {
    const planets = (id: string): string[] => sun(id)?.planets.map((planet) => planet.id) ?? [];
    expect(planets('software')).toEqual(['canadian-fish', 'days2meet', 'cyberpatriot']);
    expect(planets('hardware')).toEqual(['model-rocketry', 'robotics']);
    const fish = sun('software')?.planets[0];
    expect(fish?.moons.map((moon) => moon.id)).toEqual(['fishai', 'fish-online']);
    expect(fish?.moons.map((moon) => moon.theme)).toEqual(['sky', 'sky']);
    expect(suns.flatMap((entry) => entry.planets.map((planet) => planet.theme))).toEqual([
      'sky',
      'sky',
      'sky',
      'sky',
      'sky',
      'coral',
      'lilac',
    ]);
  });

  it('tells each sun of a binary which binary it belongs to and which sun it circles opposite', () => {
    expect(sun('software')?.twin).toEqual({
      binary: { label: 'Projects', href: '/projects/' },
      other: { label: 'Hardware', href: '/systems/hardware/' },
    });
    expect(sun('hardware')?.twin?.other).toEqual({ label: 'Software', href: '/systems/software/' });
    expect(sun('research')?.twin).toBeUndefined();
  });

  it('puts a system with no built work yet last, so the first screen is finished work', () => {
    // Research (every planet planned) is slot 2, but follows Hackathons (slot 3).
    expect(tree.map((system) => system.id)).toEqual(['projects', 'hackathons', 'research']);
    // Once something in it is built, it takes its place in the galaxy's order again.
    const built = buildProjectTree(TREE, [
      ...TREE_PROJECTS,
      project('odds', { system: { id: 'research' }, date: '2026-10' }),
    ]);
    expect(built.map((system) => system.id)).toEqual(['projects', 'research', 'hackathons']);
  });

  it('features finished work from either sun, the flagship moon first', () => {
    expect(featured(tree, 3).map((card) => card.id)).toEqual([
      'fishai',
      'canadian-fish',
      'days2meet',
    ]);
  });

  it('gives every sun a page, and a binary none: the projects index is its page', () => {
    expect(sunPages(TREE).map((entry) => entry.id)).toEqual([
      'research',
      'hardware',
      'hackathons',
      'software',
    ]);
  });

  it('dresses a sun that wears a family of its own in it, and keeps the binary’s', () => {
    const own = TREE.map((entry) =>
      entry.id === 'hardware'
        ? { ...entry, data: { ...entry.data, theme: 'coral' as const } }
        : entry,
    );
    const mixed = buildProjectTree(own, TREE_PROJECTS);
    const each = mixed.flatMap((system) => system.suns);
    // The binary's own family is its projects index's: sky.
    expect(mixed[0]).toMatchObject({ id: 'projects', theme: 'sky' });
    expect(each.find((entry) => entry.id === 'software')?.theme).toBe('sky');
    const hardware = each.find((entry) => entry.id === 'hardware');
    expect(hardware?.theme).toBe('coral');
    expect(hardware?.planets.map((planet) => planet.theme)).toEqual(['coral', 'coral']);
    // Its page and its planets' pages.
    expect(systemView(own[1] as SystemLike, own, TREE_PROJECTS).theme).toBe('coral');
    const robotics = TREE_PROJECTS.find((entry) => entry.id === 'robotics') as ProjectLike;
    expect(projectContext(robotics, own, TREE_PROJECTS).theme).toBe('coral');
  });
});

describe('where a project of a binary sits', () => {
  it('places a planet on its sun, crumbs through the sun, and paints it in the binary’s family', () => {
    const context = projectContext(projectOf('robotics'), TREE, TREE_PROJECTS);
    expect(context.placement).toBe('Planet of Hardware');
    expect(context.crumbs).toEqual([
      { label: 'Projects', href: '/projects/' },
      { label: 'Hardware', href: '/systems/hardware/' },
    ]);
    expect(context.theme).toBe('sky');
  });

  it('places a moon under its planet, through the sun its planet orbits', () => {
    const context = projectContext(projectOf('fishai'), TREE, TREE_PROJECTS);
    expect(context.placement).toBe('Moon of CANADIAN-FISH');
    expect(context.crumbs.map((crumb) => crumb.label)).toEqual([
      'Projects',
      'Software',
      'CANADIAN-FISH',
    ]);
    expect(context.theme).toBe('sky');
    const planet = projectContext(projectOf('canadian-fish'), TREE, TREE_PROJECTS);
    expect(planet.moons.map((moon) => moon.theme)).toEqual(['sky', 'sky']);
  });

  it('keeps a one-sun system’s words, as before binaries', () => {
    expect(projectContext(projectOf('sports'), TREE, TREE_PROJECTS).placement).toBe(
      'Planet in the Research system',
    );
  });

  it('finds the colour family of a sun of a binary through its binary', () => {
    expect(projectTheme(projectOf('robotics'), TREE, TREE_PROJECTS)).toBe('sky');
    expect(projectTheme(projectOf('fishai'), TREE, TREE_PROJECTS)).toBe('sky');
    expect(projectTheme(projectOf('kalshi'), TREE, TREE_PROJECTS)).toBe('lilac');
  });
});

describe('systemView', () => {
  it('shows a solar system as it always has', () => {
    const view = systemView(entryOf('research'), TREE, TREE_PROJECTS);
    expect(view).toMatchObject({
      id: 'research',
      href: '/systems/research/',
      name: 'Research',
      tagline: 'Questions.',
      theme: 'lilac',
      eyebrow: 'Solar system',
      title: 'Research system',
      crumbs: [{ label: 'Projects', href: '/projects/' }],
      twin: undefined,
      link: undefined,
    });
    expect(view.planets.map((planet) => planet.id)).toEqual(['sports']);
    // The same page as before binary stars, for the one system there is today.
    const code = systemView(SYSTEMS[1] as SystemLike, SYSTEMS, PROJECTS);
    expect([code.eyebrow, code.title, code.theme]).toEqual(['Solar system', 'CODE system', 'sky']);
    expect(code.planets.map((planet) => planet.id)).toEqual(['older', 'newer']);
  });

  it('shows a sun of a binary: its binary over its name, its twin under its words', () => {
    const view = systemView(entryOf('software'), TREE, TREE_PROJECTS);
    expect(view).toMatchObject({
      href: '/systems/software/',
      name: 'Software',
      theme: 'sky',
      eyebrow: 'Sun of Projects',
      title: 'Software projects',
      crumbs: [{ label: 'Projects', href: '/projects/' }],
      twin: {
        binary: { label: 'Projects', href: '/projects/' },
        other: { label: 'Hardware', href: '/systems/hardware/' },
      },
    });
    expect(view.planets.map((planet) => planet.id)).toEqual([
      'canadian-fish',
      'days2meet',
      'cyberpatriot',
    ]);
  });

  it('opens with the site a system’s work lives on, when it has one (the Blog)', () => {
    const blog: SystemLike = {
      id: 'blog',
      data: {
        name: 'Blog',
        tagline: 'Notes.',
        theme: 'mint',
        order: 4,
        link: 'https://www.blog.example.com/',
      },
    };
    expect(systemView(blog, [...TREE, blog], TREE_PROJECTS).link).toEqual({
      label: 'Visit the site',
      href: 'https://www.blog.example.com/',
      host: 'blog.example.com',
    });
  });
});
