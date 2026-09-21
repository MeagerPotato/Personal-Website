import { z } from 'astro/zod';
import { describe, expect, it } from 'vitest';
import { buildUniverse } from '../universe/data/build';
import { entryIdFromPath, routes } from './routes';
import { pageSchema, projectSchema, systemSchema } from './schemas';
import { toUniverseInput } from './universe-input';

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
    ['an image without alt text', { cover: { src: './cover.png', alt: '' } }],
    ['too many decorative moons', { planet: { biome: 'tide', decorMoons: 4 } }],
    ['a summary too long for a link preview', { summary: 'x'.repeat(161) }],
    ['an unknown status', { status: 'abandoned' }],
  ])('rejects %s', (_label, override) => {
    expect(project.safeParse({ ...validProject, ...override }).success).toBe(false);
  });

  it('accepts https links', () => {
    const parsed = project.parse({
      ...validProject,
      links: { repo: 'https://github.com/MeagerPotato/FishAI', demo: 'https://fishai.allenkh.com' },
    });
    expect(parsed.links.demo).toBe('https://fishai.allenkh.com');
  });
});

describe('systemSchema and pageSchema', () => {
  it('accept what the seed content uses, and default a system to an automatic position', () => {
    const system = systemSchema().parse({
      name: 'Code',
      tagline: 'Software I build because I wanted it to exist.',
      theme: 'sky',
      order: 1,
    });
    expect(system.position).toBe('auto');
    expect(
      pageSchema().parse({ title: 'About', summary: 'Who Allen is.', dock: 'home' }).dock,
    ).toBe('home');
  });

  it('reject a theme that is not a token family, and order 0 (reserved for home)', () => {
    const base = { name: 'Code', tagline: 'x', theme: 'sky', order: 1 };
    expect(systemSchema().safeParse({ ...base, theme: 'neon' }).success).toBe(false);
    expect(systemSchema().safeParse({ ...base, order: 0 }).success).toBe(false);
    expect(systemSchema().safeParse({ ...base, position: [1200, -300] }).success).toBe(true);
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
            data: systemSchema().parse({ name: 'Code', tagline: 'x', theme: 'sky', order: 1 }),
          },
        ],
        projects: [
          { id: 'fishai', data: project.parse({ ...validProject, related: [], flagship: true }) },
          { id: 'fish-onboarding', data: moon },
        ],
        pages: [
          { id: 'about', data: pageSchema().parse({ title: 'About', summary: 'x', dock: 'home' }) },
        ],
        includeDrafts: false,
      }),
    );

    expect(manifest.bodies.map((body) => [body.id, body.kind, body.href])).toEqual([
      ['page/about', 'home', '/about/'],
      ['system/code', 'sun', '/systems/code/'],
      ['project/fishai', 'planet', '/projects/fishai/'],
      ['project/fish-onboarding', 'moon', '/projects/fish-onboarding/'],
    ]);
  });
});
