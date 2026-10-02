import { z } from 'astro/zod';
import { describe, expect, it } from 'vitest';
import { buildUniverse as buildWithReach } from '../universe/data/build';
import { profiles } from './profiles';
import { entryIdFromPath, routes } from './routes';
import { pageSchema, projectSchema, systemSchema } from './schemas';
import { toSystemInput, toUniverseInput } from './universe-input';

/**
 * The fixtures are made-up galaxies under real ids (FishAI a planet, not a moon): none of their
 * bodies is an emblem world, so none has a declared reach (design/worlds/reach.ts).
 */
const buildUniverse = (input: Parameters<typeof buildWithReach>[0]) => buildWithReach(input, {});

// Stand-ins for the two helpers Astro injects. reference() really does resolve an id string to
// { collection, id }; image() resolves to image metadata, which these tests do not care about.
const helpers = {
  image: () => z.string().min(1),
  reference: (collection: 'systems' | 'projects') =>
    z.string().transform((id) => ({ collection, id })),
};
const project = projectSchema(helpers);

const validProject = {
  title: 'FishAI',
  summary: 'Bots for a six-player hidden-information card game, and the lab that measures them.',
  system: 'code',
  date: '2026-08',
  status: 'in-progress',
  role: 'Everything',
  cover: { src: './cover.png', alt: 'The FishAI lab page' },
  planet: { biome: 'tide' },
};

const issuesOf = (result: { success: boolean; error?: z.ZodError }): string =>
  result.success ? '' : JSON.stringify(result.error?.issues);

describe('routes', () => {
  it('ends every page URL with a slash', () => {
    const pages = [
      routes.home(),
      routes.page('about'),
      routes.projects(),
      routes.project('fishai'),
      routes.system('code'),
    ];
    for (const href of pages) expect(href).toMatch(/^\/(.*\/)?$/);
  });

  it('takes an entry id from the first path segment', () => {
    expect(entryIdFromPath('fishai/index.md')).toBe('fishai');
    expect(entryIdFromPath('code.md')).toBe('code');
    expect(entryIdFromPath('fish-onboarding\\index.md')).toBe('fish-onboarding');
  });

  it('refuses ids that would make an ugly or broken URL', () => {
    for (const bad of ['FishAI/index.md', 'fish ai.md', 'fish_ai.md', '-fish.md', '.md']) {
      expect(() => entryIdFromPath(bad), bad).toThrow(/kebab-case/);
    }
  });
});

describe('projectSchema', () => {
  it('accepts a minimal project and fills in the defaults', () => {
    const parsed = project.parse(validProject);
    expect(parsed.system).toEqual({ collection: 'systems', id: 'code' });
    expect(parsed.planet).toEqual({ size: 'm', biome: 'tide', rings: false, decorMoons: 0 });
    expect(parsed).toMatchObject({
      stack: [],
      links: {},
      gallery: [],
      related: [],
      flagship: false,
      draft: false,
    });
  });

  it('rejects unknown keys, so a typo in frontmatter fails the build instead of vanishing', () => {
    const result = project.safeParse({ ...validProject, sumary: 'oops' });
    expect(result.success).toBe(false);
    expect(issuesOf(result)).toContain('sumary');
  });

  it.each([
    ['an unquoted-looking date', { date: '2026-8' }],
    ['a month that does not exist', { date: '2026-13' }],
    ['an http link', { links: { repo: 'http://github.com/x/y' } }],
    ['an empty link', { links: { demo: '' } }],
    ['a biome that is not in the tokens', { planet: { biome: 'swamp' } }],
    ['primer, the clay only planned work wears', { planet: { biome: 'primer' } }],
    ['an image without alt text', { cover: { src: './cover.png', alt: '' } }],
    ['too many decorative moons', { planet: { biome: 'tide', decorMoons: 4 } }],
    ['a summary too long for a link preview', { summary: 'x'.repeat(161) }],
    ['an unknown status', { status: 'abandoned' }],
  ])('rejects %s', (_label, override) => {
    expect(project.safeParse({ ...validProject, ...override }).success).toBe(false);
  });

  it('accepts planned work without a date, a role or a cover', () => {
    const parsed = project.parse({
      ...validProject,
      date: undefined,
      role: undefined,
      cover: undefined,
      status: 'planned',
    });
    expect(parsed.status).toBe('planned');
    expect(parsed.date).toBeUndefined();
    expect(parsed.cover).toBeUndefined();
  });

  it('still needs a date and a role for work that is not planned', () => {
    const result = project.safeParse({ ...validProject, date: undefined, role: undefined });
    expect(result.success).toBe(false);
    expect(issuesOf(result)).toContain('date is required unless the status is');
    expect(issuesOf(result)).toContain('role is required');
  });

  it('accepts finished work that was never a product as "completed"', () => {
    expect(project.parse({ ...validProject, status: 'completed' }).status).toBe('completed');
  });

  it('accepts built work without a cover: the page shows its planet, the preview is the site card', () => {
    expect(project.parse({ ...validProject, cover: undefined }).cover).toBeUndefined();
  });

  it('accepts https links', () => {
    const parsed = project.parse({
      ...validProject,
      links: { repo: 'https://github.com/MeagerPotato/FishAI', demo: 'https://fishai.allenkh.com' },
    });
    expect(parsed.links.demo).toBe('https://fishai.allenkh.com');
  });
});

const systemEntry = systemSchema(helpers);

describe('systemSchema and pageSchema', () => {
  it('accept what the seed content uses; the build places a system automatically', () => {
    const system = systemEntry.parse({
      name: 'Code',
      tagline: 'Software I build because I wanted it to exist.',
      theme: 'sky',
      order: 1,
    });
    // No default in the schema (a sun of a binary must not have a position at all): the input
    // to the build supplies it.
    expect(system.position).toBeUndefined();
    expect(toSystemInput({ id: 'code', data: system }).position).toBe('auto');
    expect(
      pageSchema().parse({ title: 'About', summary: 'Who Allen is.', dock: 'home' }).dock,
    ).toBe('home');
  });

  it('reject a theme that is not a token family, and order 0 (reserved for home)', () => {
    const base = { name: 'Code', tagline: 'x', theme: 'sky', order: 1 };
    expect(systemEntry.safeParse({ ...base, theme: 'neon' }).success).toBe(false);
    expect(systemEntry.safeParse({ ...base, order: 0 }).success).toBe(false);
    expect(systemEntry.safeParse({ ...base, position: [1200, -300] }).success).toBe(true);
  });
});

describe('systemSchema: three shapes', () => {
  const solar = {
    name: 'Research',
    tagline: 'Questions I want to answer.',
    theme: 'lilac',
    order: 2,
  };
  const binary = { name: 'Projects', theme: 'sky', order: 1, suns: ['software', 'hardware'] };
  const sun = { name: 'Hardware', tagline: 'Rockets that come back in one piece.' };

  /** Every issue as "key: message", the way Astro reports them against a file. */
  const issues = (data: object): string[] => {
    const result = systemEntry.safeParse(data);
    return result.success
      ? []
      : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  };

  it('accepts a solar system, a binary star and a sun of a binary, told apart by their keys', () => {
    expect(issues(solar)).toEqual([]);
    expect(issues(binary)).toEqual([]);
    expect(issues(sun)).toEqual([]);
    // A binary names its suns by id, primary first; the build checks that they exist.
    expect(systemEntry.parse(binary).suns).toEqual([
      { collection: 'systems', id: 'software' },
      { collection: 'systems', id: 'hardware' },
    ]);
    // A system whose work lives elsewhere (the Blog) may say where, and so may a sun.
    expect(issues({ ...solar, link: 'https://blog.allenkh.com' })).toEqual([]);
    expect(issues({ ...sun, link: 'https://example.com/rockets' })).toEqual([]);
  });

  it('says what is wrong with a binary, on the key, and what to do', () => {
    expect(issues({ ...binary, order: undefined })).toEqual([
      'order: a binary needs one, its place in the galaxy',
    ]);
    expect(issues({ ...binary, theme: undefined })).toEqual([
      "theme: a binary's two suns share its colour family (coral, mint, sky, lilac; butter is home's)",
    ]);
    expect(issues({ ...binary, tagline: 'x', link: 'https://example.com' })).toEqual([
      'tagline: a binary has none; each of its suns has its own',
      'link: a binary has none; each of its suns has its own',
    ]);
  });

  it('says what is wrong with a solar system, and with a sun of a binary', () => {
    expect(issues({ ...solar, theme: undefined, tagline: undefined })).toEqual([
      "theme: every solar system needs a colour family (coral, mint, sky, lilac; butter is home's)",
      'tagline: required: one sentence under its name',
    ]);
    expect(issues({ ...sun, theme: 'coral', position: [0, 900] })).toEqual([
      'position: a sun of a binary goes where its binary goes; leave it out',
    ]);
    // Its own colour family is its to choose (Hardware's coral beside Software's sky), or its
    // binary's without one.
    expect(issues({ ...sun, theme: 'coral' })).toEqual([]);
    expect(issues(sun)).toEqual([]);
    expect(issues({ name: 'Hardware' })).toEqual([
      'tagline: required: one sentence under its name',
    ]);
  });

  it('takes exactly two suns, and only an https link', () => {
    expect(issues({ ...binary, suns: ['software'] })).not.toEqual([]);
    expect(issues({ ...binary, suns: ['a', 'b', 'c'] })).not.toEqual([]);
    expect(issues({ ...solar, link: 'http://blog.allenkh.com' })).not.toEqual([]);
    expect(issues({ ...solar, link: '' })).not.toEqual([]);
    expect(issues({ ...solar, lnk: 'https://blog.allenkh.com' })).not.toEqual([]);
  });

  it('carries a binary into the galaxy: its suns circle one slot, each with its own page', () => {
    const manifest = buildUniverse(
      toUniverseInput({
        systems: [
          { id: 'projects', data: systemEntry.parse(binary) },
          { id: 'software', data: systemEntry.parse({ ...sun, name: 'Software' }) },
          { id: 'hardware', data: systemEntry.parse(sun) },
        ],
        projects: [
          { id: 'fishai', data: project.parse({ ...validProject, system: 'software' }) },
          { id: 'rocket', data: project.parse({ ...validProject, system: 'hardware' }) },
        ],
        pages: [
          { id: 'about', data: pageSchema().parse({ title: 'About', summary: 'x', dock: 'home' }) },
        ],
        profiles: [],
        includeDrafts: false,
      }),
    );
    expect(manifest.systems.map((system) => [system.id, system.theme, system.center])).toEqual([
      ['home', 'butter', 'page/about'],
      ['projects', 'sky', 'system/software'],
    ]);
    expect(manifest.bodies.map((body) => [body.id, body.system, body.parent, body.href])).toEqual([
      ['page/about', 'home', null, '/about/'],
      ['system/software', 'projects', null, '/systems/software/'],
      ['project/fishai', 'projects', 'system/software', '/projects/fishai/'],
      ['system/hardware', 'projects', null, '/systems/hardware/'],
      ['project/rocket', 'projects', 'system/hardware', '/projects/rocket/'],
    ]);
  });
});

describe('toUniverseInput', () => {
  it('carries validated entries into buildUniverse end to end', () => {
    const moon = project.parse({
      ...validProject,
      title: 'Fish Onboarding',
      system: undefined,
      parent: 'fishai',
      planet: { biome: 'frost', size: 's' },
    });
    const manifest = buildUniverse(
      toUniverseInput({
        systems: [
          {
            id: 'code',
            data: systemEntry.parse({ name: 'Code', tagline: 'x', theme: 'sky', order: 1 }),
          },
        ],
        projects: [
          { id: 'fishai', data: project.parse({ ...validProject, related: [], flagship: true }) },
          { id: 'fish-onboarding', data: moon },
        ],
        pages: [
          { id: 'about', data: pageSchema().parse({ title: 'About', summary: 'x', dock: 'home' }) },
        ],
        profiles: profiles({ github: 'https://github.com/someone' }),
        includeDrafts: false,
      }),
    );

    expect(manifest.bodies.map((body) => [body.id, body.kind, body.href])).toEqual([
      ['page/about', 'home', '/about/'],
      ['link/github', 'link', 'https://github.com/someone'],
      ['system/code', 'sun', '/systems/code/'],
      ['project/fishai', 'planet', '/projects/fishai/'],
      ['project/fish-onboarding', 'moon', '/projects/fish-onboarding/'],
    ]);
  });
});
