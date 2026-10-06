import { describe, expect, it } from 'vitest';
import {
  CREASE_DEG,
  MeshBuilder,
  POLE_DEG,
  ROUND_FROM,
  type MeshData,
  type Point,
  type Rgb,
} from './meshBuilder';

const RED: Rgb = [1, 0, 0];
const BLUE: Rgb = [0, 0, 1];

interface Face {
  centroid: Point;
  normal: Point;
  color: Rgb;
}

function faces(mesh: MeshData): Face[] {
  const out: Face[] = [];
  for (let t = 0; t < mesh.triangleCount; t += 1) {
    const at = (vertex: number, axis: number): number =>
      mesh.positions[(t * 3 + vertex) * 3 + axis] ?? Number.NaN;
    const mean = (axis: number): number => (at(0, axis) + at(1, axis) + at(2, axis)) / 3;
    out.push({
      centroid: [mean(0), mean(1), mean(2)],
      normal: [
        mesh.normals[t * 9] ?? 0,
        mesh.normals[t * 9 + 1] ?? 0,
        mesh.normals[t * 9 + 2] ?? 0,
      ],
      color: [mesh.colors[t * 9] ?? 0, mesh.colors[t * 9 + 1] ?? 0, mesh.colors[t * 9 + 2] ?? 0],
    });
  }
  return out;
}

const dot = (a: Point, b: Point): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe('MeshBuilder', () => {
  it('gives every triangle one unit normal that follows its winding', () => {
    const mesh = new MeshBuilder().triangle([0, 0, 0], [1, 0, 0], [0, 1, 0], RED).build();
    expect(mesh.triangleCount).toBe(1);
    expect([...mesh.normals]).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    expect([...mesh.colors.slice(0, 3)]).toEqual([1, 0, 0]);
  });

  it('skips degenerate triangles instead of emitting NaN', () => {
    const mesh = new MeshBuilder().triangle([0, 0, 0], [1, 1, 1], [2, 2, 2], RED).build();
    expect(mesh.triangleCount).toBe(0);
  });

  it('builds a body of revolution whose faces all point away from its axis', () => {
    const mesh = new MeshBuilder()
      .lathe(
        [
          { z: -1, radius: 0.5 },
          { z: 0, radius: 0.5 },
          { z: 1, radius: 0 },
        ],
        8,
        [RED, BLUE],
      )
      .build();
    // 8 quads on the tube (16 triangles) + 8 triangles on the cone: the tip's other halves vanish.
    expect(mesh.triangleCount).toBe(24);
    for (const face of faces(mesh)) {
      const outward: Point = [face.centroid[0], face.centroid[1], 0];
      expect(dot(face.normal, outward)).toBeGreaterThan(0);
      expect(face.color).toEqual(face.centroid[2] < 0 ? RED : BLUE);
    }
  });

  it('faces a step backwards when the body widens and forwards when it narrows', () => {
    const widening = new MeshBuilder()
      .lathe(
        [
          { z: 0, radius: 0.2 },
          { z: 0, radius: 0.5 },
        ],
        6,
        [RED],
      )
      .build();
    for (const face of faces(widening)) expect(face.normal[2]).toBeCloseTo(-1, 6);

    const narrowing = new MeshBuilder()
      .lathe(
        [
          { z: 0, radius: 0.5 },
          { z: 0, radius: 0.2 },
        ],
        6,
        [RED],
      )
      .build();
    for (const face of faces(narrowing)) expect(face.normal[2]).toBeCloseTo(1, 6);
  });

  it('builds the INSIDE of a tube when the path is walked backwards', () => {
    const mesh = new MeshBuilder()
      .lathe(
        [
          { z: -0.8, radius: 0 },
          { z: -1, radius: 0.25 },
        ],
        8,
        [RED],
      )
      .build();
    expect(mesh.triangleCount).toBe(8);
    for (const face of faces(mesh)) {
      const outward: Point = [face.centroid[0], face.centroid[1], 0];
      expect(dot(face.normal, outward)).toBeLessThan(0); // towards the axis
      expect(face.normal[2]).toBeLessThan(0); // and out of the back
    }
  });

  it('faces a disc along any normal', () => {
    for (const normal of [
      [0, 1, 0],
      [0, -3, 0],
      [1, 1, 1],
      [0, 0, -1],
    ] as const) {
      const mesh = new MeshBuilder().disc([1, 2, 3], normal, 0.5, 7, BLUE).build();
      expect(mesh.triangleCount).toBe(7);
      const length = Math.hypot(...normal);
      for (const face of faces(mesh)) {
        expect(dot(face.normal, normal) / length).toBeCloseTo(1, 6);
        const fromCenter = Math.hypot(
          face.centroid[0] - 1,
          face.centroid[1] - 2,
          face.centroid[2] - 3,
        );
        expect(fromCenter).toBeLessThan(0.5);
      }
    }
  });

  it('caps an end facing the way it was asked to', () => {
    const back = new MeshBuilder().cap(-1, 0.3, 6, -1, RED).build();
    const front = new MeshBuilder().cap(1, 0.3, 6, 1, RED).build();
    for (const face of faces(back)) expect(face.normal[2]).toBeCloseTo(-1, 6);
    for (const face of faces(front)) expect(face.normal[2]).toBeCloseTo(1, 6);
  });

  it('builds a closed plate, faces outwards, whichever way round the outline was drawn', () => {
    const outline = [
      [0.4, -0.3],
      [0.4, -0.8],
      [0.9, -1.0],
      [0.9, -0.7],
    ] as const;
    for (const drawn of [outline, [...outline].reverse()]) {
      for (const angle of [0, 2.1, -1.3]) {
        const mesh = new MeshBuilder().plate(drawn, angle, 0.08, BLUE).build();
        // Two faces of two triangles each, and four rim quads.
        expect(mesh.triangleCount).toBe(12);
        const all = faces(mesh);
        const center: Point = [0, 1, 2].map(
          (axis) =>
            all.reduce((sum, face) => sum + face.centroid[axis as 0 | 1 | 2], 0) / all.length,
        ) as unknown as Point;
        for (const face of all) {
          const outward: Point = [
            face.centroid[0] - center[0],
            face.centroid[1] - center[1],
            face.centroid[2] - center[2],
          ];
          expect(dot(face.normal, outward)).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('round where it is round, an edge where it is an edge', () => {
  /** A capped tube about Z from z 0 to 1, radius 1. */
  const tube = (sides: number): MeshData =>
    new MeshBuilder()
      .lathe(
        [
          { z: 0, radius: 0 },
          { z: 0, radius: 1 },
          { z: 1, radius: 1 },
          { z: 1, radius: 0 },
        ],
        sides,
        [RED],
      )
      .build();
  /** A ball of radius 1 about Z, in `bands` from pole to pole. */
  const ball = (sides: number, bands: number): MeshData =>
    new MeshBuilder()
      .lathe(
        Array.from({ length: bands + 1 }, (_, i) => ({
          z: -Math.cos((i / bands) * Math.PI),
          radius: i % bands ? Math.sin((i / bands) * Math.PI) : 0,
        })),
        sides,
        [RED],
      )
      .build();
  /** The same direction, to float32's last digits. */
  const alike = (a: Point, b: Point): boolean =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6;
  /** Every vertex with its normal and its face's own (the triangle's winding). */
  function corners(mesh: MeshData): { at: Point; normal: Point; face: Point }[] {
    const out: { at: Point; normal: Point; face: Point }[] = [];
    const flat = new MeshBuilder();
    for (let t = 0; t < mesh.triangleCount; t += 1) {
      const p = (v: number): Point => [
        mesh.positions[(t * 3 + v) * 3] ?? 0,
        mesh.positions[(t * 3 + v) * 3 + 1] ?? 0,
        mesh.positions[(t * 3 + v) * 3 + 2] ?? 0,
      ];
      flat.triangle(p(0), p(1), p(2), RED);
    }
    const faceNormals = flat.build().normals;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const three = (values: Float32Array): Point => [
        values[i] ?? 0,
        values[i + 1] ?? 0,
        values[i + 2] ?? 0,
      ];
      out.push({
        at: three(mesh.positions),
        normal: three(mesh.normals),
        face: three(faceNormals),
      });
    }
    return out;
  }

  it('lights a tube as the cylinder it stands for, and keeps its caps flat', () => {
    for (const sides of [ROUND_FROM, 6, 12, 24]) {
      const all = corners(tube(sides));
      expect(all).toHaveLength(sides * 4 * 3);
      for (const { at, normal, face } of all) {
        if (Math.abs(face[2]) > 0.5) {
          // A cap meets the side at a right angle: an edge (a fold of 90 degrees in the profile).
          expect(alike(normal, face)).toBe(true);
        } else {
          // The side: straight out from the axis at every vertex, whichever face it belongs to.
          expect(normal[0]).toBeCloseTo(at[0], 5);
          expect(normal[1]).toBeCloseTo(at[1], 5);
          expect(normal[2]).toBeCloseTo(0, 5);
        }
      }
    }
  });

  it('says what is round by what it is: a lathe of five sides or more, and nothing else', () => {
    expect(ROUND_FROM).toBe(5);
    // Four sides are a square post: every face its own.
    for (const { normal, face } of corners(tube(4))) expect(alike(normal, face)).toBe(true);
    // A box, a plate and a disc are flat, however many sides the disc has.
    const flat = new MeshBuilder()
      .box([0, 0, 0], [1, 2, 3], RED)
      .plate(
        [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
        0.4,
        0.1,
        RED,
      )
      .disc([0, 0, 3], [0, 1, 1], 1, 24, RED)
      .build();
    for (const { normal, face } of corners(flat)) expect(alike(normal, face)).toBe(true);
  });

  it('lights a ball as a ball: every normal straight out from its centre, the poles too', () => {
    for (const { at, normal } of corners(ball(16, 8))) {
      // The mean of two bands' normals is the true one to within a band's own turn.
      expect(dot(normal, at)).toBeGreaterThan(Math.cos(Math.PI / 8 / 2) - 1e-6);
      expect(Math.hypot(...normal)).toBeCloseTo(1, 5);
    }
    // At a pole the profile ends on the axis without a fold: the normal is the axis, one for
    // every triangle that meets there (no star of facets round it).
    const poles = corners(ball(16, 8)).filter(({ at }) => Math.hypot(at[0], at[1]) < 1e-9);
    expect(poles).toHaveLength(32);
    for (const { at, normal } of poles) expect(alike(normal, [0, 0, Math.sign(at[2])])).toBe(true);
  });

  it('folds a profile where it turns by more than its crease, and bends it where by less', () => {
    // A tube, then a cone that leans in by 30 degrees (a bend), then by 70 more (a fold).
    const lean = (deg: number): number => Math.tan((deg * Math.PI) / 180);
    const mesh = new MeshBuilder()
      .lathe(
        [
          { z: 0, radius: 1 },
          { z: 1, radius: 1 },
          { z: 1.2, radius: 1 - 0.2 * lean(30) },
          { z: 1.21, radius: 1 - 0.2 * lean(30) - 0.01 * lean(85) },
        ],
        24,
        [RED],
      )
      .build();
    expect(30).toBeLessThan(CREASE_DEG);
    expect(85 - 30).toBeGreaterThan(CREASE_DEG);
    const tilt = (normal: Point): number => (Math.asin(normal[2]) * 180) / Math.PI;
    for (const { at, normal, face } of corners(mesh)) {
      if (at[2] < 0.5) expect(tilt(normal)).toBeCloseTo(0, 4);
      // Where the tube meets the cone: one normal for both, halfway between theirs.
      else if (Math.abs(at[2] - 1) < 1e-6) expect(tilt(normal)).toBeCloseTo(15, 3);
      // Where the cone meets the steeper one: each keeps its own.
      else if (Math.abs(at[2] - 1.2) < 1e-6) expect(tilt(normal)).toBeCloseTo(tilt(face), 0);
    }
  });

  it('gives a cone a tip: each side its own normal there, never one for all', () => {
    // 45 degrees is steeper than a pole closes at.
    expect(45).toBeGreaterThan(POLE_DEG);
    const cone = new MeshBuilder()
      .lathe(
        [
          { z: 0, radius: 1 },
          { z: 1, radius: 0 },
        ],
        12,
        [RED],
      )
      .build();
    const tips = corners(cone).filter(({ at }) => at[2] > 0.999);
    expect(tips).toHaveLength(12);
    expect(new Set(tips.map(({ normal }) => normal.map((v) => v.toFixed(4)).join())).size).toBe(12);
    for (const { normal } of tips) expect(normal[2]).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it('keeps the normals a triangle came with, and carries its other colours with their lines', () => {
    const n = [0, 0.6, 0.8, 0, 1, 0, 0.6, 0, 0.8];
    const mesh = new MeshBuilder()
      .triangle([0, 0, 0], [1, 0, 0], [0, 1, 0], RED, {
        n,
        side: { c: BLUE, k: [0.1, 0.9, 0.3] },
        over: { c: [0, 1, 0], k: [1, 0, 0.5] },
      })
      .triangle([0, 0, 0], [0, 1, 0], [-1, 0, 0], RED)
      .build();
    for (let i = 0; i < 9; i += 1) expect(mesh.normals[i]).toBeCloseTo(n[i] ?? NaN, 6);
    // The plain triangle beside it shares its edge and is still flat: given normals are not shared.
    expect([...mesh.normals.slice(9)].map((v) => v + 0)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    // Eight numbers a vertex: the side, then the over; zeros for a triangle of one colour.
    const sides = Array.from(mesh.sides ?? [], (value) => Math.round(value * 10) / 10);
    expect(sides.slice(0, 8)).toEqual([0, 0, 1, 0.1, 0, 1, 0, 1]);
    expect(sides.slice(8, 16)).toEqual([0, 0, 1, 0.9, 0, 1, 0, 0]);
    expect(sides.slice(16, 24)).toEqual([0, 0, 1, 0.3, 0, 1, 0, 0.5]);
    expect(sides.slice(24)).toEqual(new Array(24).fill(0));
    // A mesh with one colour a face has no such buffer at all.
    expect(tube(6).sides).toBeUndefined();
    // Straight lines: no bends either.
    expect(mesh.bends).toBeUndefined();
  });

  it("carries how a line bends: four numbers a vertex, the side's two and the over's", () => {
    const mesh = new MeshBuilder()
      .triangle([0, 0, 0], [1, 0, 0], [0, 1, 0], RED, {
        side: { c: BLUE, k: [0.1, 0.9, 0.3], t: [0, 1, 0.5], bend: 0.25 },
        over: { c: [0, 1, 0], k: [1, 0, 0.5] },
      })
      .triangle([0, 0, 0], [0, 1, 0], [-1, 0, 0], RED, {
        side: { c: BLUE, k: [0.1, 0.9, 0.3] },
        over: { c: [0, 1, 0], k: [1, 0, 0.5], t: [2, -1, 0.5], bend: -0.5 },
      })
      .triangle([0, 0, 0], [-1, 0, 0], [0, -1, 0], RED)
      .build();
    // How far along its line each corner stands, then the bend, the same on all three.
    expect(Array.from(mesh.bends ?? [])).toEqual([
      ...[0, 0.25, 0, 0, 1, 0.25, 0, 0, 0.5, 0.25, 0, 0],
      ...[0, 0, 2, -0.5, 0, 0, -1, -0.5, 0, 0, 0.5, -0.5],
      ...new Array(12).fill(0),
    ]);
  });
});
