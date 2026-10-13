import { describe, expect, it } from 'vitest';
import type { Point, Rgb } from './meshBuilder';
import {
  finish,
  generatePlanet,
  planetTriangleCount,
  shapeNormal,
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
    // The SHAPE: where every corner is. Computed by the generator of main at f78b64d (git show
    // f78b64d:src/universe/sim/planet.ts), before `flat`, `shape`, `up` and `paint`, with this
    // look and these bands (its positions alone, 2026-10-02: the pin used to cover normals and
    // colours too). A planet in flight is exactly this code path, so a change here reshapes
    // every world.
    // The PICTURE on it: its normals, colours and the lines through its facets, as of the look
    // pass that made the worlds round ("Deep light", step 2b, 2026-10-02). Before it the normals
    // were a facet's own and a facet had one colour. And how those lines bend, since an outline
    // is an arc inside a facet (the same day): the lines moved too, to where the ground's own
    // height puts them halfway along each edge.
    for (const [seed, radius, detail, shape, picture] of [
      ['pin', 8, 5, '704547c5', 'c779c19f'],
      ['project/robotics', 1, 8, '0b6c7c25', '0239cb80'],
      ['about', 14, 3, 'f75faf1a', '1813bb45'],
    ] as const) {
      const mesh = finish(generatePlanet({ seed, radius, detail, bands: BANDS }, LOOK));
      expect(mesh.triangleCount).toBe(planetTriangleCount(detail));
      expect(fingerprint(mesh.positions), seed).toBe(shape);
      expect(
        fingerprint(
          mesh.normals,
          mesh.colors,
          mesh.sides ?? new Float32Array(0),
          mesh.bends ?? new Float32Array(0),
        ),
        seed,
      ).toBe(picture);
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
    // Asked along every facet's outline, so that an edge of paint can run through a facet.
    expect(places.length).toBeGreaterThan(planetTriangleCount(5));
    // colat 0.2 is 36 degrees from the pole: a cap, and only a cap.
    const rim = Math.cos(0.2 * Math.PI);
    let red = 0;
    let split = 0;
    for (let t = 0; t < cap.triangleCount; t += 1) {
      const ys = [1, 4, 7].map((k) => cap.positions[t * 9 + k] ?? NaN);
      const isRed = cap.colors[t * 9] === 1 && cap.colors[t * 9 + 1] === 0;
      const side = cap.sides?.subarray(t * 24, t * 24 + 24);
      const two = side?.some((value) => value !== 0) ?? false;
      if (isRed && !two) red += 1;
      if (two) split += 1;
      // A facet wholly inside the cap is red and only red; wholly outside it, not red at all;
      // one the rim runs through has both colours.
      if (Math.min(...ys) > rim + 1e-3) expect(isRed && !two).toBe(true);
      else if (Math.max(...ys) < rim - 1e-3) expect(isRed || two).toBe(false);
      else if (Math.min(...ys) < rim - 0.01 && Math.max(...ys) > rim + 0.01) expect(two).toBe(true);
    }
    expect(red).toBeGreaterThan(0);
    expect(split).toBeGreaterThan(0);
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

describe('a round world on a mesh of facets', () => {
  /**
   * The colour at a place on triangle `t` (its share of each corner), as the toon shader draws it
   * (design/shaders/toonFlat.ts): the facet's colour, its side's where the side's line (bent by
   * its arc) is past a half, its over's where that one's is.
   */
  function colourAt(mesh: ReturnType<typeof build>, t: number, share: Point): number[] {
    const side = (o: number): { c: number[]; k: number } => {
      // Where the place stands on the line, and how far along it: the line bends by its arc.
      const mixed = (values: Float32Array | undefined, stride: number, at: number): number =>
        [0, 1, 2].reduce(
          (sum, v) => sum + (values?.[(t * 3 + v) * stride + at] ?? 0) * (share[v] ?? 0),
          0,
        );
      const along = Math.min(1, Math.max(0, mixed(mesh.bends, 4, o / 2)));
      const bend = mesh.bends?.[t * 12 + o / 2 + 1] ?? 0;
      return {
        c: Array.from(mesh.sides?.subarray(t * 24 + o, t * 24 + o + 3) ?? [0, 0, 0]),
        k: mixed(mesh.sides, 8, o + 3) + bend * along * (1 - along),
      };
    };
    const [first, over] = [side(0), side(4)];
    if (over.k > 0.5) return over.c;
    if (first.k > 0.5) return first.c;
    return Array.from(mesh.colors.subarray(t * 9, t * 9 + 3));
  }
  const corner = (mesh: ReturnType<typeof build>, t: number, v: number): Point => [
    mesh.positions[(t * 3 + v) * 3] ?? 0,
    mesh.positions[(t * 3 + v) * 3 + 1] ?? 0,
    mesh.positions[(t * 3 + v) * 3 + 2] ?? 0,
  ];
  /** Shares of the three corners, spread over the facet and off its edges. */
  const SHARES: Point[] = [
    [0.8, 0.1, 0.1],
    [0.1, 0.8, 0.1],
    [0.1, 0.1, 0.8],
    [0.45, 0.45, 0.1],
    [0.1, 0.45, 0.45],
    [0.45, 0.1, 0.45],
    [0.34, 0.33, 0.33],
  ];

  /** And a fine grid of them: 55 places a facet. */
  const FINE: Point[] = [];
  for (let i = 1; i < 12; i += 1)
    for (let j = 1; j < 12 - i; j += 1) FINE.push([i / 12, j / 12, 1 - (i + j) / 12]);

  it('carries the normal of the ball at every corner, whatever the relief', () => {
    const mesh = build();
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const at: Point = [
        mesh.positions[i] ?? 0,
        mesh.positions[i + 1] ?? 0,
        mesh.positions[i + 2] ?? 0,
      ];
      const r = Math.hypot(...at);
      for (let k = 0; k < 3; k += 1) expect(mesh.normals[i + k]).toBeCloseTo((at[k] ?? 0) / r, 5);
    }
  });

  it('shapeNormal: a ball’s is its direction, a rounded box’s is flat on a face and turns at an edge', () => {
    const d: Point = [0.6, 0.8, 0];
    expect(shapeNormal(d, { p: 2, s: [1, 1, 1] })).toEqual(d);
    const box = { p: 4, s: [1, 1, 1] } as const;
    expect(shapeNormal([0, 1, 0], box)).toEqual([0, 1, 0]);
    // Just off the middle of a face it still points nearly straight out: the face is flat.
    const near = shapeNormal([0.2, 0.98, 0], box);
    expect(near[1]).toBeGreaterThan(0.99);
    // An ellipsoid's leans toward its short axis.
    const egg = shapeNormal([Math.SQRT1_2, Math.SQRT1_2, 0], { p: 2, s: [2, 1, 1] });
    expect(egg[1]).toBeGreaterThan(egg[0]);
    expect(Math.hypot(...egg)).toBeCloseTo(1, 12);
    // And the mesh carries it.
    const mesh = build({ flat: 0.3, shape: box });
    for (let i = 0; i < mesh.normals.length; i += 3) {
      expect(
        Math.hypot(mesh.normals[i] ?? 0, mesh.normals[i + 1] ?? 0, mesh.normals[i + 2] ?? 0),
      ).toBeCloseTo(1, 5);
    }
  });

  it('draws an edge of paint THROUGH the facets it crosses: every place is the colour paint gives it', () => {
    // A cap whose rim crosses facets at every angle. With one colour a facet the rim was a
    // staircase of triangles, wrong by up to half a facet (five degrees here).
    const inCap = (d: Point): boolean => Math.acos(d[1]) / Math.PI < 0.2;
    const mesh = build({
      flat: 0.3,
      detail: 8,
      paint: ({ colat }) => (colat < 0.2 ? RED : undefined),
    });
    let wrong = 0;
    let near = 0;
    for (let t = 0; t < mesh.triangleCount; t += 1) {
      for (const share of [...SHARES, ...FINE]) {
        const at = [0, 1, 2].map((axis) =>
          [0, 1, 2].reduce((sum, v) => sum + (corner(mesh, t, v)[axis] ?? 0) * (share[v] ?? 0), 0),
        );
        const length = Math.hypot(at[0] ?? 0, at[1] ?? 0, at[2] ?? 0);
        const d: Point = [(at[0] ?? 0) / length, (at[1] ?? 0) / length, (at[2] ?? 0) / length];
        // Within a thirtieth of a degree of the rim either colour will do. (The line is an arc
        // through the rim's own middle in the facet: as a chord it was wrong up to a tenth of a
        // degree, ten times that.)
        if (Math.abs(Math.acos(d[1]) / Math.PI - 0.2) < 0.0002) {
          near += 1;
          continue;
        }
        const red = colourAt(mesh, t, share)[1] === 0;
        if (red !== inCap(d)) wrong += 1;
      }
    }
    expect(wrong).toBe(0);
    expect(near).toBeLessThan(200);
    // And the arcs are there: most facets the rim crosses carry a bend.
    let bent = 0;
    for (let t = 0; t < mesh.triangleCount; t += 1) if (mesh.bends?.[t * 12 + 1]) bent += 1;
    expect(bent).toBeGreaterThan(20);
  });

  it('draws a stripe thinner than a facet as a stripe: two lines through each facet it crosses', () => {
    const inStripe = (colat: number): boolean => colat > 0.3 && colat < 0.33;
    const mesh = build({
      flat: 0.3,
      detail: 8,
      paint: ({ colat }) => (inStripe(colat) ? RED : undefined),
    });
    let three = 0;
    let wrong = 0;
    let asked = 0;
    for (let t = 0; t < mesh.triangleCount; t += 1) {
      if (mesh.sides?.subarray(t * 24 + 4, t * 24 + 7).some((value) => value !== 0)) three += 1;
      for (const share of SHARES) {
        const at = [0, 1, 2].map((axis) =>
          [0, 1, 2].reduce((sum, v) => sum + (corner(mesh, t, v)[axis] ?? 0) * (share[v] ?? 0), 0),
        );
        const colat =
          Math.acos((at[1] ?? 0) / Math.hypot(at[0] ?? 0, at[1] ?? 0, at[2] ?? 0)) / Math.PI;
        if (Math.abs(colat - 0.3) < 0.003 || Math.abs(colat - 0.33) < 0.003) continue;
        asked += 1;
        if ((colourAt(mesh, t, share)[1] === 0) !== inStripe(colat)) wrong += 1;
      }
    }
    // The stripe is 5.4 degrees wide and a facet 5 to 7: some facets it crosses hold both edges.
    expect(three).toBeGreaterThan(10);
    expect(wrong / asked).toBeLessThan(0.002);
  });

  it('draws a coast and the bands of height as lines too, and neighbours agree along their edge', () => {
    // Every edge is shared by two facets: at places along it both must show the same colour, or
    // an outline would break at the edge. (No nudge: with one, two neighbours' shades of one
    // band differ by it.)
    const key = (p: Point): string => p.map((v) => Math.round(v * 1e5)).join();
    const measure = (look: Partial<PlanetLook>): { lines: number; broken: number } => {
      const mesh = finish(
        generatePlanet(
          { seed: 'pin', radius: 1, detail: 8, bands: BANDS },
          { ...LOOK, colorJitter: 0, ...look },
        ),
      );
      const seen = new Map<string, number[][]>();
      let edges = 0;
      let broken = 0;
      let lines = 0;
      for (let t = 0; t < mesh.triangleCount; t += 1) {
        if (mesh.sides?.subarray(t * 24, t * 24 + 24).some((value) => value !== 0)) lines += 1;
        for (let v = 0; v < 3; v += 1) {
          const w = (v + 1) % 3;
          const [a, b] = [key(corner(mesh, t, v)), key(corner(mesh, t, w))];
          const forward = a < b;
          const colours = [0.2, 0.4, 0.6, 0.8].map((along) => {
            const share = [0, 0, 0];
            share[v] = forward ? 1 - along : along;
            share[w] = forward ? along : 1 - along;
            // A hair inside the facet, so that a line that ends ON the edge is on one side of it.
            const inside = share.map((value) => value * 0.999 + 0.001 / 3) as unknown as Point;
            return colourAt(mesh, t, inside);
          });
          const name = forward ? `${a}|${b}` : `${b}|${a}`;
          const other = seen.get(name);
          if (!other) seen.set(name, colours);
          else {
            edges += 1;
            if (String(other) !== String(colours)) broken += 1;
          }
        }
      }
      expect(edges).toBe((mesh.triangleCount * 3) / 2);
      return { lines: lines / mesh.triangleCount, broken: broken / edges };
    };
    // A sea and two bands of land: hardly a facet holds more than two lines, and hardly an
    // outline breaks.
    const gentle = measure({ terraces: 2, bandStops: [0.5, 9, 9] });
    expect(gentle.lines).toBeGreaterThan(0.15);
    expect(gentle.broken).toBeLessThan(0.005);
    // Four terraces in five colours on facets of seven degrees: more than a third of the facets
    // hold a line, and where one holds more than two lines the sliver beyond the second takes
    // its neighbour's colour, so an outline may step there, by a sliver. (0.073 while an outline
    // was a chord; 0.103 since it is an arc: the ground's own height halfway along each edge
    // finds capes a chord never saw, and a quarter of these facets now want a third line. The
    // terrains the worlds use, three or four colours at most, are under 0.03.)
    const steep = measure({});
    expect(steep.lines).toBeGreaterThan(0.3);
    expect(steep.broken).toBeLessThan(0.12);
    // The home planet's terrain, as tuned (design/tuning.ts, `terrain.continents`).
    const home = measure({
      frequency: 1,
      octaves: 3,
      seaLevel: 0.02,
      peakAt: 0.6,
      terraces: 3,
      terraceStrength: 0.7,
      bandStops: [0.12, 0.5, 0.92],
    });
    expect(home.broken).toBeLessThan(0.01);
  });

  it('keeps a lit colour exact: both colours of a facet are the bands’ own, with no nudge between', () => {
    const still: PlanetLook = { ...LOOK, colorJitter: 0 };
    const mesh = finish(generatePlanet({ seed: 'pin', radius: 1, detail: 6, bands: BANDS }, still));
    const bands = new Set(
      Object.values(BANDS).map((band) => String(Array.from(new Float32Array(band)))),
    );
    for (let t = 0; t < mesh.triangleCount; t += 1) {
      expect(bands.has(String(Array.from(mesh.colors.subarray(t * 9, t * 9 + 3))))).toBe(true);
      const side = mesh.sides?.subarray(t * 24, t * 24 + 24);
      if (!side?.some((value) => value !== 0)) continue;
      expect(bands.has(String(Array.from(side.subarray(0, 3))))).toBe(true);
      const over = Array.from(side.subarray(4, 7));
      if (over.some((value) => value !== 0)) expect(bands.has(String(over))).toBe(true);
    }
  });
});
