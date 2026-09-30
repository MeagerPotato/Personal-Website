import { describe, expect, it } from 'vitest';
import { buildUniverse as buildWithReach } from './data/build';
import type { ProjectInput, UniverseInput, UniverseManifest } from './data/types';
import { galaxyKey } from './manifest';

/**
 * The fixtures are made-up galaxies under real ids (FishAI a planet, not a moon): none of their
 * bodies is an emblem world, so none has a declared reach (design/worlds/reach.ts).
 */
const buildUniverse = (input: Parameters<typeof buildWithReach>[0]) => buildWithReach(input, {});

const project = (id: string, over: Partial<ProjectInput> = {}): ProjectInput => ({
  id,
  title: id,
  href: `/projects/${id}/`,
  date: '2026-08',
  size: 'm',
  biome: 'terra',
  rings: false,
  decorMoons: 0,
  flagship: false,
  related: [],
  draft: false,
  ...over,
});

/** A small galaxy as the build makes it: home, and one system with planets and a moon. */
const input = (over: Partial<UniverseInput> = {}): UniverseInput => ({
  systems: [
    { id: 'code', name: 'Code', href: '/systems/code/', theme: 'sky', order: 1, position: 'auto' },
  ],
  projects: [
    project('fishai', { system: 'code', size: 'l', date: '2025-06', related: ['days2meet'] }),
    project('canadian-fish-demo', { parent: 'fishai', size: 's' }),
    project('days2meet', { system: 'code' }),
  ],
  pages: [
    { id: 'about', title: 'About', href: '/about/', dock: 'home' },
    { id: 'resume', title: 'Resume', href: '/resume/', dock: 'station' },
  ],
  includeDrafts: false,
  ...over,
});

/** A copy of `manifest` with one body changed. */
function withBody(
  manifest: UniverseManifest,
  id: string,
  change: (body: UniverseManifest['bodies'][number]) => void,
): UniverseManifest {
  const copy = structuredClone(manifest);
  const body = copy.bodies.find((each) => each.id === id);
  if (!body) throw new Error(`no body ${id}`);
  change(body);
  return copy;
}

describe('galaxyKey', () => {
  const manifest = buildUniverse(input());
  const key = galaxyKey(manifest);

  it('is eight hex digits, the same for the same galaxy however it arrived', () => {
    expect(key).toMatch(/^[0-9a-f]{8}$/);
    expect(galaxyKey(buildUniverse(input()))).toBe(key);
    // As the web layer hands it over: fetched, parsed from JSON.
    expect(galaxyKey(JSON.parse(JSON.stringify(manifest)) as UniverseManifest)).toBe(key);
  });

  it('never changes for a copy edit, a new look, or the order things are listed in', () => {
    // A returning visitor keeps their place across a deploy that only reworded things.
    const reworded = input();
    reworded.systems = reworded.systems.map((system) => ({
      ...system,
      name: 'Software',
      href: '/systems/software/',
    }));
    reworded.projects = reworded.projects.map((each) => ({
      ...each,
      title: `${each.title}, again`,
      href: `/work/${each.id}/`,
      biome: 'ember',
      related: [],
    }));
    reworded.pages = reworded.pages.map((page) => ({ ...page, title: `${page.title} Me` }));
    reworded.projectsHref = '/projects/';
    expect(galaxyKey(buildUniverse(reworded))).toBe(key);

    const reversed = { ...manifest };
    reversed.systems = [...manifest.systems].reverse();
    reversed.bodies = [...manifest.bodies].reverse();
    expect(galaxyKey(reversed)).toBe(key);
  });

  it('changes when anything moves or changes size', () => {
    const changes: Array<[string, UniverseManifest]> = [
      [
        'a system moved',
        {
          ...manifest,
          systems: manifest.systems.map((system) =>
            system.id === 'code'
              ? { ...system, position: [system.position[0] + 1, system.position[1]] as const }
              : system,
          ),
        },
      ],
      [
        'a system grown',
        {
          ...manifest,
          systems: manifest.systems.map((system) =>
            system.id === 'code' ? { ...system, radius: system.radius + 1 } : system,
          ),
        },
      ],
      ['a planet grown', withBody(manifest, 'project/days2meet', (body) => (body.radius += 1))],
      ['a wider ring', withBody(manifest, 'project/days2meet', (body) => (body.dockRadius += 1))],
      [
        'an orbit further out',
        withBody(manifest, 'project/days2meet', (body) => {
          if (body.orbit) body.orbit.radius += 1;
        }),
      ],
      [
        'an orbit at another angle',
        withBody(manifest, 'project/days2meet', (body) => {
          if (body.orbit) body.orbit.phase += 0.001;
        }),
      ],
      [
        'a slower orbit',
        withBody(manifest, 'project/days2meet', (body) => {
          if (body.orbit) body.orbit.periodSec += 1;
        }),
      ],
      [
        'a moon round another planet',
        withBody(manifest, 'project/canadian-fish-demo', (body) => {
          body.parent = 'project/days2meet';
        }),
      ],
      [
        'a body in another system',
        withBody(manifest, 'project/days2meet', (body) => (body.system = 'home')),
      ],
      [
        'a project added',
        buildUniverse(
          input({ projects: [...input().projects, project('robotics', { system: 'code' })] }),
        ),
      ],
      [
        'the rings in another order (a project dated earlier)',
        buildUniverse(
          input({
            projects: input().projects.map((each) =>
              each.id === 'days2meet' ? { ...each, date: '2024-01' } : each,
            ),
          }),
        ),
      ],
      [
        'a system placed by hand',
        buildUniverse(
          input({
            systems: input().systems.map((system) => ({ ...system, position: [-500, 500] })),
          }),
        ),
      ],
    ];
    for (const [what, changed] of changes) {
      expect(galaxyKey(changed), what).not.toBe(key);
    }
  });

  it('changes when a world’s solid reaches further, and not for a body without one', () => {
    const solid = buildWithReach(input(), { 'project/days2meet': 1.19 });
    expect(galaxyKey(solid)).not.toBe(key);
    expect(galaxyKey(buildWithReach(input(), { 'project/days2meet': 1.2 }))).not.toBe(
      galaxyKey(solid),
    );
    expect(galaxyKey(buildWithReach(input(), { 'project/days2meet': 1 }))).toBe(key);
  });
});
