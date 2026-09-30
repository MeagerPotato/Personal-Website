import { describe, expect, it } from 'vitest';
import type { Point, Rgb } from './meshBuilder';
import {
  finish,
  generatePlanet,
  planetTriangleCount,
  shapePoint,
  type FacetPlace,
  type PlanetBands,
  type PlanetLook,
  type PlanetSpec,
} from './planet';

// The generator's options for worlds of their own (flat, shape, up, paint). The generator itself
// is tested in world.test.ts; this file pins that without the options it is untouched.

/** FNV-1a over the bytes of the mesh: one number that changes if any bit of it does. */
function fingerprint(...arrays: Float32Array[]): string {
  let hash = 0x811c9dc5;
  for (const array of arrays) {
    for (const byte of new Uint8Array(array.buffer, array.byteOffset, array.byteLength)) {
      hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, '0');
}

// A fixed look and five fixed colours, not tuning.ts and the tokens: the pin must not move when
// the design does. (The look is the generated planets' of 2026-09-30, frozen here.)
const LOOK: PlanetLook = {
  reliefShare: 0.05,
  frequency: 1.45,
  octaves: 4,
  seaLevel: -0.04,
  peakAt: 0.5,
  terraces: 4,
  terraceStrength: 0.6,
  bandStops: [0.1, 0.46, 0.8],
  colorJitter: 0.03,
};
const BANDS: PlanetBands = {
  sea: [0.2, 0.4, 0.8],
  shore: [0.9, 0.8, 0.5],
  low: [0.4, 0.7, 0.3],
  high: [0.3, 0.5, 0.35],
  peak: [0.95, 0.95, 0.9],
};
const RED: Rgb = [1, 0, 0];

const build = (spec: Partial<PlanetSpec> = {}) =>
  finish(generatePlanet({ seed: 'pin', radius: 1, detail: 5, bands: BANDS, ...spec }, LOOK));

/** Every vertex of a mesh. */
function vertices(positions: Float32Array): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    out.push([positions[i] ?? NaN, positions[i + 1] ?? NaN, positions[i + 2] ?? NaN]);
  }
  return out;
}

describe('the planet generator, without the options of sim/world', () => {
  it('makes, bit for bit, the planets it made before they existed', () => {
    // Computed by the generator of main at f78b64d (git show f78b64d:src/universe/sim/planet.ts),
    // before `flat`, `shape`, `up` and `paint`, with this look and these bands (2026-09-30). A
    // planet in flight is exactly this code path, so a change here reshapes every world.
    for (const [seed, radius, detail, expected] of [
      ['pin', 8, 5, 'bbf66146'],
      ['project/robotics', 1, 8, 'd86e73a1'],
      ['about', 14, 3, '33f423de'],
    ] as const) {
      const mesh = finish(generatePlanet({ seed, radius, detail, bands: BANDS }, LOOK));
      expect(mesh.triangleCount).toBe(planetTriangleCount(detail));
      expect(fingerprint(mesh.positions, mesh.normals, mesh.colors), seed).toBe(expected);
    }
  });
});

describe('the options for worlds of their own', () => {
  it('flat: a smooth ball at one radius, one band, with the same facets', () => {
    const mesh = build({ flat: 0.3 });
    expect(mesh.triangleCount).toBe(planetTriangleCount(5));
    for (const [x, y, z] of vertices(mesh.positions)) expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
    // 0.3 is between the stops 0.1 and 0.46: the low band, nudged by at most the jitter.
    const jitter = LOOK.colorJitter;
    for (let i = 0; i < mesh.colors.length; i += 3) {
      const ratio = (mesh.colors[i + 1] ?? 0) / BANDS.low[1];
      expect(ratio).toBeGreaterThanOrEqual(1 - jitter - 1e-6);
      expect(ratio).toBeLessThanOrEqual(1 + jitter + 1e-6);
    }
  });

  it('flat below zero is all sea', () => {
    const mesh = build({ flat: -1 });
    const green = mesh.colors.filter((_, i) => i % 3 === 1);
    for (const g of green) {
      expect(Math.abs(g / BANDS.sea[1] - 1)).toBeLessThanOrEqual(LOOK.colorJitter + 1e-6);
    }
  });

  it('shape: every corner lies on the superellipsoid', () => {
    const shape = { p: 4, s: [1.3, 0.74, 0.76] as const };
    const mesh = build({ flat: 0.5, shape });
    for (const [x, y, z] of vertices(mesh.positions)) {
      const sum =
        (Math.abs(x / 1.3) ** 4 + Math.abs(y / 0.74) ** 4 + Math.abs(z / 0.76) ** 4) ** 0.25;
      expect(sum).toBeCloseTo(1, 5);
    }
    // And with relief: the noise is sampled in the same directions, so the shape only scales it.
    const round = build();
    const egg = build({ shape: { p: 2, s: [1, 1, 1] } });
    expect([...egg.positions]).toEqual([...round.positions]);
  });

  it('shapePoint: an ellipsoid is the sphere scaled, a rounded box is found along the ray', () => {
    expect(shapePoint([0, 1, 0], { p: 2, s: [2, 3, 4] })).toEqual([0, 3, 0]);
    const d: Point = [Math.SQRT1_2, Math.SQRT1_2, 0];
    const [x, y] = shapePoint(d, { p: 4, s: [1, 1, 1] });
    expect(x ** 4 + y ** 4).toBeCloseTo(1, 12);
    expect(x).toBeCloseTo(y, 12);
  });

  it("up: 'vertex' puts a corner exactly on the north pole", () => {
    // An odd number of steps along an edge, so that no subdivision point lands on the pole
    // by itself (the midpoint of the top edge would).
    const tops = (spec: Partial<PlanetSpec>) =>
      vertices(build({ flat: 0.3, detail: 4, ...spec }).positions).filter(([, y]) => y > 1 - 1e-6);
    expect(tops({ up: 'vertex' }).length).toBeGreaterThan(0);
    expect(tops({})).toEqual([]);
  });

  it('paint: recolours the facets it answers for, where they are, and leaves the rest', () => {
    const places: FacetPlace[] = [];
    const cap = build({
      flat: 0.3,
      up: 'vertex',
      paint: (place) => {
        places.push(place);
        return place.colat < 0.2 ? RED : undefined;
      },
    });
    expect(places).toHaveLength(planetTriangleCount(5));
    // colat 0.2 is 36 degrees from the pole: a cap, and only a cap.
    const rim = Math.cos(0.2 * Math.PI);
    let red = 0;
    for (let t = 0; t < cap.triangleCount; t += 1) {
      const at = (k: number): number => cap.positions[t * 9 + k] ?? NaN;
      const y = (at(1) + at(4) + at(7)) / 3;
      const isRed = cap.colors[t * 9] === 1 && cap.colors[t * 9 + 1] === 0;
      if (isRed) red += 1;
      if (y > rim + 0.03) expect(isRed).toBe(true);
      if (y < rim - 0.03) expect(isRed).toBe(false);
    }
    expect(red).toBeGreaterThan(0);
    for (const { d, colat, az } of places) {
      expect(Math.hypot(...d)).toBeCloseTo(1, 12);
      expect(colat).toBeGreaterThanOrEqual(0);
      expect(colat).toBeLessThanOrEqual(1);
      expect(Math.abs(az)).toBeLessThanOrEqual(Math.PI);
    }
  });

  it('paint never changes the nudge of the facets it leaves alone', () => {
    const plain = build({ flat: 0.3 });
    const some = build({ flat: 0.3, paint: (place) => (place.d[0] > 0.5 ? RED : undefined) });
    for (let i = 0; i < plain.colors.length; i += 9) {
      if (some.colors[i] === 1 && some.colors[i + 1] === 0) continue;
      expect(some.colors[i]).toBe(plain.colors[i]);
    }
  });
});
