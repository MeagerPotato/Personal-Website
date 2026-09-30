import { Vector3, type LineLoop, type Mesh, type Object3D } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AssetStore } from '../core/AssetStore';
import type { Frame } from '../core/Engine';
import { JobQueue } from '../core/jobs';
import { buildUniverse } from '../data/build';
import type { UniverseInput } from '../data/types';
import { KEY_LIGHT_POSITION, type ToonMaterial } from '../design/materials';
import { tuning } from '../design/tuning';
import {
  centerBodyOf,
  homeSystemOf,
  nearestNeighbourOf,
  readManifest,
  type ManifestBody,
  type UniverseManifest,
} from '../manifest';
import { spawnPoint } from '../sim/spawn';
import { Galaxy } from './Galaxy';
import { plannedBands } from './looks';

const project = (id: string, over: object) => ({
  id,
  title: id,
  href: `/projects/${id}/`,
  date: '2026-08',
  size: 'm' as const,
  biome: 'terra' as const,
  rings: false,
  decorMoons: 0,
  flagship: false,
  related: [],
  draft: false,
  ...over,
});

/** The v0.1 galaxy (docs/PLAN.md §4.1), through the real build. */
const input: UniverseInput = {
  systems: [
    {
      id: 'code',
      name: 'Code',
      href: '/systems/code/',
      theme: 'sky',
      order: 1,
      position: 'auto',
    },
  ],
  projects: [
    project('fishai', { system: 'code', size: 'l', rings: true, biome: 'tide' }),
    project('fish-onboarding', { parent: 'fishai', size: 's' }),
    project('days2meet', { system: 'code' }),
  ],
  pages: [
    { id: 'about', title: 'About', href: '/about/', dock: 'home' },
    { id: 'resume', title: 'Resume', href: '/resume/', dock: 'station' },
    { id: 'contact', title: 'Contact', href: '/contact/', dock: 'satellite' },
  ],
  includeDrafts: false,
};
const manifest = buildUniverse(input);

const frame = (simTime: number, dt = 1 / 60): Frame => ({
  elapsed: simTime,
  dt,
  alpha: 1,
  simTime,
});

/** Which way the ship's light falls from, seen from `at`. */
function lightFrom(galaxy: Galaxy, at: Vector3): Vector3 {
  return galaxy.lightAt(at, new Vector3()).sub(at).normalize();
}
const direction = (from: Vector3, to: Vector3): Vector3 => to.clone().sub(from).normalize();
function expectSameDirection(actual: Vector3, expected: Vector3): void {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
  expect(actual.z).toBeCloseTo(expected.z, 9);
}
/** Where the light that falls on this mesh is. */
const sunOf = (mesh: Mesh): Vector3 => (mesh.material as ToonMaterial).uniforms.uSunPosition.value;

function setup(viewerAt = new Vector3(0, 0, -120)) {
  const viewer = { position: viewerAt };
  const assets = new AssetStore();
  const jobs = new JobQueue(1000);
  const galaxy = new Galaxy({ manifest, assets, jobs, viewer, reducedMotion: false });
  const node = (id: string): Object3D => {
    const found = galaxy.object.getObjectByName(id);
    if (!found) throw new Error(`no node '${id}'`);
    return found;
  };
  const meshOf = (id: string): Mesh => node(id).children[0] as Mesh;
  const finishJobs = (): void => {
    while (jobs.pending > 0) jobs.frameUpdate();
  };
  return { viewer, assets, jobs, galaxy, node, meshOf, finishJobs };
}

describe('reading the manifest', () => {
  it('accepts what the build produces, and knows where home is', () => {
    const read = readManifest(JSON.parse(JSON.stringify(manifest)));
    const home = homeSystemOf(read);
    expect(home.id).toBe('home');
    expect(centerBodyOf(read, home).kind).toBe('home');
    expect(nearestNeighbourOf(read, home)?.id).toBe('code');
    expect(nearestNeighbourOf({ ...read, systems: [home] }, home)).toBeNull();
  });

  it('refuses what is not a manifest, or one from a newer build', () => {
    expect(() => readManifest(null)).toThrow(/not an object/);
    expect(() => readManifest('<!doctype html>')).toThrow(/not an object/);
    expect(() => readManifest({ ...manifest, version: 2 })).toThrow(/version 2/);
    expect(() => readManifest({ version: 1 })).toThrow(/missing/);
    expect(() => readManifest({ version: 1, systems: [], bodies: [] })).toThrow(/empty/);
  });
});

describe('where a visitor starts', () => {
  const rule = { distance: 100, swingDeg: 0 };

  it('is the asked distance from home, facing it, on the side away from the neighbour', () => {
    const spawn = spawnPoint([0, 0], [0, 900], rule); // the neighbour is along +Z
    expect(spawn.x).toBeCloseTo(0, 9);
    expect(spawn.z).toBeCloseTo(-100, 9);
    expect(spawn.heading).toBeCloseTo(0, 9); // nose along +Z: home, and the neighbour behind it

    const elsewhere = spawnPoint([50, -20], [-700, 600], { distance: 118, swingDeg: 24 });
    expect(Math.hypot(elsewhere.x - 50, elsewhere.z + 20)).toBeCloseTo(118, 9);
    const nose = [Math.sin(elsewhere.heading), Math.cos(elsewhere.heading)];
    const toHome = [(50 - elsewhere.x) / 118, (-20 - elsewhere.z) / 118];
    expect(nose[0]).toBeCloseTo(toHome[0] ?? NaN, 9);
    expect(nose[1]).toBeCloseTo(toHome[1] ?? NaN, 9);
  });

  it('swings round, so the neighbour is beside home and not hidden behind it', () => {
    const swung = spawnPoint([0, 0], [0, 900], { distance: 100, swingDeg: 30 });
    const toNeighbour = Math.atan2(0 - swung.x, 900 - swung.z);
    const offNose = Math.abs(toNeighbour - swung.heading);
    expect(offNose).toBeGreaterThan(0.05); // not dead ahead
    expect(offNose).toBeLessThan(0.6); // and well inside the view
  });

  it('still works in a galaxy of one', () => {
    const alone = spawnPoint([10, 10], null, rule);
    expect(Math.hypot(alone.x - 10, alone.z - 10)).toBeCloseTo(100, 9);
  });
});

describe('Galaxy', () => {
  it('makes a view for every body, and an orbit line for every body that orbits', () => {
    const { galaxy } = setup();
    for (const body of manifest.bodies) {
      expect(galaxy.object.getObjectByName(body.id)).toBeDefined();
      const line = galaxy.object.getObjectByName(`${body.id}:orbit`) as LineLoop | undefined;
      expect(line !== undefined).toBe(body.orbit !== null);
      if (line && body.orbit) expect(line.scale.x).toBe(body.orbit.radius);
    }
  });

  it('puts everything where the orbits say, at the time of the frame', () => {
    const { galaxy, node } = setup();
    const code = manifest.systems.find((system) => system.id === 'code');
    const planet = manifest.bodies.find((body) => body.id === 'project/days2meet');
    if (!code || !planet?.orbit) throw new Error('fixture');

    galaxy.frameUpdate(frame(0));
    const start = node('project/days2meet').position.clone();
    expect(Math.hypot(start.x - code.position[0], start.z - code.position[1])).toBeCloseTo(
      planet.orbit.radius,
      6,
    );
    expect(node('system/code').position.x).toBeCloseTo(code.position[0], 9);

    galaxy.frameUpdate(frame(planet.orbit.periodSec / 2));
    const opposite = node('project/days2meet').position;
    expect(opposite.x - code.position[0]).toBeCloseTo(-(start.x - code.position[0]), 6);

    // A moon's circle travels with its planet.
    const moonLine = galaxy.object.getObjectByName('project/fish-onboarding:orbit');
    expect(moonLine?.position.x).toBeCloseTo(node('project/fishai').position.x, 9);
  });

  it('draws everything at its true size while flying, and big enough to see on the star map', () => {
    const viewer = { position: new Vector3(0, 0, -120) };
    const moon = manifest.bodies.find((body) => body.id === 'project/fish-onboarding');
    if (!moon?.orbit) throw new Error('fixture');
    // Far enough out that the moon circles its planet at 5 px: inside the planet's own disc.
    const far = moon.orbit.radius / 5;
    const map = { weight: 0, unitsPerPx: far };
    const galaxy = new Galaxy({
      manifest,
      assets: new AssetStore(),
      jobs: new JobQueue(1000),
      viewer,
      reducedMotion: false,
      map,
    });
    const node = (id: string): Object3D => galaxy.object.getObjectByName(id) as Object3D;
    const row = (id: string): number => galaxy.orbits.indexOf(id);

    galaxy.frameUpdate(frame(1));
    expect([...galaxy.displayScale]).toEqual(manifest.bodies.map(() => 1));
    expect(node('project/fish-onboarding').scale.x).toBe(1);
    expect(galaxy.displayReach).toBe(20); // the sun

    // On the map the sun, a few px across, is brought up to its smallest size...
    map.weight = 1;
    galaxy.frameUpdate(frame(2));
    const sunPx = tuning.map.minRadiusPx.sun;
    expect(far * sunPx).toBeGreaterThan(20);
    expect(node('system/code').scale.x).toBeCloseTo((sunPx * far) / 20, 9);
    expect(galaxy.displayScale[row('system/code')]).toBeCloseTo((sunPx * far) / 20, 9);
    expect(galaxy.displayReach).toBeCloseTo(sunPx * far, 9);
    // ...and the moon is not drawn at all, nor is the circle it travels on.
    expect(galaxy.displayScale[row('project/fish-onboarding')]).toBe(0);
    expect(node('project/fish-onboarding').visible).toBe(false);
    expect(galaxy.object.getObjectByName('project/fish-onboarding:orbit')?.visible).toBe(false);
    expect(galaxy.object.getObjectByName('project/fishai:orbit')?.visible).toBe(true);

    // Close in on the map, there is room for the moon again.
    map.unitsPerPx = 0.4;
    galaxy.frameUpdate(frame(3));
    expect(node('project/fish-onboarding').visible).toBe(true);
    expect(galaxy.displayScale[row('project/fish-onboarding')]).toBeGreaterThanOrEqual(1);

    // And back in flight, everything is itself.
    map.weight = 0;
    galaxy.frameUpdate(frame(4));
    expect(node('system/code').scale.x).toBe(1);
    expect(node('project/fish-onboarding').visible).toBe(true);
    galaxy.dispose();
  });

  it('shows a planet once its mesh exists, and a finer one only while the ship is close', () => {
    const { galaxy, viewer, meshOf, finishJobs } = setup();
    const home = meshOf('page/about');
    expect(home.visible).toBe(false);

    finishJobs();
    expect(home.visible).toBe(true);
    const everyday = home.geometry;
    const facets = (mesh: Mesh): number => mesh.geometry.getAttribute('position').count / 3;
    expect(facets(home)).toBe(20 * (tuning.world.detailPlanet + 1) ** 2);

    viewer.position.set(0, 0, -30); // about two radii from the home planet
    galaxy.frameUpdate(frame(1));
    finishJobs();
    expect(facets(home)).toBe(20 * (tuning.world.detailNear + 1) ** 2);
    const closeUp = home.geometry;
    const freed = vi.fn();
    closeUp.addEventListener('dispose', freed);

    // Far away, but not for long enough yet: the close-up stays.
    viewer.position.set(0, 0, -600);
    galaxy.frameUpdate(frame(2, 1));
    expect(home.geometry).toBe(closeUp);
    galaxy.frameUpdate(frame(3, tuning.world.nearLingerSec));
    expect(home.geometry).toBe(everyday);
    expect(freed).toHaveBeenCalledTimes(1);

    // Moons and suns never build a close-up.
    viewer.position.copy(galaxy.object.getObjectByName('system/code')?.position ?? viewer.position);
    galaxy.frameUpdate(frame(4));
    finishJobs();
    expect(facets(meshOf('system/code'))).toBe(20 * (tuning.world.detailSun + 1) ** 2);
  });

  it('lights the ship by the sun of the system it is in, fading to the key light between systems', () => {
    const { galaxy } = setup();
    const code = manifest.systems.find((system) => system.id === 'code');
    if (!code) throw new Error('fixture');
    const sun = new Vector3(code.position[0], 0, code.position[1]);

    // Out at home, far from every sun: the key light.
    const home = new Vector3(0, 0, 0);
    expectSameDirection(lightFrom(galaxy, home), direction(home, KEY_LIGHT_POSITION));

    // Anywhere inside the sun's family, wherever round it: from the sun, and nowhere else.
    const full = code.radius * tuning.world.shipLightFullRadii;
    for (const [off, angle] of [
      [30, 0],
      [40, 1],
      [120, 2.5],
      [code.radius, 4],
      [full - 0.1, 5.5],
    ] as const) {
      const at = sun.clone().add(new Vector3(Math.cos(angle) * off, 0, Math.sin(angle) * off));
      expectSameDirection(lightFrom(galaxy, at), direction(at, sun));
    }

    // On the way in, somewhere between the two: neither of them, so no pop.
    const edge = sun.clone().add(new Vector3(code.radius * 1.6, 0, 0));
    const between = lightFrom(galaxy, edge);
    expect(between.angleTo(direction(edge, sun))).toBeGreaterThan(0.05);
    expect(between.angleTo(direction(edge, KEY_LIGHT_POSITION))).toBeGreaterThan(0.05);
    // And past the fade, the key light again.
    const out = sun.clone().add(new Vector3(0, 0, -code.radius * tuning.world.shipLightFadeRadii));
    expectSameDirection(lightFrom(galaxy, out), direction(out, KEY_LIGHT_POSITION));
  });

  it('lights a planet by its sun, a moon by its planet’s sun, and home by the key light', () => {
    const { galaxy, meshOf } = setup();
    galaxy.frameUpdate(frame(10));
    const code = manifest.systems.find((system) => system.id === 'code');
    if (!code) throw new Error('fixture');
    for (const id of ['project/days2meet', 'project/fishai', 'project/fish-onboarding']) {
      const light = sunOf(meshOf(id));
      expect([light.x, light.y, light.z]).toEqual([code.position[0], 0, code.position[1]]);
      expect(galaxy.subject(id)?.light).toBe(light);
    }
    for (const id of ['page/about', 'page/resume', 'page/contact']) {
      const mesh = galaxy.object.getObjectByName(id)?.getObjectByProperty('type', 'Mesh') as Mesh;
      expect(sunOf(mesh).equals(KEY_LIGHT_POSITION)).toBe(true);
      expect(galaxy.subject(id)?.light?.equals(KEY_LIGHT_POSITION)).toBe(true);
    }
    // A sun is the light: a camera frames it from any side.
    expect(galaxy.subject('system/code')?.light).toBeNull();
  });

  it('draws planned work as an unpainted maquette in its family’s colours, never in close-up', () => {
    const planned = buildUniverse({
      ...input,
      projects: [
        ...input.projects,
        project('sports', { system: 'code', planned: true, date: undefined, biome: 'ember' }),
      ],
    });
    const viewer = { position: new Vector3(0, 0, -120) };
    const jobs = new JobQueue(1000);
    const galaxy = new Galaxy({
      manifest: planned,
      assets: new AssetStore(),
      jobs,
      viewer,
      reducedMotion: false,
    });
    const mesh = galaxy.object.getObjectByName('project/sports')?.children[0] as Mesh;
    const finishJobs = (): void => {
      while (jobs.pending > 0) jobs.frameUpdate();
    };
    finishJobs();
    const facets = (): number => mesh.geometry.getAttribute('position').count / 3;
    expect(facets()).toBe(20 * (tuning.world.detailPlanned + 1) ** 2);

    // Every facet is one of the family's two colours (nudged by the generator's jitter), and none
    // of its biome's.
    const bands = plannedBands('sky');
    const colors = mesh.geometry.getAttribute('color');
    const near = (at: number, band: readonly number[]): boolean =>
      [colors.getX(at), colors.getY(at), colors.getZ(at)].every(
        (value, channel) =>
          Math.abs(value - (band[channel] ?? 0)) <=
          tuning.planet.colorJitter * (band[channel] ?? 0) + 1e-6,
      );
    for (let at = 0; at < colors.count; at += 1) {
      expect(near(at, bands.low) || near(at, bands.high)).toBe(true);
    }

    // Close by, it stays a maquette.
    const at = galaxy.object.getObjectByName('project/sports')?.position ?? new Vector3();
    viewer.position.copy(at).add(new Vector3(0, 0, 20));
    galaxy.frameUpdate(frame(1));
    finishJobs();
    expect(facets()).toBe(20 * (tuning.world.detailPlanned + 1) ** 2);
    galaxy.dispose();
  });

  it('draws a world of its own as its recipe says, lit by its sun', () => {
    const galaxy = new Galaxy({
      manifest,
      assets: new AssetStore(),
      jobs: new JobQueue(1000),
      viewer: { position: new Vector3() },
      reducedMotion: false,
      worlds: {
        'project/days2meet': { model: 'station', rings: true },
        'project/fishai': { rings: false },
      },
    });
    const node = (id: string): Object3D => galaxy.object.getObjectByName(id) as Object3D;
    const model = node('project/days2meet').getObjectByName('station');
    expect(model).toBeDefined();
    expect(node('project/days2meet').getObjectByName('planetRing')).toBeDefined();
    // The content gives FishAI a ring; its recipe takes it away.
    expect(node('project/fishai').getObjectByName('planetRing')).toBeUndefined();
    const code = manifest.systems.find((system) => system.id === 'code');
    const light = sunOf(model?.getObjectByProperty('type', 'Mesh') as Mesh);
    expect([light.x, light.z]).toEqual([code?.position[0], code?.position[1]]);
    galaxy.dispose();
  });

  it('gives back every GPU resource, and cancels meshes still waiting to be built', () => {
    const { galaxy, assets, jobs } = setup();
    jobs.frameUpdate(); // with a budget this large the first frame builds them all...
    const disposed = vi.fn();
    galaxy.object.traverse((child) => {
      const mesh = child as Mesh;
      if (mesh.geometry) mesh.geometry.addEventListener('dispose', disposed);
    });
    galaxy.dispose();
    assets.dispose();
    expect(galaxy.object.parent).toBeNull();
    expect(disposed.mock.calls.length).toBeGreaterThanOrEqual(manifest.bodies.length);

    // ...and with no budget at all, none: disposing must leave nothing in the queue.
    const lazy = new JobQueue(0);
    const waiting = new Galaxy({
      manifest,
      assets: new AssetStore(),
      jobs: lazy,
      viewer: { position: new Vector3() },
      reducedMotion: true,
    });
    expect(lazy.pending).toBeGreaterThan(0);
    waiting.dispose();
    expect(lazy.pending).toBe(0);
  });
});

/**
 * A binary star, by hand (the build makes none yet): two suns circling one centre, each with its
 * own planets, their families 40 u apart at the closest, as the tree's Projects will be.
 */
function binary(): UniverseManifest {
  const orbit = (radius: number, phase: number, periodSec: number) => ({
    radius,
    phase,
    periodSec,
  });
  const sun = (id: string, radius: number, phase: number): ManifestBody => ({
    id: `system/${id}`,
    kind: 'sun',
    title: id,
    href: `/systems/${id}/`,
    system: 'pair',
    parent: null,
    radius: 20,
    dockRadius: 38,
    orbit: orbit(radius, phase, 4000),
    seed: id,
  });
  const planet = (id: string, parent: string, radius: number): ManifestBody => ({
    id: `project/${id}`,
    kind: 'planet',
    title: id,
    href: `/projects/${id}/`,
    system: 'pair',
    parent: `system/${parent}`,
    radius: 8,
    dockRadius: 15.2,
    orbit: orbit(radius, 1, 300),
    seed: id,
    biome: 'terra',
  });
  // Reaches: a 70 + 15.2 = 85.2, b 110 + 15.2 = 125.2. Each sun sits the OTHER family's reach
  // and half the gap from the centre, so both families reach equally far: 145.2 and 105.2.
  return {
    version: 1,
    systems: [
      {
        id: 'pair',
        name: 'Pair',
        theme: 'sky',
        position: [-900, 300],
        radius: 250.4,
        center: 'system/a',
      },
    ],
    bodies: [
      sun('a', 145.2, 0.3),
      sun('b', 105.2, 0.3 + Math.PI),
      planet('a1', 'a', 70),
      planet('b1', 'b', 70),
      planet('b2', 'b', 110),
    ],
    lanes: [],
  };
}

describe('Galaxy, where suns move', () => {
  function setupBinary() {
    const galaxy = new Galaxy({
      manifest: binary(),
      assets: new AssetStore(),
      jobs: new JobQueue(1000),
      viewer: { position: new Vector3(-900, 0, 300) },
      reducedMotion: false,
    });
    const node = (id: string): Object3D => galaxy.object.getObjectByName(id) as Object3D;
    const meshOf = (id: string): Mesh => node(id).children[0] as Mesh;
    return { galaxy, node, meshOf };
  }

  it('lights each planet from its own sun, where that sun is THIS frame', () => {
    const { galaxy, node, meshOf } = setupBinary();
    for (const t of [0, 1000, 2345.6]) {
      galaxy.frameUpdate(frame(t));
      for (const [planet, sun] of [
        ['project/a1', 'system/a'],
        ['project/b1', 'system/b'],
        ['project/b2', 'system/b'],
      ] as const) {
        expect(sunOf(meshOf(planet)).distanceTo(node(sun).position)).toBeLessThan(1e-9);
      }
    }
    // Two suns, two lights: the planets of one never share a light with the other's.
    expect(sunOf(meshOf('project/a1'))).not.toBe(sunOf(meshOf('project/b1')));
    expect(sunOf(meshOf('project/b1'))).toBe(sunOf(meshOf('project/b2')));
    galaxy.dispose();
  });

  it('gives the camera a light that moves with the sun, for as long as it looks', () => {
    const { galaxy, node } = setupBinary();
    galaxy.frameUpdate(frame(0));
    const subject = galaxy.subject('project/b2');
    if (!subject?.light) throw new Error('no light');
    const before = subject.light.clone();
    galaxy.frameUpdate(frame(500));
    expect(subject.light.distanceTo(node('system/b').position)).toBeLessThan(1e-9);
    expect(subject.light.distanceTo(before)).toBeGreaterThan(10);
    galaxy.dispose();
  });

  it('turns the ship’s light over the top from one sun to the other, never round in a frame', () => {
    const { galaxy, node } = setupBinary();
    galaxy.frameUpdate(frame(0));
    const a = node('system/a').position.clone();
    const b = node('system/b').position.clone();
    const across = b.clone().sub(a).normalize();
    const aside = new Vector3(-across.z, 0, across.x);
    // Straight from one sun's ring to the other's, where their pulls are exactly opposite; and on
    // lines beside that one (clear of both rings), from out past one family to out past the other.
    const ring = 38;
    const paths = [
      [a.clone().addScaledVector(across, ring), b.clone().addScaledVector(across, -ring)],
      ...[45, -60, 150].map((offset) => [
        a.clone().addScaledVector(across, -300).addScaledVector(aside, offset),
        b.clone().addScaledVector(across, 300).addScaledVector(aside, offset),
      ]),
    ];
    for (const [from, to] of paths) {
      if (!from || !to) throw new Error('fixture');
      const steps = 4000;
      let last: Vector3 | null = null;
      let largest = 0;
      let highest = 0;
      for (let i = 0; i <= steps; i += 1) {
        const at = from.clone().lerp(to, i / steps);
        const light = lightFrom(galaxy, at);
        expect(Number.isFinite(light.x + light.y + light.z)).toBe(true);
        if (last) largest = Math.max(largest, light.angleTo(last));
        highest = Math.max(highest, light.y);
        last = light;
      }
      // Never more than a couple of degrees in one step of a fifth of a unit or less.
      expect(largest).toBeLessThan((2.5 * Math.PI) / 180);
      // Where the suns cancel, the light is up in the key light's direction.
      if (from === paths[0]?.[0]) expect(highest).toBeGreaterThan(0.4);
    }
    // Deep inside either family, it is that sun's light alone.
    for (const [sun, planet] of [
      [a, 'project/a1'],
      [b, 'project/b2'],
    ] as const) {
      const at = node(planet).position.clone();
      expectSameDirection(lightFrom(galaxy, at), direction(at, sun));
    }
    galaxy.dispose();
  });

  it('is the binary the build makes: every body drawn, each lit by its own sun', () => {
    // The shape of the tree's Projects, through the real build (the fixture above is by hand).
    const built = buildUniverse({
      ...input,
      systems: [
        ...input.systems,
        {
          id: 'pair',
          name: 'Pair',
          href: '/projects/',
          theme: 'lilac',
          order: 2,
          position: 'auto',
          suns: ['soft', 'hard'],
        },
        { id: 'soft', name: 'Soft', href: '/systems/soft/', position: 'auto' },
        { id: 'hard', name: 'Hard', href: '/systems/hard/', position: 'auto' },
      ],
      projects: [
        ...input.projects,
        project('demo', { system: 'soft', size: 'l' }),
        project('online', { parent: 'demo', size: 's' }),
        project('meet', { system: 'soft' }),
        project('rocket', { system: 'hard' }),
        project('robot', { system: 'hard' }),
      ],
    });
    const galaxy = new Galaxy({
      manifest: built,
      assets: new AssetStore(),
      jobs: new JobQueue(1000),
      viewer: { position: new Vector3() },
      reducedMotion: false,
    });
    const node = (id: string): Object3D => {
      const found = galaxy.object.getObjectByName(id);
      if (!found) throw new Error(`no node '${id}'`);
      return found;
    };
    const meshOf = (id: string): Mesh => node(id).children[0] as Mesh;
    for (const body of built.bodies) node(body.id);

    for (const t of [0, 1500]) {
      galaxy.frameUpdate(frame(t));
      for (const [id, sun] of [
        ['project/demo', 'system/soft'],
        ['project/online', 'system/soft'],
        ['project/meet', 'system/soft'],
        ['project/rocket', 'system/hard'],
        ['project/robot', 'system/hard'],
      ] as const) {
        expect(sunOf(meshOf(id)).distanceTo(node(sun).position), `${id} at ${t}`).toBeLessThan(
          1e-9,
        );
      }
    }
    // The suns move, and each family's light goes with its own sun.
    expect(sunOf(meshOf('project/meet'))).not.toBe(sunOf(meshOf('project/rocket')));
    // The ship: deep in a family, lit by that family's sun alone; out at its outermost planet,
    // where the other family is only the gap away, the light leans a little toward the other sun
    // and the key light (2.4 and 0.7 degrees here, with tuning.world.shipLightTiebreak at 0.2),
    // which is the blend doing its job and not a second light.
    for (const [planet, sun, within] of [
      ['project/demo', 'system/soft', 0],
      ['project/rocket', 'system/hard', 0],
      ['project/meet', 'system/soft', 3],
      ['project/robot', 'system/hard', 3],
    ] as const) {
      const at = node(planet).position.clone();
      const own = direction(at, node(sun).position);
      if (within === 0) expectSameDirection(lightFrom(galaxy, at), own);
      else
        expect(lightFrom(galaxy, at).angleTo(own), planet).toBeLessThan((within * Math.PI) / 180);
    }
    galaxy.dispose();
  });
});
