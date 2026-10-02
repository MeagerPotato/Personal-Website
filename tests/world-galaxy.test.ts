import { Vector3, type LineSegments, type Material, type Mesh, type Object3D } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { readRealInput } from '../scripts/journeys/galaxies';
import { AssetStore } from '../src/universe/core/AssetStore';
import type { Frame } from '../src/universe/core/Engine';
import { JobQueue } from '../src/universe/core/jobs';
import { buildUniverse } from '../src/universe/data/build';
import { KEY_LIGHT_POSITION, type ToonMaterial } from '../src/universe/design/materials';
import { tuning } from '../src/universe/design/tuning';
import { BODIES } from '../src/universe/design/worlds/bodies';
import { MOTION } from '../src/universe/design/worlds/motion';
import { NEAR } from '../src/universe/design/worlds/near';
import { Galaxy } from '../src/universe/world/Galaxy';

// THE REAL GALAXY, DRAWN FROM ITS ROWS (world/Galaxy.ts with world/BodyMesh.ts): every body that
// has rows in design/worlds/ is its emblem world, turned, lit and faced as the policy says, and
// the whole galaxy at rest stays inside the draw-call budget (build-plan.md, section 7).

const real = buildUniverse(readRealInput());

const frame = (simTime: number, dt = 1 / 60): Frame => ({
  elapsed: simTime,
  dt,
  alpha: 1,
  simTime,
});

function setup(over: { low?: boolean; reducedMotion?: boolean; viewer?: Vector3 } = {}) {
  const jobs = new JobQueue(1000);
  const viewer = { position: over.viewer ?? new Vector3(0, 0, -5000) };
  const closeUp = vi.fn(() => Promise.resolve({ NEAR, MOTION }));
  const galaxy = new Galaxy({
    manifest: real,
    assets: new AssetStore(),
    jobs,
    viewer,
    reducedMotion: over.reducedMotion ?? false,
    low: over.low ?? false,
    closeUp,
  });
  const node = (id: string): Object3D => {
    const found = galaxy.object.getObjectByName(id);
    if (!found) throw new Error(`no node '${id}'`);
    return found;
  };
  const world = (id: string): Object3D => {
    const found = node(id).getObjectByName('world');
    if (!found) throw new Error(`'${id}' is not drawn from rows`);
    return found;
  };
  const finish = (): void => {
    while (jobs.pending > 0) jobs.frameUpdate();
  };
  return { galaxy, jobs, viewer, closeUp, node, world, finish };
}

/** The draw calls of what is shown: every visible mesh and line under `root`. */
function drawCalls(root: Object3D): number {
  let calls = 0;
  root.traverseVisible((child) => {
    const drawn = child as Mesh;
    if (drawn.isMesh || (child as { isLine?: boolean }).isLine) calls += 1;
  });
  return calls;
}

const withRows = real.bodies.filter((body) => BODIES[body.id] !== undefined);

describe('the real galaxy, drawn from its rows', () => {
  it('draws every body that has rows as its emblem world, and nothing else of it', () => {
    expect(withRows.length).toBe(real.bodies.length);
    const { galaxy, node, world, finish } = setup();
    finish();
    galaxy.frameUpdate(frame(1));
    for (const body of withRows) {
      const drawn = world(body.id);
      // No generated globe and no model beside it: the world is the view's one child.
      expect(node(body.id).children, body.id).toEqual([drawn]);
      const share = body.planned ? tuning.world.plannedScale : 1;
      expect(drawn.scale.x, body.id).toBeCloseTo(body.radius * share, 12);
      expect(drawCalls(drawn), body.id).toBeGreaterThan(0);
    }
    galaxy.dispose();
  });

  it('turns planets, moons and home, and holds suns, the station, the satellite and relays', () => {
    const { galaxy, world, finish } = setup();
    finish();
    galaxy.frameUpdate(frame(1));
    const turned = (id: string): number | null =>
      world(id).getObjectByName('turning')?.rotation.y ?? null;
    const before = new Map(withRows.map((body) => [body.id, turned(body.id)]));
    const dt = 0.5;
    galaxy.frameUpdate(frame(1 + dt, dt));
    for (const body of withRows) {
      const turns = ['planet', 'moon', 'home'].includes(body.kind);
      const was = before.get(body.id);
      if (!turns) {
        expect(was, `${body.id} turns`).toBeNull();
        continue;
      }
      // (Kalshi's coin is still: it rocks instead, up close.)
      if (BODIES[body.id]?.still) {
        expect(was, body.id).toBeNull();
        continue;
      }
      expect(turned(body.id), body.id).toBeCloseTo((was ?? 0) + tuning.world.spinRadPerSec * dt, 9);
    }
    galaxy.dispose();
  });

  it('turns nothing under reduced motion, and on the low tier has nothing to turn', () => {
    const still = setup({ reducedMotion: true });
    still.finish();
    still.galaxy.frameUpdate(frame(1));
    const at = still.world('page/about').getObjectByName('turning')?.rotation.y;
    still.galaxy.frameUpdate(frame(2, 1));
    expect(still.world('page/about').getObjectByName('turning')?.rotation.y).toBe(at);
    still.galaxy.dispose();

    const low = setup({ low: true });
    low.finish();
    for (const body of withRows) {
      expect(low.world(body.id).getObjectByName('turning'), body.id).toBeUndefined();
    }
    low.galaxy.dispose();
  });

  it('keeps each relay’s arrow pointing away from home, wherever it is on its ring', () => {
    const { galaxy, node, world, finish } = setup();
    finish();
    const relays = withRows.filter((body) => body.kind === 'link');
    expect(relays.length).toBeGreaterThan(0);
    for (const t of [0, 37, 400]) {
      galaxy.frameUpdate(frame(t));
      for (const relay of relays) {
        const home = node(relay.parent ?? '').position;
        const away = node(relay.id).position.clone().sub(home).normalize();
        // The arrow points along the relay's +x (design/worlds/home.ts).
        const arrow = new Vector3(1, 0, 0).applyEuler(world(relay.id).rotation);
        expect(arrow.distanceTo(away), `${relay.id} at ${t}`).toBeLessThan(1e-9);
      }
    }
    galaxy.dispose();
  });

  it('flies Model Rocketry nose first: its +x is the way it goes round its sun, at any time', () => {
    for (const reducedMotion of [false, true]) {
      const { galaxy, node, world, finish } = setup({ reducedMotion });
      finish();
      const rocket = real.bodies.find((body) => body.id === 'project/model-rocketry');
      if (!rocket) throw new Error('the real galaxy has Model Rocketry');
      const round = (t: number): Vector3 => {
        galaxy.frameUpdate(frame(t));
        return node(rocket.id)
          .position.clone()
          .sub(node(rocket.parent ?? '').position);
      };
      for (const t of [0, 37, 400, 2235]) {
        const here = round(t);
        const nose = new Vector3(1, 0, 0).applyEuler(world(rocket.id).rotation);
        const going = round(t + 0.01)
          .sub(here)
          .normalize();
        expect(nose.distanceTo(going), `at ${t}, reduced motion ${reducedMotion}`).toBeLessThan(
          1e-3,
        );
      }
      galaxy.dispose();
    }
  });

  it('sends the Contact satellite’s mail away from home, toward the edge of the map', () => {
    const { galaxy, node, world, finish } = setup();
    finish();
    const satellite = withRows.find((body) => body.kind === 'satellite');
    if (!satellite) throw new Error('the real galaxy has a satellite');
    for (const t of [0, 37, 400]) {
      galaxy.frameUpdate(frame(t));
      const home = node(satellite.parent ?? '').position;
      const away = node(satellite.id).position.clone().sub(home).normalize();
      // The letter and its trail leave along the satellite's +z (design/worlds/home.ts).
      const trail = new Vector3(0, 0, 1).applyEuler(world(satellite.id).rotation);
      expect(trail.distanceTo(away), `at ${t}`).toBeLessThan(1e-9);
    }
    galaxy.dispose();
  });

  it('draws a sun’s world with the key light’s material: its ball glows, its signs are flat', () => {
    const { galaxy, world, finish } = setup();
    finish();
    galaxy.frameUpdate(frame(1));
    for (const sun of withRows.filter((body) => body.kind === 'sun')) {
      const mesh = world(sun.id).getObjectByName('far:hold') as Mesh;
      const material = mesh.material as ToonMaterial;
      expect(material.uniforms.uSunPosition.value.equals(KEY_LIGHT_POSITION), sun.id).toBe(true);
      const unlit = mesh.geometry.getAttribute('aUnlit');
      const kinds = new Set(Array.from(unlit.array));
      // Nothing of it is lit: the ball glows (2), the rest is flat (1). Except Hardware's gears
      // (design/worlds/gears.ts), which glow too: flat beside the ball's halo they would wash out.
      expect([...kinds].sort(), sun.id).toEqual(sun.id === 'system/hardware' ? [2] : [1, 2]);
    }
    galaxy.dispose();
  });

  it('stays inside the draw-call budget at rest: 40, and 30 on the low tier', () => {
    const count = (low: boolean): { worlds: number; all: number } => {
      const { galaxy, finish } = setup({ low });
      finish();
      galaxy.frameUpdate(frame(1));
      let worlds = 0;
      galaxy.object.traverse((child) => {
        if (child.name === 'world') worlds += drawCalls(child);
      });
      const all = drawCalls(galaxy.object);
      galaxy.dispose();
      return { worlds, all };
    };
    const full = count(false);
    const low = count(true);
    expect(full.worlds).toBeLessThanOrEqual(40);
    expect(low.worlds).toBeLessThanOrEqual(30);
  });

  it('loads the close-up once the everyday worlds are built, and swaps it in near a body', async () => {
    const { galaxy, viewer, closeUp, node, world, finish } = setup();
    galaxy.frameUpdate(frame(1));
    expect(closeUp).not.toHaveBeenCalled(); // the everyday builds come first
    finish();
    galaxy.frameUpdate(frame(1));
    expect(closeUp).toHaveBeenCalledTimes(1);
    await Promise.resolve();

    viewer.position.copy(node('page/about').position).add(new Vector3(0, 0, -30));
    galaxy.frameUpdate(frame(1));
    finish();
    galaxy.frameUpdate(frame(1));
    const about = world('page/about');
    expect(about.getObjectByName('near:hold')?.visible).toBe(true);
    expect(about.getObjectByName('far:hold')?.visible).toBe(false);
    expect(about.getObjectByName('near:mover:train')).toBeDefined();
    galaxy.frameUpdate(frame(2));
    expect(closeUp).toHaveBeenCalledTimes(1);
    galaxy.dispose();
  });

  it('draws the blueprint lines with one material per family, and gives each back', () => {
    const { galaxy, finish } = setup();
    finish();
    galaxy.frameUpdate(frame(1));
    // Planned work's lines, by the family its rows say it will wear (BodyRecipe.ghost).
    const byFamily = new Map<string, Set<Material>>();
    galaxy.object.traverse((child) => {
      if (!child.name.endsWith(':edges')) return;
      let body: Object3D | null = child;
      while (body && !body.name.includes('/')) body = body.parent;
      const family = BODIES[body?.name ?? '']?.ghost ?? '?';
      const seen = byFamily.get(family) ?? new Set<Material>();
      seen.add((child as LineSegments).material as Material);
      byFamily.set(family, seen);
    });
    // Kalshi in mint, Corgi in lilac, Fish Online in sky: one each, none shared across families.
    expect([...byFamily.keys()].sort()).toEqual(['lilac', 'mint', 'sky']);
    const materials = [...byFamily.values()].flatMap((seen) => [...seen]);
    expect(materials.length).toBe(byFamily.size);
    const freed = vi.fn();
    for (const material of materials) material.addEventListener('dispose', freed);
    galaxy.dispose();
    expect(freed).toHaveBeenCalledTimes(materials.length);
  });

  it('gives back everything it built, close-ups included', async () => {
    const { galaxy, viewer, closeUp, node, finish } = setup();
    finish();
    viewer.position.copy(node('project/robotics').position);
    galaxy.frameUpdate(frame(1));
    expect(closeUp).toHaveBeenCalledTimes(1);
    // The close-up rows arrive a moment later, as a chunk does; then the close-up is built.
    await Promise.resolve();
    galaxy.frameUpdate(frame(1));
    finish();
    galaxy.frameUpdate(frame(1));
    const disposed = vi.fn();
    let made = 0;
    const near: string[] = [];
    galaxy.object.traverse((child) => {
      const drawn = child as Mesh;
      if (!drawn.geometry || drawn.name.endsWith(':orbit')) return;
      made += 1;
      if (drawn.name.startsWith('near:')) near.push(drawn.name);
      drawn.geometry.addEventListener('dispose', disposed);
    });
    expect(near).toContain('near:turn');
    galaxy.dispose();
    expect(made).toBeGreaterThan(real.bodies.length);
    expect(disposed).toHaveBeenCalledTimes(made);
  });
});
