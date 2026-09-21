import { Vector3, type LineLoop, type Mesh, type Object3D } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AssetStore } from '../core/AssetStore';
import type { Frame } from '../core/Engine';
import { JobQueue } from '../core/jobs';
import { buildUniverse } from '../data/build';
import type { UniverseInput } from '../data/types';
import { KEY_LIGHT_POSITION } from '../design/materials';
import { tuning } from '../design/tuning';
import { centerBodyOf, homeSystemOf, nearestNeighbourOf, readManifest } from '../manifest';
import { spawnPoint } from '../sim/spawn';
import { Galaxy } from './Galaxy';

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
    const out = new Vector3();

    expect(galaxy.lightAt(new Vector3(0, 0, 0), out).equals(KEY_LIGHT_POSITION)).toBe(true);
    expect(
      galaxy.lightAt(sun.clone().add(new Vector3(40, 0, 0)), out).distanceTo(sun),
    ).toBeLessThan(1e-6);

    // On the way in, somewhere between the two: no pop.
    const edge = sun.clone().add(new Vector3(code.radius * 1.6, 0, 0));
    const between = galaxy.lightAt(edge, out).clone();
    expect(between.distanceTo(sun)).toBeGreaterThan(1);
    expect(between.distanceTo(KEY_LIGHT_POSITION)).toBeGreaterThan(1);
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
