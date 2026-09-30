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
  toCard,
  visibleProjects,
  type ProjectLike,
  type SystemLike,
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
    expect(tree[0]).toMatchObject({ href: '/systems/code/', name: 'CODE', theme: 'sky' });
  });

  it('orders planets flagship first, then newest first, and hangs moons on their planet', () => {
    const [code] = tree;
    expect(code?.planets.map((planet) => planet.id)).toEqual(['older', 'newer']);
    const unflagged = PROJECTS.map((entry) => ({
      ...entry,
      data: { ...entry.data, flagship: false },
    }));
    const [plain] = buildProjectTree(SYSTEMS, unflagged);
    expect(plain?.planets.map((planet) => planet.id)).toEqual(['newer', 'older']);
    // Same month: the id breaks the tie, so the order never depends on the file system.
    expect(code?.planets[0]?.moons.map((moon) => moon.id)).toEqual(['moon-a', 'moon-b']);
    expect(code?.planets[1]?.moons).toEqual([]);
  });

  it('never lists a moon as a planet', () => {
    const planetIds = tree.flatMap((node) => node.planets.map((planet) => planet.id));
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
    expect(code?.planets.map((planet) => planet.id)).toEqual(['older', 'newer', 'someday']);
    expect(code?.planets[2]).toMatchObject({ planned: true, status: 'Planned', date: '' });
  });

  it('paints every card in its own system, a moon in its planet’s', () => {
    const [code, robots] = tree;
    expect(code?.planets.map((planet) => planet.theme)).toEqual(['sky', 'sky']);
    expect(code?.planets[0]?.moons.map((moon) => moon.theme)).toEqual(['sky', 'sky']);
    expect(robots?.planets.map((planet) => planet.theme)).toEqual(['coral']);
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
  const COVER = { src: 'cover.png', alt: 'A picture' };
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
