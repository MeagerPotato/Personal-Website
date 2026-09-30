import { describe, expect, it } from 'vitest';
import { buildUniverse } from '../data/build';
import type { ProjectInput, UniverseInput } from '../data/types';
import { tuning } from '../design/tuning';
import { familyReaches } from './families';
import { createOrbitTable, type OrbitTable } from './orbits';

const project = (id: string, over: Partial<ProjectInput>): ProjectInput => ({
  id,
  title: id,
  href: `/projects/${id}/`,
  date: '2026-01',
  size: 'm',
  biome: 'terra',
  rings: false,
  decorMoons: 0,
  flagship: false,
  related: [],
  draft: false,
  ...over,
});

// Three systems of planets with moons, and the home system with its station and satellite: every
// depth of family there is.
const INPUT: UniverseInput = {
  systems: ['code', 'rocketry', 'empty'].map((id, index) => ({
    id,
    name: id,
    href: `/systems/${id}/`,
    theme: 'sky',
    order: index + 1,
    position: 'auto',
  })),
  projects: [
    project('fishai', { system: 'code', size: 'l', date: '2026-07' }),
    project('fish-demo', { parent: 'fishai', size: 's' }),
    project('fish-onboarding', { parent: 'fishai', size: 'm' }),
    project('days2meet', { system: 'code', date: '2026-03' }),
    project('odds', { system: 'code', size: 's', date: '2025-05' }),
    project('staged-recovery', { system: 'rocketry', size: 'l', date: '2024-07' }),
    project('payload', { parent: 'staged-recovery', size: 'm' }),
    project('arc-team', { system: 'rocketry', date: '2023-05' }),
  ],
  pages: [
    { id: 'about', title: 'About', href: '/about/', dock: 'home' },
    { id: 'resume', title: 'Resume', href: '/resume/', dock: 'station' },
    { id: 'contact', title: 'Contact', href: '/contact/', dock: 'satellite' },
  ],
  includeDrafts: false,
};
const MANIFEST = buildUniverse(INPUT);
const ORBITS = createOrbitTable(MANIFEST.systems, MANIFEST.bodies);
const byId = new Map(MANIFEST.bodies.map((body) => [body.id, body]));
const RINGS = Float64Array.from(ORBITS.ids, (id) => byId.get(id)?.dockRadius ?? 0);

/** The loop the autopilot ran before it asked families.ts, word for word: the reference. */
function before(orbits: OrbitTable, ringRadius: Float64Array, keepOut: number): Float64Array {
  const family = new Float64Array(orbits.count);
  for (let j = 0; j < orbits.count; j += 1) {
    const own = ringRadius[j] ?? 0;
    family[j] = own > 0 ? own + keepOut : 0;
  }
  for (let j = orbits.count - 1; j >= 0; j -= 1) {
    const parent = orbits.parent[j] ?? -1;
    if (parent < 0 || !((family[j] ?? 0) > 0)) continue;
    family[parent] = Math.max(family[parent] ?? 0, (orbits.radius[j] ?? 0) + (family[j] ?? 0));
  }
  return family;
}

describe('familyReaches', () => {
  it('is, bit for bit, what the autopilot worked out for itself before', () => {
    for (const pad of [0, tuning.cruise.keepOut, 3.7]) {
      const out = new Float64Array(ORBITS.count).fill(Number.NaN);
      expect([...familyReaches(ORBITS, RINGS, pad, out)]).toEqual([...before(ORBITS, RINGS, pad)]);
    }
  });

  it('gives a sun with no pad the reach of its system, and home the reach of home', () => {
    const out = familyReaches(ORBITS, RINGS, 0, new Float64Array(ORBITS.count));
    for (const system of MANIFEST.systems) {
      // The build rounds a radius to 0.01 u, and each ring and orbit on the way to it as well.
      expect(out[ORBITS.indexOf(system.center)]).toBeCloseTo(system.radius, 1);
    }
    // A sun with nothing round it reaches as far as its own ring.
    const empty = ORBITS.indexOf('system/empty');
    expect(out[empty]).toBe(byId.get('system/empty')?.dockRadius);
  });

  it('counts a moon in its planet’s family, and the planet’s whole family in its sun’s', () => {
    const out = familyReaches(ORBITS, RINGS, 2, new Float64Array(ORBITS.count));
    const row = (id: string): number => ORBITS.indexOf(id);
    const orbit = (id: string): number => byId.get(id)?.orbit?.radius ?? NaN;
    const ring = (id: string): number => byId.get(id)?.dockRadius ?? NaN;
    // A moon has only itself.
    expect(out[row('project/payload')]).toBe(ring('project/payload') + 2);
    // Its planet reaches to the far side of the moon's ring, keep-out and all.
    expect(out[row('project/staged-recovery')]).toBe(
      orbit('project/payload') + (ring('project/payload') + 2),
    );
    // And the sun to the far side of the furthest family round it.
    const planets = MANIFEST.bodies.filter((body) => body.parent === 'system/rocketry');
    const furthest = Math.max(...planets.map((body) => orbit(body.id) + (out[row(body.id)] ?? 0)));
    expect(out[row('system/rocketry')]).toBe(furthest);
  });

  it('leaves out a body with no ring: it has nothing to keep clear of, and lends nothing', () => {
    const orbits = createOrbitTable(
      [{ id: 's', position: [0, 0] }],
      [
        { id: 'sun', parent: null, system: 's', orbit: null },
        {
          id: 'ghost',
          parent: 'sun',
          system: 's',
          orbit: { radius: 500, phase: 0, periodSec: 60 },
        },
      ],
    );
    const out = familyReaches(orbits, [30, 0], 1, new Float64Array(2));
    expect([...out]).toEqual([31, 0]);
  });
});
