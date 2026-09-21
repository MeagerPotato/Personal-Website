import { describe, expect, it } from 'vitest';
import { tuning } from '../design/tuning';
import { buildUniverse, UniverseDataError } from './build';
import type {
  ManifestBody,
  PageInput,
  ProjectInput,
  SystemInput,
  UniverseInput,
  UniverseManifest,
} from './types';

const L = tuning.layout;

const system = (id: string, order: number, over: Partial<SystemInput> = {}): SystemInput => ({
  id,
  name: id,
  href: `/systems/${id}/`,
  theme: 'sky',
  order,
  position: 'auto',
  ...over,
});

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

const page = (id: string, dock: PageInput['dock']): PageInput => ({
  id,
  title: id,
  href: `/${id}/`,
  dock,
});

/** The v0.1 inventory from docs/PLAN.md §4.1. */
const v01 = (over: Partial<UniverseInput> = {}): UniverseInput => ({
  systems: [system('code', 1)],
  projects: [
    project('fishai', { system: 'code', size: 'l', flagship: true, related: ['days2meet'] }),
    project('canadian-fish-demo', { parent: 'fishai', size: 's' }),
    project('fish-onboarding', { parent: 'fishai', size: 's' }),
    project('days2meet', { system: 'code', related: ['fishai'] }),
  ],
  pages: [page('about', 'home'), page('resume', 'station'), page('contact', 'satellite')],
  includeDrafts: false,
  ...over,
});

const problemsOf = (input: UniverseInput): string[] => {
  try {
    buildUniverse(input);
  } catch (error) {
    if (error instanceof UniverseDataError) return [...error.problems];
    throw error;
  }
  return [];
};

const byId = (manifest: UniverseManifest): Map<string, ManifestBody> =>
  new Map(manifest.bodies.map((body) => [body.id, body]));

/** How far a body reaches from its own centre, its moons included. */
function footprint(manifest: UniverseManifest, body: ManifestBody): number {
  const children = manifest.bodies.filter((child) => child.parent === body.id);
  return Math.max(
    body.dockRadius,
    ...children.map((child) => (child.orbit?.radius ?? 0) + footprint(manifest, child)),
  );
}

describe('buildUniverse', () => {
  it('builds the v0.1 galaxy: home at the origin, one system, planets and moons in place', () => {
    const manifest = buildUniverse(v01());

    expect(manifest.version).toBe(1);
    expect(manifest.systems.map((entry) => entry.id)).toEqual(['home', 'code']);
    expect(manifest.systems[0]).toMatchObject({ position: [0, 0], center: 'page/about' });

    const bodies = byId(manifest);
    expect([...bodies.keys()].sort()).toEqual([
      'page/about',
      'page/contact',
      'page/resume',
      'project/canadian-fish-demo',
      'project/days2meet',
      'project/fish-onboarding',
      'project/fishai',
      'system/code',
    ]);
    expect(bodies.get('page/about')).toMatchObject({ kind: 'home', parent: null, orbit: null });
    expect(bodies.get('page/resume')).toMatchObject({ kind: 'station', parent: 'page/about' });
    expect(bodies.get('page/contact')).toMatchObject({ kind: 'satellite', parent: 'page/about' });
    expect(bodies.get('system/code')).toMatchObject({ kind: 'sun', parent: null, orbit: null });
    expect(bodies.get('project/fishai')).toMatchObject({
      kind: 'planet',
      parent: 'system/code',
      system: 'code',
      radius: L.planetRadius.l,
      flagship: true,
      href: '/projects/fishai/',
    });
    expect(bodies.get('project/fish-onboarding')).toMatchObject({
      kind: 'moon',
      parent: 'project/fishai',
      system: 'code',
      radius: L.moonRadius.s,
    });
  });

  it('never lets two docking orbits overlap, and keeps everything clear of the sun', () => {
    const manifest = buildUniverse(
      v01({
        projects: [
          ...v01().projects,
          project('alpha', { system: 'code', size: 's', date: '2025-01' }),
          project('omega', { system: 'code', size: 'l', date: '2027-01' }),
          project('omega-moon', { parent: 'omega', size: 'l', date: '2027-02' }),
        ],
      }),
    );

    for (const parent of manifest.bodies) {
      const children = manifest.bodies
        .filter((child) => child.parent === parent.id)
        .sort((a, b) => (a.orbit?.radius ?? 0) - (b.orbit?.radius ?? 0));
      if (children.length === 0) continue;

      const clearance = parent.kind === 'sun' ? L.sunRadius + L.sunClearance : parent.dockRadius;
      let edge = clearance;
      for (const child of children) {
        const radius = child.orbit?.radius ?? 0;
        const reachOfChild = footprint(manifest, child);
        expect(radius - reachOfChild, `${child.id} inner edge`).toBeGreaterThanOrEqual(edge - 0.02);
        edge = radius + reachOfChild;
      }
    }

    // A sun's own docking orbit must fit inside the clearance its planets leave.
    const sun = byId(manifest).get('system/code');
    expect(sun?.dockRadius).toBeLessThanOrEqual(L.sunRadius + L.sunClearance);
    // Every system reports a radius that really contains all of it.
    for (const entry of manifest.systems) {
      const center = byId(manifest).get(entry.center);
      expect(center && footprint(manifest, center)).toBeCloseTo(entry.radius, 1);
    }
  });

  it('orders planets by date, then id: older work orbits closer in', () => {
    const manifest = buildUniverse(
      v01({
        projects: [
          project('newer', { system: 'code', date: '2026-09' }),
          project('older', { system: 'code', date: '2024-03' }),
          project('b-same-month', { system: 'code', date: '2025-05' }),
          project('a-same-month', { system: 'code', date: '2025-05' }),
        ],
      }),
    );
    const inOrder = manifest.bodies
      .filter((body) => body.kind === 'planet')
      .sort((a, b) => (a.orbit?.radius ?? 0) - (b.orbit?.radius ?? 0))
      .map((body) => body.id);
    expect(inOrder).toEqual([
      'project/older',
      'project/a-same-month',
      'project/b-same-month',
      'project/newer',
    ]);
  });

  it('is deterministic, and does not care about the order of its input', () => {
    const input = v01();
    const shuffled: UniverseInput = {
      ...input,
      systems: [...input.systems].reverse(),
      projects: [...input.projects].reverse(),
      pages: [...input.pages].reverse(),
    };
    expect(buildUniverse(shuffled)).toEqual(buildUniverse(input));
    expect(buildUniverse(input)).toEqual(buildUniverse(input));
  });

  it('adding a newer project or a whole new system moves nothing that already exists', () => {
    const before = buildUniverse(v01());
    const after = buildUniverse(
      v01({
        systems: [...v01().systems, system('rocketry', 2, { theme: 'coral' })],
        projects: [
          ...v01().projects,
          project('brand-new', { system: 'code', date: '2026-10' }),
          project('first-rocket', { system: 'rocketry', date: '2023-04' }),
        ],
      }),
    );

    const afterBodies = byId(after);
    for (const body of before.bodies) expect(afterBodies.get(body.id)).toEqual(body);

    const afterSystems = new Map(after.systems.map((entry) => [entry.id, entry]));
    for (const entry of before.systems) {
      // A system's radius may grow when it gains a planet; its place in the galaxy may not change.
      expect(afterSystems.get(entry.id)?.position).toEqual(entry.position);
    }
  });

  it('a new moon only widens rings from its planet outwards; angles and other systems stay put', () => {
    const before = byId(buildUniverse(v01()));
    const after = byId(
      buildUniverse(
        v01({
          projects: [
            ...v01().projects,
            project('days2meet-cli', { parent: 'days2meet', size: 's', date: '2026-11' }),
          ],
        }),
      ),
    );

    // Another system is untouched.
    for (const id of ['page/about', 'page/resume', 'page/contact', 'system/code']) {
      expect(after.get(id)).toEqual(before.get(id));
    }
    // days2meet moves out so that its new moon still clears the sun, and FishAI, outside it, is
    // pushed out in turn. Both keep their angle, and FishAI's moons ride along unchanged.
    for (const id of ['project/days2meet', 'project/fishai']) {
      const [was, is] = [before.get(id), after.get(id)];
      expect(is?.orbit?.radius, id).toBeGreaterThan(was?.orbit?.radius ?? Infinity);
      expect(is?.orbit?.phase, id).toBe(was?.orbit?.phase);
    }
    expect(after.get('project/fish-onboarding')).toEqual(before.get('project/fish-onboarding'));
  });

  it('publishing the station later does not move the satellite', () => {
    const without = buildUniverse(
      v01({ pages: [page('about', 'home'), page('contact', 'satellite')] }),
    );
    const withStation = buildUniverse(v01());
    expect(byId(withStation).get('page/contact')).toEqual(byId(without).get('page/contact'));
  });

  it('draws one undirected lane per related pair, however many times it is declared', () => {
    const manifest = buildUniverse(v01());
    expect(manifest.lanes).toEqual([{ a: 'project/days2meet', b: 'project/fishai' }]);
  });

  describe('drafts', () => {
    const withDraft = (includeDrafts: boolean): UniverseInput =>
      v01({
        includeDrafts,
        projects: [
          ...v01().projects,
          project('secret', { system: 'code', draft: true, date: '2026-09', related: ['fishai'] }),
          project('secret-moon', { parent: 'secret', draft: true, size: 's', date: '2026-09' }),
          project('teaser', { system: 'code', date: '2026-09', related: ['secret'] }),
        ],
      });

    it('are left out of a production build, along with the lanes that lead to them', () => {
      const manifest = buildUniverse(withDraft(false));
      const ids = manifest.bodies.map((body) => body.id);
      expect(ids).not.toContain('project/secret');
      expect(ids).not.toContain('project/secret-moon');
      expect(ids).toContain('project/teaser');
      expect(manifest.lanes).toEqual([{ a: 'project/days2meet', b: 'project/fishai' }]);
    });

    it('are included in dev', () => {
      const manifest = buildUniverse(withDraft(true));
      const ids = manifest.bodies.map((body) => body.id);
      expect(ids).toContain('project/secret');
      expect(ids).toContain('project/secret-moon');
      expect(manifest.lanes).toContainEqual({ a: 'project/fishai', b: 'project/secret' });
      expect(manifest.lanes).toContainEqual({ a: 'project/secret', b: 'project/teaser' });
    });

    it('refuse a published moon under a draft planet, in dev as well as in production', () => {
      const input = (includeDrafts: boolean): UniverseInput =>
        v01({
          includeDrafts,
          projects: [
            project('hidden', { system: 'code', draft: true }),
            project('orphan', { parent: 'hidden', size: 's' }),
          ],
        });
      for (const includeDrafts of [true, false]) {
        expect(problemsOf(input(includeDrafts)).join('\n')).toContain(
          'project "orphan": is published, but its parent "hidden" is a draft',
        );
      }
    });
  });

  describe('validation', () => {
    it('reports every problem at once, not just the first', () => {
      const problems = problemsOf(
        v01({
          systems: [
            system('code', 1),
            system('also-first', 1),
            system('home', 2),
            system('bad', 0),
          ],
          projects: [
            project('both', { system: 'code', parent: 'planet' }),
            project('neither'),
            project('planet', { system: 'code' }),
            project('moon', { parent: 'planet' }),
            project('moon-of-moon', { parent: 'moon' }),
            project('narcissus', { parent: 'narcissus' }),
            project('lost', { system: 'nowhere' }),
            project('orphan', { parent: 'nobody' }),
            project('linker', { system: 'code', related: ['ghost', 'linker'] }),
            project('undated', { system: 'code', date: 'August 2026' }),
          ],
          pages: [page('resume', 'station'), page('cv', 'station')],
        }),
      ).join('\n');

      for (const expected of [
        'systems "also-first" and "code" both claim order 1',
        'system id "home" is reserved',
        'system "bad": order must be a whole number from 1',
        'project "both": set exactly one of "system" (a planet) or "parent" (a moon)',
        'project "neither": set exactly one of',
        'project "moon-of-moon": parent "moon" is itself a moon',
        'project "narcissus": cannot be its own parent',
        'project "lost": system "nowhere" does not exist',
        'project "orphan": parent "nobody" does not exist',
        'project "linker": related "ghost" does not exist',
        'project "linker": lists itself in "related"',
        'project "undated": date must look like "2026-08"',
        'exactly one page must have dock "home" (found 0)',
        'only one page may have dock "station" (found "resume", "cv")',
      ]) {
        expect(problems).toContain(expected);
      }
    });

    it('rejects duplicate ids', () => {
      const problems = problemsOf(
        v01({
          projects: [project('twin', { system: 'code' }), project('twin', { system: 'code' })],
        }),
      );
      expect(problems).toContain('project id "twin" is used twice');
    });

    it('fails the build when a system outgrows its allotted space', () => {
      const crowd = Array.from({ length: 12 }, (_, index) =>
        project(`big-${String(index).padStart(2, '0')}`, { system: 'code', size: 'l' }),
      );
      const problems = problemsOf(v01({ projects: crowd })).join('\n');
      expect(problems).toContain('system "code" reaches');
      expect(problems).toContain(`past the ${L.maxSystemRadius} u limit`);
    });

    it('fails the build when hand-placed systems would collide', () => {
      const problems = problemsOf(
        v01({ systems: [system('code', 1, { position: [120, 0] })] }),
      ).join('\n');
      expect(problems).toContain('systems "home" and "code" are 120 u apart but need');
    });
  });
});
