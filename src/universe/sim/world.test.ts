import { describe, expect, it } from 'vitest';
import { TAU } from './math';
import { createNoise3, fbm } from './noise';
import { bodyPositionAt, bodyPositions, createOrbitTable } from './orbits';
import {
  finish,
  generatePlanet,
  planetTriangleCount,
  type PlanetLook,
  type PlanetSpec,
} from './planet';

describe('simplex noise', () => {
  it('is the same for the same seed, different for another, and stays within [-1, 1]', () => {
    const a = createNoise3('fishai');
    const again = createNoise3('fishai');
    const other = createNoise3('days2meet');
    let differs = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 4000; i += 1) {
      const x = Math.sin(i * 12.9898) * 8;
      const y = Math.cos(i * 78.233) * 8;
      const z = Math.sin(i * 37.719) * 8;
      const value = a(x, y, z);
      expect(value).toBe(again(x, y, z));
      if (value !== other(x, y, z)) differs += 1;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    expect(differs).toBeGreaterThan(3900);
    expect(min).toBeGreaterThanOrEqual(-1);
    expect(max).toBeLessThanOrEqual(1);
    // It actually uses its range: terrain needs both seas and peaks.
    expect(min).toBeLessThan(-0.6);
    expect(max).toBeGreaterThan(0.6);
  });

  it('is smooth: neighbouring points have neighbouring values', () => {
    const noise = createNoise3('smooth');
    for (let i = 0; i < 500; i += 1) {
      const x = i * 0.137;
      expect(Math.abs(noise(x, 0.4, -2) - noise(x + 0.001, 0.4, -2))).toBeLessThan(0.02);
    }
  });

  it('sums octaves without leaving [-1, 1]', () => {
    const noise = createNoise3('fbm');
    for (let i = 0; i < 2000; i += 1) {
      const value = fbm(noise, i * 0.31, i * -0.17, i * 0.05, 4);
      expect(Math.abs(value)).toBeLessThanOrEqual(1);
    }
    expect(fbm(noise, 1, 2, 3, 0)).toBe(0);
  });
});

describe('orbits', () => {
  const systems = [
    { id: 'home', position: [0, 0] as const },
    { id: 'code', position: [-700, 600] as const },
  ];
  const bodies = [
    // Deliberately listed child first: the table must sort parents before children.
    {
      id: 'moon',
      parent: 'planet',
      system: 'code',
      orbit: { radius: 30, phase: 0, periodSec: 100 },
    },
    {
      id: 'planet',
      parent: 'sun',
      system: 'code',
      orbit: { radius: 100, phase: TAU / 4, periodSec: 400 },
    },
    { id: 'sun', parent: null, system: 'code', orbit: null },
    { id: 'homeworld', parent: null, system: 'home', orbit: null },
  ];
  const table = createOrbitTable(systems, bodies);
  const at = (t: number, id: string, velocities?: Float64Array): [number, number] => {
    const out = bodyPositions(table, t, new Float64Array(table.count * 2), velocities);
    const i = table.indexOf(id);
    return [out[i * 2] ?? NaN, out[i * 2 + 1] ?? NaN];
  };

  it('puts a body with no orbit at the centre of its system, for ever', () => {
    expect(at(0, 'sun')).toEqual([-700, 600]);
    expect(at(12345, 'sun')).toEqual([-700, 600]);
    expect(at(99, 'homeworld')).toEqual([0, 0]);
  });

  it('starts a body at its phase (0 is +Z, counter-clockwise from above) and brings it back after one period', () => {
    const [x, z] = at(0, 'planet'); // a quarter turn from +Z is +X
    expect(x).toBeCloseTo(-700 + 100, 9);
    expect(z).toBeCloseTo(600, 9);
    const [x1, z1] = at(100, 'planet'); // a quarter period later: another quarter turn, to -Z
    expect(x1).toBeCloseTo(-700, 9);
    expect(z1).toBeCloseTo(600 - 100, 9);
    const [x2, z2] = at(400, 'planet');
    expect(x2).toBeCloseTo(x, 9);
    expect(z2).toBeCloseTo(z, 9);
  });

  it('carries moons along with their planet', () => {
    for (const t of [0, 37, 250.5]) {
      const [px, pz] = at(t, 'planet');
      const [mx, mz] = at(t, 'moon');
      expect(Math.hypot(mx - px, mz - pz)).toBeCloseTo(30, 9);
    }
  });

  it('reports velocities that match how the positions actually change', () => {
    const velocities = new Float64Array(table.count * 2);
    const dt = 1e-4;
    for (const id of ['planet', 'moon', 'sun']) {
      const [x0, z0] = at(50, id, velocities);
      const i = table.indexOf(id);
      const [vx, vz] = [velocities[i * 2] ?? NaN, velocities[i * 2 + 1] ?? NaN];
      const [x1, z1] = at(50 + dt, id);
      expect((x1 - x0) / dt).toBeCloseTo(vx, 3);
      expect((z1 - z0) / dt).toBeCloseTo(vz, 3);
    }
  });

  it('tells where ONE body is at any time, exactly as it tells for all of them', () => {
    const one = new Float64Array(2);
    for (const t of [0, 37, 250.5, 9999]) {
      for (const id of ['sun', 'planet', 'moon', 'homeworld']) {
        bodyPositionAt(table, table.indexOf(id), t, one);
        expect([one[0], one[1]]).toEqual(at(t, id));
      }
    }
  });

  it('turns a binary star: two suns round an empty centre, each carrying its planets and moons', () => {
    // As the build lays one out (data/layout.ts, binaryOrbits): suns a = 133.8 and b = 287.8 u
    // from the centre, half a turn apart, with one period; a family round each.
    const [a, b, period] = [133.8, 287.8, 4470.3];
    const binary = createOrbitTable(
      [{ id: 'projects', position: [-487.9, 487.9] as const }],
      [
        {
          id: 'moon',
          parent: 'planet',
          system: 'projects',
          orbit: { radius: 26.4, phase: 2, periodSec: 90 },
        },
        {
          id: 'planet',
          parent: 'software',
          system: 'projects',
          orbit: { radius: 156.4, phase: 0.5, periodSec: 1180 },
        },
        {
          id: 'software',
          parent: null,
          system: 'projects',
          orbit: { radius: a, phase: 1.2345, periodSec: period },
        },
        {
          id: 'hardware',
          parent: null,
          system: 'projects',
          orbit: { radius: b, phase: 1.2345 + Math.PI, periodSec: period },
        },
        {
          id: 'rocket',
          parent: 'hardware',
          system: 'projects',
          orbit: { radius: 60.2, phase: 4, periodSec: 241.2 },
        },
      ],
    );
    const positions = new Float64Array(binary.count * 2);
    const velocities = new Float64Array(binary.count * 2);
    const at = (id: string, from: Float64Array = positions): [number, number] => {
      const i = binary.indexOf(id);
      return [from[i * 2] ?? NaN, from[i * 2 + 1] ?? NaN];
    };
    const one = new Float64Array(2);
    const dt = 1e-4;
    for (const t of [0, 1000, 5000]) {
      bodyPositions(binary, t, positions, velocities);
      const [sx, sz] = at('software');
      const [hx, hz] = at('hardware');
      // Each sun on its own circle round the centre, on opposite sides of it: a constant pair.
      expect(Math.hypot(sx + 487.9, sz - 487.9)).toBeCloseTo(a, 9);
      expect(Math.hypot(hx + 487.9, hz - 487.9)).toBeCloseTo(b, 9);
      expect(Math.hypot(sx - hx, sz - hz)).toBeCloseTo(a + b, 9);
      expect(((sx + 487.9) * b + (hx + 487.9) * a) / (a + b)).toBeCloseTo(0, 9);
      expect(((sz - 487.9) * b + (hz - 487.9) * a) / (a + b)).toBeCloseTo(0, 9);
      // A planet circles its moving sun, and a moon its planet, whatever the sun is doing.
      const [px, pz] = at('planet');
      const [mx, mz] = at('moon');
      const [rx, rz] = at('rocket');
      expect(Math.hypot(px - sx, pz - sz)).toBeCloseTo(156.4, 9);
      expect(Math.hypot(mx - px, mz - pz)).toBeCloseTo(26.4, 9);
      expect(Math.hypot(rx - hx, rz - hz)).toBeCloseTo(60.2, 9);
      // Velocities add down the chain: they match how the positions really change.
      const later = bodyPositions(binary, t + dt, new Float64Array(binary.count * 2));
      for (const id of ['software', 'hardware', 'planet', 'moon', 'rocket']) {
        const [x0, z0] = at(id);
        const [x1, z1] = at(id, later);
        const [vx, vz] = at(id, velocities);
        expect((x1 - x0) / dt, `${id} at ${t}`).toBeCloseTo(vx, 3);
        expect((z1 - z0) / dt, `${id} at ${t}`).toBeCloseTo(vz, 3);
        // And one body alone is exactly where the whole pass puts it.
        bodyPositionAt(binary, binary.indexOf(id), t, one);
        expect([one[0], one[1]], `${id} at ${t}`).toEqual(at(id));
      }
    }
  });

  it('refuses a manifest that does not add up', () => {
    const moon = { id: 'moon', system: 'code', orbit: { radius: 30, phase: 0, periodSec: 100 } };
    expect(() => createOrbitTable(systems, [{ ...moon, parent: 'nobody' }])).toThrow(
      /unknown 'nobody'/,
    );
    expect(() =>
      createOrbitTable(systems, [{ id: 'sun', parent: null, system: 'nowhere', orbit: null }]),
    ).toThrow(/unknown system/);
    expect(() =>
      createOrbitTable(systems, [
        { ...moon, id: 'a', parent: 'b' },
        { ...moon, id: 'b', parent: 'a' },
      ]),
    ).toThrow(/circles itself/);
  });
});

describe('the planet generator', () => {
  const look: PlanetLook = {
    reliefShare: 0.08,
    frequency: 1.5,
    octaves: 4,
    seaLevel: -0.05,
    peakAt: 0.55,
    terraces: 4,
    terraceStrength: 0.6,
    bandStops: [0.12, 0.5, 0.82],
    colorJitter: 0,
  };
  const bands = {
    sea: [0, 0, 1],
    shore: [1, 1, 0],
    low: [0, 1, 0],
    high: [0, 0.5, 0],
    peak: [1, 1, 1],
  } as const;
  const spec = (seed: string, detail = 8, radius = 8): PlanetSpec => ({
    radius,
    seed,
    detail,
    bands,
  });

  it('builds 20 * (detail + 1)^2 facets that all face outwards, between sea level and the highest peak', () => {
    for (const detail of [0, 2, 8]) {
      const mesh = finish(generatePlanet(spec('fishai', detail), look));
      expect(mesh.triangleCount).toBe(planetTriangleCount(detail));
      for (let t = 0; t < mesh.triangleCount; t += 1) {
        let cx = 0;
        let cy = 0;
        let cz = 0;
        for (let v = 0; v < 3; v += 1) {
          const at = (t * 3 + v) * 3;
          const [x, y, z] = [
            mesh.positions[at] ?? 0,
            mesh.positions[at + 1] ?? 0,
            mesh.positions[at + 2] ?? 0,
          ];
          const r = Math.hypot(x, y, z);
          expect(r).toBeGreaterThan(8 - 1e-4);
          expect(r).toBeLessThan(8 * 1.08 + 1e-4);
          cx += x;
          cy += y;
          cz += z;
        }
        const facing =
          (mesh.normals[t * 9] ?? 0) * cx +
          (mesh.normals[t * 9 + 1] ?? 0) * cy +
          (mesh.normals[t * 9 + 2] ?? 0) * cz;
        expect(facing).toBeGreaterThan(0);
      }
    }
  });

  it('is the same planet for the same seed, and another planet for another', () => {
    const a = finish(generatePlanet(spec('fishai'), look));
    const again = finish(generatePlanet(spec('fishai'), look));
    const other = finish(generatePlanet(spec('days2meet'), look));
    expect(a.positions).toEqual(again.positions);
    expect(a.colors).toEqual(again.colors);
    expect(a.positions).not.toEqual(other.positions);
  });

  it('has seas AND land, painted only with the bands it was given', () => {
    for (const seed of ['fishai', 'days2meet', 'about', 'canadian-fish-demo']) {
      const mesh = finish(generatePlanet(spec(seed), look));
      const seen = new Set<string>();
      for (let t = 0; t < mesh.triangleCount; t += 1) {
        seen.add([mesh.colors[t * 9], mesh.colors[t * 9 + 1], mesh.colors[t * 9 + 2]].join());
      }
      const allowed = new Set(Object.values(bands).map((band) => new Float32Array(band).join()));
      for (const color of seen) expect(allowed.has(color)).toBe(true);
      expect(seen.has(new Float32Array(bands.sea).join())).toBe(true);
      expect(seen.size).toBeGreaterThanOrEqual(3);
    }
  });

  it('can be built a slice at a time: it pauses after each of the 20 faces', () => {
    const job = generatePlanet(spec('sliced', 4), look);
    let pauses = 0;
    let step = job.next();
    while (!step.done) {
      pauses += 1;
      step = job.next();
    }
    expect(pauses).toBe(20);
    expect(step.value.triangleCount).toBe(planetTriangleCount(4));
  });

  it('is cheap enough: a near-detail planet builds in well under a frame or two', () => {
    const started = performance.now();
    finish(generatePlanet(spec('speed', 14, 12), look));
    // Generous: CI machines are slow and noisy. On a laptop this is a few milliseconds.
    expect(performance.now() - started).toBeLessThan(250);
  });
});
