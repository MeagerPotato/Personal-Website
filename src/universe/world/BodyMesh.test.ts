import type { BufferGeometry, LineSegments, Material, Mesh, Object3D } from 'three';
import { createEdgeMaterial } from '../design/materials';
import { describe, expect, it, vi } from 'vitest';
import { JobQueue } from '../core/jobs';
import type { BodyKind } from '../data/types';
import { createToonMaterial, type ToonMaterial } from '../design/materials';
import { tokens, type ThemeKey } from '../design/tokens';
import { tuning } from '../design/tuning';
import { BODIES } from '../design/worlds/bodies';
import { MOTION } from '../design/worlds/motion';
import { NEAR } from '../design/worlds/near';
import { hexToLinear } from '../sim/color';
import { drive } from '../sim/world/motion';
import { BodyMesh, CloseUpLoader, type CloseUpRows, type CloseUpSource } from './BodyMesh';

const ROWS: CloseUpRows = { NEAR, MOTION };

/** A close-up source whose rows are there from the start (or not yet, with `null`). */
interface Source extends CloseUpSource {
  rows: CloseUpRows | null;
  asked: number;
}
function source(rows: CloseUpRows | null = ROWS): Source {
  return {
    rows,
    asked: 0,
    request() {
      this.asked += 1;
    },
  };
}

interface Made {
  world: BodyMesh;
  jobs: JobQueue;
  material: ToonMaterial;
  closeUp: Source;
  finish(): void;
  /** Every object of the world by name, or undefined. */
  named(name: string): Object3D | undefined;
  shown(): string[];
}

function make(
  id: string,
  kind: BodyKind,
  over: Partial<{
    planned: boolean;
    radius: number;
    low: boolean;
    reducedMotion: boolean;
    closeUp: Source;
    edges: (family: ThemeKey) => Material;
  }> = {},
): Made {
  const recipe = BODIES[id];
  if (!recipe) throw new Error(`no rows for ${id}`);
  const jobs = new JobQueue(1000);
  const material = createToonMaterial({ vertexColors: true });
  const closeUp = over.closeUp ?? source();
  const world = new BodyMesh({
    id,
    kind,
    planned: over.planned ?? false,
    radius: over.radius ?? 8,
    seed: id,
    recipe,
    material,
    jobs,
    low: over.low ?? false,
    reducedMotion: over.reducedMotion ?? false,
    closeUp,
    ...(over.edges ? { edges: over.edges } : {}),
  });
  return {
    world,
    jobs,
    material,
    closeUp,
    finish: () => {
      while (jobs.pending > 0) jobs.frameUpdate();
    },
    named: (name) => world.object.getObjectByName(name),
    shown: () => {
      const names: string[] = [];
      world.object.traverseVisible((child) => {
        if (child !== world.object && child.name !== 'turning') names.push(child.name);
      });
      return names.sort();
    },
  };
}

const FAR = 100;
const NEAR_BY = 2;
const step = 1 / 60;

describe('BodyMesh', () => {
  it('draws nothing until its everyday build exists, then the body at its size', () => {
    const { world, finish, shown, jobs } = make('project/robotics', 'planet', { radius: 8 });
    expect(world.built).toBe(false);
    expect(jobs.pending).toBe(1);
    world.update(FAR, step, 0);
    expect(shown()).toEqual([]);
    finish();
    world.update(FAR, step, 0);
    expect(world.built).toBe(true);
    expect(shown()).toEqual(['far:turn']);
    // Modelled at radius 1, drawn at the body's.
    expect(world.object.scale.x).toBe(8);
    expect(world.reach).toBeGreaterThan(1);
    world.dispose();
  });

  it('draws planned work at its share of the finished size, with its ghosts outlined', () => {
    const { world, finish, named } = make('project/corgi', 'planet', {
      planned: true,
      radius: 8,
    });
    finish();
    world.update(FAR, step, 0);
    expect(world.object.scale.x).toBeCloseTo(8 * tuning.world.plannedScale, 12);
    const lines = [named('far:turn:edges'), named('far:hold:edges')].filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    const edge = lines[0] as LineSegments;
    const recipe = BODIES['project/corgi'];
    const color = (edge.material as Material & { uniforms: { uColor: { value: unknown } } })
      .uniforms.uColor.value as { r: number; g: number; b: number };
    const expected = hexToLinear(tokens.color.system[recipe?.ghost ?? 'coral'].base);
    expect([color.r, color.g, color.b].map((v) => Number(v.toFixed(6)))).toEqual(
      expected.map((v) => Number(v.toFixed(6))),
    );
    world.dispose();
  });

  it('draws its blueprint lines with the material its family shares, when it is given one', () => {
    const shared = new Map<ThemeKey, Material>();
    const edges = (family: ThemeKey): Material => {
      const made =
        shared.get(family) ?? createEdgeMaterial({ color: tokens.color.system[family].base });
      shared.set(family, made);
      return made;
    };
    const one = make('project/corgi', 'planet', { planned: true, edges });
    const two = make('project/corgi', 'planet', { planned: true, edges });
    for (const made of [one, two]) made.finish();
    const lines = (made: Made): Material =>
      ((made.named('far:turn:edges') ?? made.named('far:hold:edges')) as LineSegments)
        .material as Material;
    expect(lines(one)).toBe(lines(two));
    expect(shared.size).toBe(1);
    // It is the family's, not the body's: a body gone leaves it be.
    const freed = vi.fn();
    lines(one).addEventListener('dispose', freed);
    one.world.dispose();
    two.world.dispose();
    expect(freed).not.toHaveBeenCalled();
  });

  it('turns what the glue says turns, and nothing on the low tier', () => {
    const planet = make('project/robotics', 'planet');
    planet.finish();
    expect(planet.world.turning).not.toBeNull();
    expect(planet.named('far:turn')?.parent).toBe(planet.world.turning);

    // A sun, the station, the satellite and a relay hold still.
    for (const [id, kind] of [
      ['system/software', 'sun'],
      ['page/resume', 'station'],
      ['page/contact', 'satellite'],
      ['link/github', 'link'],
    ] as const) {
      const held = make(id, kind);
      held.finish();
      expect(held.world.turning, id).toBeNull();
      expect(held.named('far:turn'), id).toBeUndefined();
      held.world.dispose();
    }

    // About Me: the ground turns, its Circle Line (stops at true bearings) holds.
    const about = make('page/about', 'home');
    about.finish();
    about.world.update(FAR, step, 0);
    expect(about.shown()).toEqual(['far:hold', 'far:turn']);
    expect(about.named('far:hold')?.parent).toBe(about.world.object);

    // The low tier: one group, which never turns.
    const low = make('page/about', 'home', { low: true });
    low.finish();
    low.world.update(FAR, step, 0);
    expect(low.world.turning).toBeNull();
    expect(low.shown()).toEqual(['far:hold']);
    for (const made of [planet, about, low]) made.world.dispose();
  });

  it('swaps the close-up in near by, drives its movers at the time given, and frees it later', () => {
    const { world, finish, named, shown } = make('page/about', 'home');
    finish();
    world.update(NEAR_BY, step, 0);
    finish();
    world.update(NEAR_BY, step, 7.5);
    expect(shown().filter((name) => name.startsWith('far:'))).toEqual([]);
    expect(named('near:turn')?.visible).toBe(true);
    // The train goes round the Circle Line: exactly where its row says at 7.5 s.
    const train = named('near:mover:train');
    const row = MOTION['page/about']?.find(([part]) => part === 'train');
    if (!train || !row) throw new Error('fixture');
    expect(train.rotation.y).toBeCloseTo(drive(row, 7.5).value, 12);
    expect(train.parent?.name).toBe('near:pivot:train');
    expect(train.parent?.parent).toBe(world.object); // the held group
    world.update(NEAR_BY, step, 12);
    expect(train.rotation.y).toBeCloseTo(drive(row, 12).value, 12);

    // Away, but not for long enough: it stays. Then it goes, and every geometry with it.
    const geometry = (named('near:turn') as Mesh).geometry as BufferGeometry;
    const freed = vi.fn();
    geometry.addEventListener('dispose', freed);
    world.update(FAR, 1, 13);
    expect(named('near:turn')).toBeDefined();
    world.update(FAR, tuning.world.nearLingerSec, 14);
    expect(named('near:turn')).toBeUndefined();
    expect(named('near:mover:train')).toBeUndefined();
    expect(freed).toHaveBeenCalledTimes(1);
    expect(shown()).toEqual(['far:hold', 'far:turn']);
    world.dispose();
  });

  it('hides a part whose scale is nothing, and swells a glowing part’s brightness', () => {
    // The twin rocket's flame only exists while it flies (a bump of scale, 0 at rest).
    const about = make('page/about', 'home');
    about.finish();
    about.world.update(NEAR_BY, step, 0);
    about.finish();
    about.world.update(NEAR_BY, step, 0);
    const flame = about.named('near:mover:twin-flame');
    expect(flame?.visible).toBe(false);
    expect(flame?.scale.x).toBe(1);
    about.world.update(NEAR_BY, step, 8);
    expect(flame?.visible).toBe(true);

    const berkeley = make('project/hackathons-at-berkeley', 'planet');
    berkeley.finish();
    berkeley.world.update(NEAR_BY, step, 0);
    berkeley.finish();
    berkeley.world.update(NEAR_BY, step, 1.3);
    const lights = berkeley.named('near:mover:headlights') as Mesh;
    const own = lights.material as ToonMaterial;
    expect(own).not.toBe(berkeley.material);
    // Lit by the same light, which it shares and never copies.
    expect(own.uniforms.uSunPosition.value).toBe(berkeley.material.uniforms.uSunPosition.value);
    const row = MOTION['project/hackathons-at-berkeley']?.[0];
    if (!row) throw new Error('fixture');
    expect(own.uniforms.uTint.value.r).toBeCloseTo(drive(row, 1.3).value, 6);
    for (const made of [about, berkeley]) made.world.dispose();
  });

  it('draws the still up close under reduced motion and on the low tier: no movers', () => {
    for (const over of [{ reducedMotion: true }, { low: true }]) {
      const { world, finish, named, shown } = make('page/about', 'home', over);
      finish();
      world.update(NEAR_BY, step, 0);
      finish();
      world.update(NEAR_BY, step, 3);
      expect(named('near:hold')?.visible, JSON.stringify(over)).toBe(true);
      expect(shown().some((name) => name.includes(':mover:'))).toBe(false);
      world.dispose();
    }
  });

  it('asks for the close-up rows only when it wants them, and waits for them', () => {
    const closeUp = source(null);
    const { world, finish, shown } = make('project/robotics', 'planet', { closeUp });
    finish();
    world.update(FAR, step, 0);
    expect(closeUp.asked).toBe(0);
    world.update(NEAR_BY, step, 0);
    expect(closeUp.asked).toBe(1);
    finish();
    expect(shown()).toEqual(['far:turn']);
    closeUp.rows = ROWS;
    world.update(NEAR_BY, step, 0);
    finish();
    world.update(NEAR_BY, step, 0);
    expect(shown()).toContain('near:turn');
    world.dispose();
  });

  it('builds the star map’s own variant for rows that have one, and shows it on the map', () => {
    const { world, finish, shown } = make('page/about', 'home');
    finish();
    world.update(FAR, step, 0, true);
    finish();
    world.update(FAR, step, 0, true);
    expect(shown().every((name) => name.startsWith('map:'))).toBe(true);
    expect(shown().length).toBeGreaterThan(0);
    world.update(FAR, step, 0, false);
    expect(shown()).toEqual(['far:hold', 'far:turn']);
    world.dispose();

    // Rows with no variant draw the same on the map as in flight.
    const plain = make('project/robotics', 'planet');
    plain.finish();
    plain.world.update(FAR, step, 0, true);
    expect(plain.jobs.pending).toBe(0);
    expect(plain.shown()).toEqual(['far:turn']);
    plain.world.dispose();
  });

  it('shows its still on the map near by too: never the close-up, and nothing moves', () => {
    // Docked at Hackathons, the map opened: the clock hand and the confetti are close-up movers.
    const { world, finish, named, shown } = make('system/hackathons', 'sun', { radius: 20 });
    finish();
    world.update(NEAR_BY, step, 0);
    finish();
    world.update(NEAR_BY, step, 20);
    const hand = named('near:mover:hand');
    expect(hand?.visible).toBe(true);
    const turned = hand?.rotation.y;
    world.update(NEAR_BY, step, 21, true);
    expect(shown().length).toBeGreaterThan(0);
    expect(
      shown().every((name) => name.startsWith('far:')),
      shown().join(),
    ).toBe(true);
    world.update(NEAR_BY, step, 40, true);
    expect(hand?.rotation.y).toBe(turned);
    // Back in flight, the close-up is there still, and moving again.
    world.update(NEAR_BY, step, 41);
    expect(shown()).toContain('near:mover:hand');
    expect(hand?.rotation.y).not.toBe(turned);
    world.dispose();
  });

  it('gives back every geometry and material it made, and cancels a build still waiting', () => {
    const { world, finish, jobs } = make('page/about', 'home');
    finish();
    world.update(NEAR_BY, step, 0);
    finish();
    world.update(NEAR_BY, step, 0);
    const disposed = vi.fn();
    let made = 0;
    world.object.traverse((child) => {
      const drawn = child as Mesh;
      if (!drawn.geometry) return;
      made += 1;
      drawn.geometry.addEventListener('dispose', disposed);
    });
    const parent = { removed: 0 };
    world.object.addEventListener('removed', () => (parent.removed += 1));
    world.dispose();
    expect(made).toBeGreaterThan(4);
    expect(disposed).toHaveBeenCalledTimes(made);
    expect(jobs.pending).toBe(0);

    const waiting = make('project/robotics', 'planet');
    expect(waiting.jobs.pending).toBe(1);
    waiting.world.dispose();
    expect(waiting.jobs.pending).toBe(0);
    // And nothing it does after is an error.
    waiting.world.update(NEAR_BY, step, 0);
    expect(waiting.jobs.pending).toBe(0);
  });
});

describe('CloseUpLoader', () => {
  it('loads once, however often it is asked', async () => {
    const load = vi.fn(() => Promise.resolve(ROWS));
    const loader = new CloseUpLoader(load);
    expect(loader.rows).toBeNull();
    loader.request();
    loader.request();
    await Promise.resolve();
    expect(loader.rows).toBe(ROWS);
    loader.request();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('stays at every day when the chunk cannot be loaded, and drops what arrives too late', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failing = new CloseUpLoader(() => Promise.reject(new Error('offline')));
    failing.request();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(failing.rows).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();

    let arrive: (rows: CloseUpRows) => void = () => undefined;
    const late = new CloseUpLoader(() => new Promise((resolve) => (arrive = resolve)));
    late.request();
    late.dispose();
    arrive(ROWS);
    await Promise.resolve();
    expect(late.rows).toBeNull();
  });

  it('loads a module that has both tables (that it is a chunk of its own, verify-dist checks)', async () => {
    const chunk = await import('../design/worlds/closeup');
    expect(chunk.NEAR).toBe(NEAR);
    expect(chunk.MOTION).toBe(MOTION);
  });
});
