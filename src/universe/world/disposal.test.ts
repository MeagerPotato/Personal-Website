import { Vector3, type BufferGeometry, type Material, type Mesh, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { tuning } from '../design/tuning';
import { createOrbitTable } from '../sim/orbits';
import { AirShells } from './AirShells';
import { Chart } from './Chart';
import { SkyBake } from './SkyBake';
import { Starfield } from './Starfield';
import { SunCorona } from './SunCorona';
import { Traffic } from './Traffic';

// WHOEVER CREATES A GPU RESOURCE DISPOSES IT (AGENTS.md, invariant 9). three tells the renderer
// to free a geometry, a material or a render target by a `dispose` event, so counting those
// events is the only way to see a leak without a GPU. Every system of the deep-light look makes
// its own geometry and material (and the sky its panorama): each is freed when the system is,
// and a second dispose frees nothing twice.

type Freeable =
  BufferGeometry | Material | { addEventListener: BufferGeometry['addEventListener'] };

/** Count the `dispose` events of what a test lists, so that one that was never freed is seen. */
function watch(things: readonly Freeable[]): { freed(): number; total: number } {
  let freed = 0;
  const seen = new Set<Freeable>();
  for (const thing of things) {
    if (seen.has(thing)) continue;
    seen.add(thing);
    (thing as BufferGeometry).addEventListener('dispose', () => (freed += 1));
  }
  return { freed: () => freed, total: seen.size };
}

const partsOf = (mesh: Mesh): Freeable[] => [mesh.geometry, mesh.material as Material];

function expectFreed(things: readonly Freeable[], dispose: () => void): void {
  const watched = watch(things);
  expect(watched.total).toBeGreaterThan(0);
  expect(watched.freed()).toBe(0);
  dispose();
  expect(watched.freed()).toBe(watched.total);
  dispose();
  expect(watched.freed()).toBe(watched.total);
}

describe('what the look’s systems free', () => {
  it('frees the shells and the clouds of the worlds with air', () => {
    const light = new Vector3(1, 1, 1);
    const air = new AirShells({
      worlds: [
        { id: 'a', row: 0, radius: 8, air: 'terra', light, cloud: { share: 0.5, peak: 'frost' } },
        { id: 'b', row: 1, radius: 8, air: 'bloom', light },
      ],
      positions: [0, 0, 10, 10],
      scales: [1, 1],
      low: false,
      reducedMotion: false,
    });
    const meshes = air.object.children as Mesh[];
    expect(meshes).toHaveLength(2);
    expectFreed(meshes.flatMap(partsOf), () => air.dispose());
    expect(air.object.parent).toBeNull();
  });

  it('frees the chart', () => {
    const chart = new Chart({
      districts: [{ x: 0, z: 0, radius: 66, family: 'butter' }],
      map: { weight: 1, unitsPerPx: 1 },
    });
    expectFreed(partsOf(chart.object), () => chart.dispose());
  });

  it('frees the traffic', () => {
    const orbits = createOrbitTable(
      [{ id: 's', position: [0, 0] }],
      [
        { id: 'sun', parent: null, system: 's', orbit: null },
        { id: 'p', parent: 'sun', system: 's', orbit: { radius: 60, phase: 0, periodSec: 100 } },
      ],
    );
    const traffic = new Traffic({
      orbits,
      families: [undefined, 'sky'],
      positions: [0, 0, 60, 0],
      scales: [1, 1],
      reducedMotion: false,
    });
    expectFreed(partsOf(traffic.object), () => traffic.dispose());
  });

  it('frees the coronas', () => {
    const corona = new SunCorona({
      suns: [{ row: 0, family: 'sky', radius: 20, seed: 1, living: true }],
      positions: [0, 0],
      scales: [1],
      low: false,
      reducedMotion: false,
    });
    expectFreed(partsOf(corona.object), () => corona.dispose());
  });

  it('frees the stars', () => {
    const stars = new Starfield({ coarsePointer: false, reducedMotion: false, low: false });
    expectFreed(partsOf(stars.object), () => stars.dispose());
  });

  it('frees the sky’s panorama, its program and its triangle', () => {
    const renderer = {
      setRenderTarget: () => undefined,
      compileAsync: () => new Promise<void>(() => undefined),
      render: () => undefined,
      properties: { get: () => ({}) },
    } as unknown as WebGLRenderer;
    const sky = new SkyBake({
      renderer,
      tier: tuning.look.sky.tiers.low,
      seen: false,
      reducedMotion: false,
      onState: () => undefined,
      onBand: () => undefined,
    });
    const { triangle } = sky as unknown as { triangle: Mesh };
    expectFreed([sky.pano, ...partsOf(triangle)], () => sky.dispose());
  });
});
