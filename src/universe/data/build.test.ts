import { describe, expect, it } from 'vitest';
import { tuning } from '../design/tuning';
import { bodyPositions, createOrbitTable } from '../sim/orbits';
import { buildUniverse as buildWithReach, UniverseDataError } from './build';
import { binaryOrbits, orbitPhase, round, slotPosition } from './layout';
import type {
  LinkInput,
  ManifestBody,
  PageInput,
  ProjectInput,
  SystemInput,
  UniverseInput,
  UniverseManifest,
} from './types';

/**
 * The fixtures are made-up galaxies under real ids (FishAI a planet, not a moon): none of their
 * bodies is an emblem world, so none has a declared reach (design/worlds/reach.ts).
 */
const buildUniverse = (input: Parameters<typeof buildWithReach>[0]) => buildWithReach(input, {});

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

const link = (id: string, slot: number, over: Partial<LinkInput> = {}): LinkInput => ({
  id,
  title: id,
  href: `https://${id}.example/someone`,
  slot,
  ...over,
});

/** A sun of a binary star: a name and a page, no place or colours of its own. */
const sunOf = (id: string, over: Partial<SystemInput> = {}): SystemInput => ({
  id,
  name: id[0]?.toUpperCase() + id.slice(1),
  href: `/systems/${id}/`,
  position: 'auto',
  ...over,
});

/**
 * Projects, a binary star in slot 1: Software (primary) and Hardware, with the families Allen's
 * tree gives them, less the planned Fish Online, so that the numbers pinned below stay those of
 * the first build. The whole tree, Fish Online in, reaches 401.6 u: `allensTree` below, and the
 * test that it has room.
 */
const binary = (over: Partial<UniverseInput> = {}): UniverseInput => ({
  systems: [
    system('projects', 1, { suns: ['software', 'hardware'], href: '/projects/' }),
    sunOf('software'),
    sunOf('hardware'),
  ],
  projects: [
    project('cyberpatriot', { system: 'software', date: '2022-09' }),
    project('canadian-fish-demo', { system: 'software' }),
    project('fishai', { parent: 'canadian-fish-demo', size: 'l', flagship: true }),
    project('fish-onboarding', { parent: 'canadian-fish-demo', size: 's' }),
    project('days2meet', { system: 'software', related: ['fishai'] }),
    project('model-rocketry', { system: 'hardware', date: '2023-07' }),
    project('robotics', { system: 'hardware', date: '2023-07' }),
  ],
  pages: [page('about', 'home'), page('resume', 'station'), page('contact', 'satellite')],
  projectsHref: '/projects/',
  includeDrafts: false,
  ...over,
});

/** Allen's whole tree of 2026-09-30 in the binary: binary() and the planned Fish Online. */
const allensTree = (extra: ProjectInput[] = []): UniverseInput =>
  binary({
    projects: [
      ...binary().projects,
      project('fish-online', {
        parent: 'canadian-fish-demo',
        size: 's',
        date: undefined,
        planned: true,
      }),
      ...extra,
    ],
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

    expect(manifest.version).toBe(2);
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

  it('sizes an emblem world’s solid by its declared reach, and leaves its ring where it was', () => {
    const plain = byId(buildUniverse(v01()));
    const reach = { 'page/about': 1.57, 'project/days2meet': 1.19, 'page/resume': 1 };
    const drawn = byId(buildWithReach(v01(), reach));
    const about = drawn.get('page/about');
    expect(about?.solidRadius).toBe(Math.ceil(L.home.planetRadius * 1.57 * 100 - 1e-6) / 100);
    expect(drawn.get('project/days2meet')?.solidRadius).toBe(
      Math.ceil(L.planetRadius.m * 1.19 * 100 - 1e-6) / 100,
    );
    // A reach of 1 is its radius: nothing to say. And nothing else moves.
    expect(drawn.get('page/resume')).not.toHaveProperty('solidRadius');
    expect(drawn.get('project/fishai')).not.toHaveProperty('solidRadius');
    for (const [id, body] of drawn) {
      const rest: Partial<typeof body> = { ...body };
      delete rest.solidRadius;
      expect(rest, id).toEqual(plain.get(id));
    }
  });

  it('rounds a solid UP to the hundredth, never inside what is drawn', () => {
    // The station: 2.2 u x 1.12 is 2.464 u, which the nearest hundredth would put inside it.
    const drawn = byId(buildWithReach(v01(), { 'page/resume': 1.12 }));
    expect(drawn.get('page/resume')?.solidRadius).toBe(2.47);
    expect(L.home.stationRadius * 1.12).toBeCloseTo(2.464, 9);
  });

  it('gives a body that a recipe takes off its rows no reach of theirs', () => {
    // design/worlds.ts comes first (world/looks.ts, lookOf): drawn as the recipe says, its
    // surface is its radius, and the ship does not bounce off the rows it no longer wears.
    const reach = { 'page/about': 1.57, 'project/days2meet': 1.19 };
    const drawn = byId(buildWithReach(v01(), reach, { 'page/about': { biome: 'frost' } }));
    expect(drawn.get('page/about')).not.toHaveProperty('solidRadius');
    expect(drawn.get('project/days2meet')?.solidRadius).toBeGreaterThan(L.planetRadius.m);
  });

  it('refuses a reach whose cushion would not fit under the docking ring, and says what to do', () => {
    // A planet's ring is 1.4 radii and the cushion's depth out: no room for 1.5.
    expect(() => buildWithReach(v01(), { 'project/days2meet': 1.5 })).toThrow(
      /"project\/days2meet" reaches 1\.5 radii .*has room for 1\.4.*its docking ring.*recipe/,
    );
    expect(() => buildWithReach(v01(), { 'project/days2meet': 1.4 })).not.toThrow();
  });

  it('shows the projects index from the sun of the first system, when there is one', () => {
    expect(buildUniverse(v01()).alsoAt).toEqual({});
    const listed = v01({
      systems: [system('rocketry', 2), system('code', 1)],
      projectsHref: '/projects/',
    });
    expect(buildUniverse(listed).alsoAt).toEqual({ '/projects/': 'system/code' });
    expect(
      buildUniverse(v01({ systems: [], projects: [], projectsHref: '/projects/' })).alsoAt,
    ).toEqual({});
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

  it('puts planned work without a date outermost, and moves it in once it has one', () => {
    const rings = (projects: ProjectInput[]): string[] =>
      buildUniverse(v01({ projects }))
        .bodies.filter((body) => body.kind === 'planet')
        .sort((a, b) => (a.orbit?.radius ?? 0) - (b.orbit?.radius ?? 0))
        .map((body) => body.id);
    const built = [
      project('newer', { system: 'code', date: '2026-09' }),
      project('older', { system: 'code', date: '2024-03' }),
    ];
    expect(
      rings([...built, project('a-someday', { system: 'code', date: undefined, planned: true })]),
    ).toEqual(['project/older', 'project/newer', 'project/a-someday']);
    expect(
      rings([...built, project('a-someday', { system: 'code', date: '2025-01', planned: true })]),
    ).toEqual(['project/older', 'project/a-someday', 'project/newer']);
  });

  it('marks planned work in the manifest, and only planned work', () => {
    const { bodies } = buildUniverse(
      v01({
        projects: [
          project('built', { system: 'code', date: '2026-09' }),
          project('someday', { system: 'code', date: undefined, planned: true }),
        ],
      }),
    );
    expect(bodies.find((body) => body.id === 'project/someday')?.planned).toBe(true);
    // Absent, not false, on everything else: a manifest without planned work is unchanged.
    expect(bodies.filter((body) => 'planned' in body).map((body) => body.id)).toEqual([
      'project/someday',
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

  it('builds the galaxy of 2026-09-30 byte for byte: one-sun systems as before binaries, Code in its moved slot', () => {
    // src/content as it stood (one solar system, Code), and /universe.json exactly as it was
    // served: JSON.stringify keeps the order of keys, so this is the file, byte for byte. A
    // galaxy of one-sun systems is built by the same code as before binaries (buildFamily). If
    // this fails, every body of today's galaxy has moved: meant only with the layout
    // (docs/PLAN.md §5.4), as layout.test's PINNED. One value differs from the file as served
    // before 2026-09-30, and on purpose: Code's position, from (-431.34, 431.34) to
    // (-487.9, 487.9), when the slots made room for a binary star (tuning.layout, homeRoom and
    // slotRoom). Everything else, down to the last ring, is as it was. Since then the relays have
    // joined it (GitHub and LinkedIn on the satellite's ring, in manifest version 2), and moved
    // nothing.
    const today: UniverseInput = {
      systems: [system('code', 1, { name: 'Code' })],
      projects: [
        project('fishai', { title: 'FishAI', system: 'code', size: 'l', biome: 'tide' }),
        project('canadian-fish-demo', { title: 'Canadian Fish', parent: 'fishai', size: 's' }),
        project('fish-onboarding', {
          title: 'Fish Onboarding',
          parent: 'fishai',
          size: 's',
          biome: 'dune',
        }),
        project('days2meet', { title: 'Days2Meet', system: 'code' }),
      ].map((entry) => ({
        ...entry,
        rings: entry.id === 'fishai',
        flagship: entry.id === 'fishai',
      })),
      pages: [
        { id: 'about', title: 'About', href: '/about/', dock: 'home' },
        { id: 'contact', title: 'Contact', href: '/contact/', dock: 'satellite' },
        { id: 'resume', title: 'Resume', href: '/resume/', dock: 'station' },
      ],
      links: [
        { id: 'github', title: 'GitHub', href: 'https://github.com/MeagerPotato', slot: 2 },
        {
          id: 'linkedin',
          title: 'LinkedIn',
          href: 'https://www.linkedin.com/in/allenkhsieh',
          slot: 4,
        },
      ],
      projectsHref: '/projects/',
      includeDrafts: false,
    };
    const served = {
      version: 2,
      systems: [
        {
          id: 'home',
          name: 'Home',
          theme: 'butter',
          position: [0, 0],
          radius: 66.2,
          center: 'page/about',
        },
        {
          id: 'code',
          name: 'Code',
          theme: 'sky',
          position: [-487.9, 487.9],
          radius: 202.6,
          center: 'system/code',
        },
      ],
      bodies: [
        {
          id: 'page/about',
          kind: 'home',
          title: 'About',
          href: '/about/',
          system: 'home',
          parent: null,
          radius: 14,
          dockRadius: 26.6,
          orbit: null,
          seed: 'about',
          biome: 'terra',
        },
        {
          id: 'page/resume',
          kind: 'station',
          title: 'Resume',
          href: '/resume/',
          system: 'home',
          parent: 'page/about',
          radius: 2.2,
          dockRadius: 8.2,
          orbit: { radius: 38.8, phase: 3.3143, periodSec: 124.8 },
          seed: 'resume',
        },
        {
          id: 'page/contact',
          kind: 'satellite',
          title: 'Contact',
          href: '/contact/',
          system: 'home',
          parent: 'page/about',
          radius: 1.6,
          dockRadius: 7.6,
          orbit: { radius: 58.6, phase: 3.18, periodSec: 231.6 },
          seed: 'contact',
        },
        {
          id: 'link/github',
          kind: 'link',
          title: 'GitHub',
          href: 'https://github.com/MeagerPotato',
          system: 'home',
          parent: 'page/about',
          radius: 1.4,
          dockRadius: 7.4,
          orbit: { radius: 58.6, phase: 4.7508, periodSec: 231.6 },
          seed: 'link/github',
          docks: false,
        },
        {
          id: 'link/linkedin',
          kind: 'link',
          title: 'LinkedIn',
          href: 'https://www.linkedin.com/in/allenkhsieh',
          system: 'home',
          parent: 'page/about',
          radius: 1.4,
          dockRadius: 7.4,
          orbit: { radius: 58.6, phase: 0.0384, periodSec: 231.6 },
          seed: 'link/linkedin',
          docks: false,
        },
        {
          id: 'system/code',
          kind: 'sun',
          title: 'Code',
          href: '/systems/code/',
          system: 'code',
          parent: null,
          radius: 20,
          dockRadius: 38,
          orbit: null,
          seed: 'code',
        },
        {
          id: 'project/days2meet',
          kind: 'planet',
          title: 'Days2Meet',
          href: '/projects/days2meet/',
          system: 'code',
          parent: 'system/code',
          radius: 8,
          dockRadius: 15.2,
          orbit: { radius: 60.2, phase: 1.6094, periodSec: 241.2 },
          seed: 'days2meet',
          biome: 'terra',
          rings: false,
          decorMoons: 0,
          flagship: false,
        },
        {
          id: 'project/fishai',
          kind: 'planet',
          title: 'FishAI',
          href: '/projects/fishai/',
          system: 'code',
          parent: 'system/code',
          radius: 12,
          dockRadius: 22.8,
          orbit: { radius: 143, phase: 5.5, periodSec: 883.1 },
          seed: 'fishai',
          biome: 'tide',
          rings: true,
          decorMoons: 0,
          flagship: true,
        },
        {
          id: 'project/canadian-fish-demo',
          kind: 'moon',
          title: 'Canadian Fish',
          href: '/projects/canadian-fish-demo/',
          system: 'code',
          parent: 'project/fishai',
          radius: 1.2,
          dockRadius: 7.2,
          orbit: { radius: 34, phase: 2.9899, periodSec: 102.4 },
          seed: 'canadian-fish-demo',
          biome: 'terra',
          rings: false,
          decorMoons: 0,
          flagship: false,
        },
        {
          id: 'project/fish-onboarding',
          kind: 'moon',
          title: 'Fish Onboarding',
          href: '/projects/fish-onboarding/',
          system: 'code',
          parent: 'project/fishai',
          radius: 1.2,
          dockRadius: 7.2,
          orbit: { radius: 52.4, phase: 2.0076, periodSec: 195.9 },
          seed: 'fish-onboarding',
          biome: 'dune',
          rings: false,
          decorMoons: 0,
          flagship: false,
        },
      ],
      lanes: [],
      alsoAt: { '/projects/': 'system/code' },
    };
    expect(JSON.stringify(buildUniverse(today))).toBe(JSON.stringify(served));
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

  describe("links: profiles elsewhere, as relays on the satellite's ring", () => {
    const LINKS = [link('github', 2), link('linkedin', 4)];

    it("puts each on its slot: the satellite's radius and period, k eighths of a turn ahead", () => {
      const bodies = byId(buildUniverse(v01({ links: LINKS })));
      const satellite = bodies.get('page/contact');
      if (!satellite?.orbit) throw new Error('fixture');
      for (const { id, slot } of LINKS) {
        const relay = bodies.get(`link/${id}`);
        expect(relay).toMatchObject({
          kind: 'link',
          title: id,
          href: `https://${id}.example/someone`,
          system: 'home',
          parent: 'page/about',
          radius: L.home.relayRadius,
          docks: false,
          seed: `link/${id}`,
        });
        expect(relay?.orbit?.radius).toBe(satellite.orbit.radius);
        expect(relay?.orbit?.periodSec).toBe(satellite.orbit.periodSec);
        const ahead = (relay?.orbit?.phase ?? 0) - satellite.orbit.phase;
        const turns = ahead / (2 * Math.PI) - slot / 8;
        expect(Math.abs(turns - Math.round(turns))).toBeLessThan(1e-4);
      }
      // Every other body can be docked at, and says nothing about it.
      for (const body of bodies.values()) {
        if (body.kind !== 'link') expect(body).not.toHaveProperty('docks');
      }
    });

    it('never reaches past the satellite, so the home system is exactly as big as it was', () => {
      const without = buildUniverse(v01());
      const withLinks = buildUniverse(
        v01({ links: [1, 2, 3, 4, 5, 6, 7].map((slot) => link(`net${slot}`, slot)) }),
      );
      expect(withLinks.systems).toEqual(without.systems);
      const satellite = byId(withLinks).get('page/contact');
      for (const relay of withLinks.bodies.filter((body) => body.kind === 'link')) {
        expect(relay.dockRadius).toBeLessThanOrEqual(satellite?.dockRadius ?? 0);
      }
    });

    it('adding one (Devpost, one day) moves nothing that is already there', () => {
      const before = buildUniverse(v01({ links: LINKS }));
      const after = buildUniverse(v01({ links: [...LINKS, link('devpost', 6)] }));
      const was = byId(before);
      const is = byId(after);
      for (const [id, body] of was) expect(is.get(id), id).toEqual(body);
      expect([...is.keys()].filter((id) => !was.has(id))).toEqual(['link/devpost']);
      expect(after.systems).toEqual(before.systems);
    });

    it('keeps its place whether or not the Contact page exists yet', () => {
      const without = buildUniverse(
        v01({ pages: [page('about', 'home'), page('resume', 'station')], links: LINKS }),
      );
      expect(byId(without).get('link/github')).toEqual(
        byId(buildUniverse(v01({ links: LINKS }))).get('link/github'),
      );
    });

    it("refuses a slot that is taken, off the ring, or the satellite's, and a link that is not https", () => {
      const problems = problemsOf(
        v01({
          links: [
            link('github', 2),
            link('gitlab', 2),
            link('zero', 0),
            link('eight', 8),
            link('half', 2.5),
            link('plain', 3, { href: 'http://plain.example/' }),
            link('local', 5, { href: '/about/' }),
            link('github', 7),
          ],
        }),
      );
      for (const expected of [
        'link id "github" is used twice',
        'link "gitlab": slot 2 is taken by "github"',
        'link "zero": slot must be 1 to 7 (0 is the Contact satellite)',
        'link "eight": slot must be 1 to 7 (0 is the Contact satellite)',
        'link "half": slot must be 1 to 7 (0 is the Contact satellite)',
        'link "plain": href must be an https URL on another site',
        'link "local": href must be an https URL on another site',
      ]) {
        expect(problems).toContain(expected);
      }
    });

    it('refuses a relay made bigger than the satellite, whose ring it shares', () => {
      const home = L.home as { relayRadius: number };
      const was = home.relayRadius;
      try {
        home.relayRadius = L.home.satelliteRadius + 0.5;
        const problems = problemsOf(v01({ links: LINKS })).join('\n');
        expect(problems).toContain('tuning.layout.home.relayRadius is 2.1 u');
        expect(problems).toContain("must fit within the satellite's (7.6 u)");
        // Without a link there is nothing to refuse.
        expect(problemsOf(v01())).toEqual([]);
      } finally {
        home.relayRadius = was;
      }
    });
  });

  it('draws one undirected lane per related pair, however many times it is declared', () => {
    const manifest = buildUniverse(v01());
    expect(manifest.lanes).toEqual([{ a: 'project/days2meet', b: 'project/fishai' }]);
  });

  describe('binary stars', () => {
    const manifest = buildUniverse(binary());
    const bodies = byId(manifest);
    const get = (id: string): ManifestBody => {
      const body = bodies.get(id);
      if (!body) throw new Error(`no body ${id}`);
      return body;
    };
    /** A body and everything round it, down the parent chain. */
    const familyOf = (root: string, from = manifest): ManifestBody[] => {
      const children = from.bodies.filter((body) => body.parent === root);
      return [
        ...from.bodies.filter((body) => body.id === root),
        ...children.flatMap((child) => familyOf(child.id, from)),
      ];
    };
    const HOME_BODIES = ['page/about', 'page/resume', 'page/contact'];

    it('turns two suns round one empty centre, opposite each other, with one period', () => {
      const [software, hardware] = [get('system/software'), get('system/hardware')];
      // Each family reaches as far from its sun as a system of its own would (231 u and 113.8 u).
      const [ra, rb] = [footprint(manifest, software), footprint(manifest, hardware)];
      expect(ra).toBeCloseTo(231, 1);
      expect(rb).toBeCloseTo(113.8, 1);
      const pair = binaryOrbits(ra, rb);

      for (const [sun, name] of [
        [software, 'Software'],
        [hardware, 'Hardware'],
      ] as const) {
        expect(sun).toMatchObject({ kind: 'sun', title: name, parent: null, system: 'projects' });
        expect(sun.orbit?.periodSec).toBe(round(pair.periodSec, 1));
      }
      // The primary, the bigger family's sun here, circles closer in: each family then reaches
      // equally far from the centre.
      expect(software.orbit?.radius).toBeCloseTo(rb + L.binaryGap / 2, 1);
      expect(hardware.orbit?.radius).toBeCloseTo(ra + L.binaryGap / 2, 1);
      expect([software.orbit?.radius, hardware.orbit?.radius]).toEqual([133.8, 251]);
      // Opposite for ever: the same period, and phases half a turn apart (to the 4 places kept).
      const phase = software.orbit?.phase ?? NaN;
      expect(phase).toBe(round(orbitPhase('system/projects'), 4));
      expect(Math.abs((hardware.orbit?.phase ?? NaN) - phase - Math.PI)).toBeLessThanOrEqual(1e-4);

      // The binary is one system, one slot, with no body at its centre.
      expect(manifest.systems.map((entry) => entry.id)).toEqual(['home', 'projects']);
      const [x, z] = slotPosition(1);
      expect(manifest.systems[1]).toEqual({
        id: 'projects',
        name: 'projects',
        theme: 'sky',
        position: [round(x), round(z)],
        radius: round(pair.reach),
        center: 'system/software',
      });
      expect(bodies.has('system/projects')).toBe(false);
      // Every body of both families is filed under the binary: it owns the slot they orbit in.
      for (const body of manifest.bodies) {
        if (!HOME_BODIES.includes(body.id)) expect(body.system, body.id).toBe('projects');
      }
      expect(get('project/robotics').parent).toBe('system/hardware');
      expect(get('project/fishai')).toMatchObject({
        kind: 'moon',
        parent: 'project/canadian-fish-demo',
      });
    });

    it('lays out each family round its sun exactly as a system of its own would be', () => {
      const alone = buildUniverse(
        binary({
          systems: [system('software', 1, { name: 'Software' })],
          projects: binary().projects.filter(
            (entry) => !['model-rocketry', 'robotics'].includes(entry.id),
          ),
        }),
      );
      const own = familyOf('system/software', alone);
      expect(own.map((body) => body.id)).toEqual(
        familyOf('system/software').map((body) => body.id),
      );
      for (const body of own.slice(1)) {
        expect(get(body.id), body.id).toEqual({ ...body, system: 'projects' });
      }
    });

    it('keeps the two families apart, and inside the binary, however far they have turned', () => {
      const orbits = createOrbitTable(manifest.systems, manifest.bodies);
      const positions = new Float64Array(orbits.count * 2);
      const at = (id: string): [number, number] => {
        const i = orbits.indexOf(id);
        return [positions[i * 2] ?? NaN, positions[i * 2 + 1] ?? NaN];
      };
      const [a, b] = [familyOf('system/software'), familyOf('system/hardware')];
      const binarySystem = manifest.systems[1];
      const [cx, cz] = binarySystem?.position ?? [NaN, NaN];

      // Whatever the phases: each family's docking rings, all the way round every orbit, stay
      // within its footprint of its sun, and the suns are opposite, so where the two footprints
      // face each other they are exactly the gap apart (to the 2 places positions are kept).
      const [software, hardware] = [get('system/software'), get('system/hardware')];
      const facing =
        (software.orbit?.radius ?? NaN) +
        (hardware.orbit?.radius ?? NaN) -
        footprint(manifest, software) -
        footprint(manifest, hardware);
      expect(facing).toBeGreaterThanOrEqual(L.binaryGap - 0.05);
      expect(facing).toBeLessThanOrEqual(L.binaryGap + 0.05);

      for (const t of [0, 1000, 5000]) {
        bodyPositions(orbits, t, positions);
        // And sampled where the bodies really are: no two of different families come closer,
        // docking ring to docking ring, than the gap.
        let closest = Infinity;
        for (const one of a) {
          for (const other of b) {
            const [x1, z1] = at(one.id);
            const [x2, z2] = at(other.id);
            closest = Math.min(
              closest,
              Math.hypot(x1 - x2, z1 - z2) - one.dockRadius - other.dockRadius,
            );
          }
        }
        expect(closest, `t = ${t}`).toBeGreaterThanOrEqual(L.binaryGap - 0.05);
        // And nothing of either reaches past the binary's radius: the map and the gap check to
        // the neighbours can trust it.
        for (const body of [...a, ...b]) {
          const [x, z] = at(body.id);
          expect(
            Math.hypot(x - cx, z - cz) + body.dockRadius,
            `${body.id} at ${t}`,
          ).toBeLessThanOrEqual((binarySystem?.radius ?? 0) + 0.05);
        }
        // The suns stay the same distance apart.
        const [sx, sz] = at('system/software');
        const [hx, hz] = at('system/hardware');
        expect(Math.hypot(sx - hx, sz - hz)).toBeCloseTo(133.8 + 251, 2);
      }
    });

    it('is shown from its primary sun, the first it lists, whatever the families weigh', () => {
      expect(manifest.alsoAt).toEqual({ '/projects/': 'system/software' });
      const swapped = buildUniverse(
        binary({
          systems: [
            system('projects', 1, { suns: ['hardware', 'software'] }),
            sunOf('software'),
            sunOf('hardware'),
          ],
        }),
      );
      expect(swapped.systems[1]?.center).toBe('system/hardware');
      expect(swapped.alsoAt).toEqual({ '/projects/': 'system/hardware' });
      // The orbits follow the families, not the order: the bigger one still circles closer in.
      expect(byId(swapped).get('system/software')?.orbit?.radius).toBe(133.8);
    });

    it('is deterministic, and does not care about the order of its input', () => {
      const input = binary();
      const shuffled: UniverseInput = {
        ...input,
        systems: [...input.systems].reverse(),
        projects: [...input.projects].reverse(),
        pages: [...input.pages].reverse(),
      };
      expect(JSON.stringify(buildUniverse(shuffled))).toBe(JSON.stringify(buildUniverse(input)));
    });

    it('moves the other sun and the period when one family grows, and nothing outside the binary', () => {
      // The one exception to "adding a project moves nothing" (data/layout.ts): each sun circles
      // at a radius set by the OTHER family's reach, and the pair's period by both. Their angles at
      // t = 0 stay, and so does every body's orbit round its own sun or planet, and everything
      // outside the binary. (Room to grow: 364.8 u, and 403.2 with the new planet, of 460.)
      const withResearch = (extra: ProjectInput[]): UniverseInput =>
        binary({
          systems: [...binary().systems, system('research', 2, { theme: 'lilac' })],
          projects: [
            ...binary().projects,
            project('sports-analysis', { system: 'research' }),
            ...extra,
          ],
        });
      const before = buildUniverse(withResearch([]));
      const after = buildUniverse(withResearch([project('arc', { system: 'hardware' })]));
      const [was, is] = [byId(before), byId(after)];

      for (const id of ['system/software', 'system/hardware']) {
        const [then, now] = [was.get(id)?.orbit, is.get(id)?.orbit];
        expect(now?.phase, id).toBe(then?.phase);
        expect(now?.periodSec, id).toBeGreaterThan(then?.periodSec ?? Infinity);
      }
      // Hardware's family reaches further, so Software's sun circles further out; Hardware's
      // own sun keeps its distance, which Software's family sets.
      expect(is.get('system/software')?.orbit?.radius).toBeGreaterThan(
        was.get('system/software')?.orbit?.radius ?? Infinity,
      );
      expect(is.get('system/hardware')?.orbit?.radius).toBe(
        was.get('system/hardware')?.orbit?.radius,
      );

      const suns = new Set(['system/software', 'system/hardware', 'project/arc']);
      for (const body of before.bodies) {
        if (!suns.has(body.id)) expect(is.get(body.id), body.id).toEqual(body);
      }
      expect(after.systems[1]?.position).toEqual(before.systems[1]?.position);
      expect(after.systems[1]?.radius).toBeGreaterThan(before.systems[1]?.radius ?? Infinity);
      expect(after.systems[2]).toEqual(before.systems[2]);
    });

    it("has room for Allen's tree and any one more planet or moon under either sun, not two", () => {
      // What tuning.layout.maxSystemRadius (460) was chosen for, and the slots sized from it
      // (docs/PLAN.md §5.4): the tree builds, and so does the tree with any single addition,
      // whatever its size and wherever it goes. The largest, a planet of size l, reaches 455.2 u.
      expect(problemsOf(allensTree())).toEqual([]);
      expect(buildUniverse(allensTree()).systems[1]?.radius).toBe(401.6);
      const planets = (['software', 'hardware'] as const).flatMap((sun) =>
        (['s', 'm', 'l'] as const).map((size) =>
          project(`new-${size}-planet`, { system: sun, size, date: '2026-12' }),
        ),
      );
      const moons = [
        'cyberpatriot',
        'canadian-fish-demo',
        'days2meet',
        'model-rocketry',
        'robotics',
      ].flatMap((parent) =>
        (['s', 'm', 'l'] as const).map((size) => project(`new-${size}-moon`, { parent, size })),
      );
      for (const extra of [...planets, ...moons]) {
        const where = `${extra.id} round ${extra.system ?? extra.parent}`;
        expect(problemsOf(allensTree([extra])), where).toEqual([]);
      }
      const largest = project('new-l-planet', { system: 'hardware', size: 'l', date: '2026-12' });
      expect(buildUniverse(allensTree([largest])).systems[1]?.radius).toBe(455.2);

      // And the two smallest additions there are, a planet of size s under each sun, trip it.
      expect(
        problemsOf(
          allensTree([
            project('new-s-planet', { system: 'software', size: 's', date: '2026-12' }),
            project('other-s-planet', { system: 'hardware', size: 's', date: '2026-12' }),
          ]),
        ),
      ).toEqual([
        expect.stringContaining(
          'binary "projects" reaches 461.6 u (Software 297.8, Hardware 143.8, 40 apart), past the 460 u limit',
        ),
      ]);
    });

    it('fails the build, naming both families, when it outgrows its slot', () => {
      // Allen's tree with two moons more round Model Rocketry.
      const crowded = allensTree([
        project('payload', { parent: 'model-rocketry', size: 's' }),
        project('recovery', { parent: 'model-rocketry', size: 's' }),
      ]);
      expect(problemsOf(crowded)).toContain(
        `binary "projects" reaches 475.2 u (Software 267.8, Hardware 187.4, 40 apart), past the ` +
          `${L.maxSystemRadius} u limit: it would crowd its neighbours. Move a project to another ` +
          'system, turn one into a moon, or revisit tuning.layout (a new limit moves every ' +
          'system: docs/PLAN.md §5.4).',
      );
    });

    it('checks how binaries and their suns name each other, and lists every problem at once', () => {
      const problems = problemsOf(
        binary({
          systems: [
            system('projects', 1, { suns: ['software', 'hardware'] }),
            sunOf('software'),
            sunOf('hardware', { order: 5, theme: 'coral', position: [900, 900] }),
            sunOf('stray'),
            system('twins', 2, { suns: ['software', 'software'] }),
            system('selfish', 3, { suns: ['selfish', 'ghost'] }),
            system('nested', 4, { suns: ['projects', 'twins'] }),
            sunOf('unslotted', { theme: 'mint', suns: ['ghost-a', 'ghost-b'] }),
            system('pale', 6, { theme: undefined }),
          ],
          projects: [...binary().projects, project('odd-one', { system: 'projects' })],
        }),
      );
      for (const expected of [
        'system "stray" has no order and no binary lists it: give it an order (its place in the galaxy), or list it in a binary\'s suns',
        'binary "selfish": sun "ghost" does not exist',
        'binary "twins": lists "software" twice',
        'binary "selfish": lists itself',
        'binary "nested": sun "projects" is itself a binary',
        'binary "nested": sun "twins" is itself a binary',
        'system "hardware" is listed as a sun by "projects", so it goes where "projects" goes: leave out its order',
        'system "hardware" is listed as a sun by "projects", so it goes where "projects" goes: leave out its position',
        'system "software" is listed as a sun by both "projects" and "twins"',
        'project "odd-one": "projects" is a binary star; its planets orbit one of its suns: set system to "software" or "hardware"',
        'binary "unslotted": needs an order, its place in the galaxy',
        'system "pale": needs a theme, its colour family',
      ]) {
        expect(problems).toContain(expected);
      }
      // A family of its own is a sun's to wear.
      expect(problems.join('\n')).not.toMatch(/leave out its theme/);
    });

    it('lets a sun of a binary wear a colour family of its own, and says so in the manifest', () => {
      const own = buildUniverse(
        binary({
          systems: binary().systems.map((entry) =>
            entry.id === 'hardware' ? { ...entry, theme: 'coral' as const } : entry,
          ),
        }),
      );
      const suns = byId(own);
      expect(suns.get('system/hardware')?.theme).toBe('coral');
      // Without one it wears its binary's, and the manifest says nothing.
      expect(suns.get('system/software')).not.toHaveProperty('theme');
      expect(own.systems.find((entry) => entry.id === 'projects')?.theme).toBe(
        binary().systems[0]?.theme,
      );
      // A colour moves nothing: every body is where it was.
      for (const body of own.bodies) {
        const rest: Partial<ManifestBody> = { ...body };
        delete rest.theme;
        expect(rest, body.id).toEqual(bodies.get(body.id));
      }
    });
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
            project('no-date', { system: 'code', date: undefined }),
            project('planned-no-date', { system: 'code', date: undefined, planned: true }),
          ],
          pages: [page('resume', 'station'), page('cv', 'station')],
        }),
      ).join('\n');

      expect(problems).not.toContain('project "planned-no-date"');
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
        'project "no-date": a date is required unless it is planned',
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

  describe('a system placed by hand beside the honeycomb', () => {
    // Slot 5's pocket, drawn in along the line to home: 776.9 u from the centres of slots 1 and 3,
    // which leaves a system here room to reach 165.9 u (data/layout.ts, handPlace).
    const DRAWN_IN: [number, number] = [218, 813];
    const galaxy = (research: Partial<SystemInput>, extra: ProjectInput[] = []): UniverseInput =>
      v01({
        systems: [
          system('code', 1),
          system('hackathons', 3),
          system('research', 5, { position: DRAWN_IN, ...research }),
        ],
        projects: [
          ...v01().projects,
          project('cal-hacks', { system: 'hackathons' }),
          project('sports-analysis', { system: 'research', planned: true, date: undefined }),
          ...extra,
        ],
      });
    const bigPlanets = (count: number): ProjectInput[] =>
      Array.from({ length: count }, (_, index) =>
        project(`question-${index}`, { system: 'research', size: 'l' }),
      );

    it('stands where its file says, and moves nothing else', () => {
      const manifest = buildUniverse(galaxy({}));
      const at = new Map(manifest.systems.map((entry) => [entry.id, entry.position]));
      expect(at.get('research')).toEqual(DRAWN_IN);
      expect(at.get('code')).toEqual(slotPosition(1).map((value) => round(value)));
      expect(at.get('hackathons')).toEqual(slotPosition(3).map((value) => round(value)));
      // The same galaxy with Research on its slot's centre: only Research is somewhere else.
      const centred = buildUniverse(galaxy({ position: 'auto' }));
      for (const entry of centred.systems) {
        if (entry.id === 'research') {
          expect(entry.position).toEqual(slotPosition(5).map((value) => round(value)));
        } else expect(entry.position, entry.id).toEqual(at.get(entry.id));
      }
      const others = (from: UniverseManifest): ManifestBody[] =>
        from.bodies.filter((body) => body.system !== 'research');
      expect(others(manifest)).toEqual(others(centred));
    });

    it('fails the build when it outgrows the room its place has, and says where the room is', () => {
      const roomy = buildUniverse(galaxy({}, bigPlanets(1)));
      const reach = roomy.systems.find((entry) => entry.id === 'research')?.radius ?? NaN;
      expect(reach).toBeLessThanOrEqual(165.93);
      const problems = problemsOf(galaxy({}, bigPlanets(3)));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('system "research" is placed by hand at (218, 813)');
      expect(problems[0]).toContain('776.93 u from the centre of slot 3');
      expect(problems[0]).toContain('it has room to reach 165.93 u, and it reaches');
      expect(problems[0]).toContain('towards the centre of its own slot 5 at (319.33, 1191.76)');
      expect(problems[0]).toContain('No other system moves either way');
      // On its slot's centre the same system has all the room the build gives any system.
      expect(problemsOf(galaxy({ position: 'auto' }, bigPlanets(3)))).toEqual([]);
    });

    it('fails the build when the place lies in the room of a slot that is not its own', () => {
      // The same place under order 2: slot 5's centre is 392 u away, and whoever takes that slot
      // later may be 460 u across.
      const problems = problemsOf(galaxy({ order: 2 }));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('392.08 u from the centre of slot 5');
      expect(problems[0]).toContain('it has no room at all');
      expect(problems[0]).toContain('towards the centre of its own slot 2 at (-178.59, -666.49)');
    });

    it('fails the build when the place is too far out for the build to vouch for', () => {
      // Slot 21 is 2,780 u from the hub: a place by hand out there could crowd slots the build
      // does not measure against (it keeps the first 24), so it is refused, however much room
      // it has; on its slot's centre, with no position, the same system is built.
      const [x, z] = slotPosition(21).map((value) => round(value)) as [number, number];
      const problems = problemsOf(galaxy({ order: 21, position: [x, z] }));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(`system "research" is placed by hand at (${x}, ${z})`);
      expect(problems[0]).toContain('u from the hub of the honeycomb (slot 1)');
      expect(problems[0]).toContain('only within 1700 u of it');
      expect(problems[0]).toContain('the centre of its own slot 21');
      expect(problemsOf(galaxy({ order: 21, position: 'auto' }))).toEqual([]);
    });

    it('is held to it whether or not anything stands in the other slot yet', () => {
      // No Hackathons: slot 3 is empty, and still promised to whoever comes.
      const input = galaxy({}, bigPlanets(3));
      const alone: UniverseInput = {
        ...input,
        systems: input.systems.filter((entry) => entry.id !== 'hackathons'),
        projects: input.projects.filter((entry) => entry.system !== 'hackathons'),
      };
      expect(problemsOf(alone).join(' ')).toContain('776.93 u from the centre of slot 3');
    });

    it('answers to the tripwire alone in a galaxy with no system on the honeycomb', () => {
      // Every system placed by hand (the journeys harness trying another formula): there are no
      // slots to keep promises to, only neighbours to keep clear of.
      const input = galaxy({ order: 2 }, bigPlanets(3));
      const byHand: UniverseInput = {
        ...input,
        systems: input.systems.map((entry) =>
          entry.id === 'code'
            ? { ...entry, position: [-487.9, 487.9] }
            : entry.id === 'hackathons'
              ? { ...entry, position: [666.49, 178.59] }
              : entry,
        ),
      };
      expect(problemsOf(byHand)).toEqual([]);
    });
  });
});
