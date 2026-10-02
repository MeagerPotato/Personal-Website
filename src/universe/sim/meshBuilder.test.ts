import { describe, expect, it } from 'vitest';
import { CREASE_DEG, MeshBuilder, type MeshData, type Point, type Rgb } from './meshBuilder';

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
  const tube = (sides: number, round = true): MeshData =>
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
      .build(round);
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
    const faceNormals = flat.build(false).normals;
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

  it('lights a tube of twelve sides as the cylinder it stands for, and keeps its caps flat', () => {
    const all = corners(tube(12));
    expect(all).toHaveLength(48 * 3);
    for (const { at, normal, face } of all) {
      if (Math.abs(face[2]) > 0.5) {
        // A cap meets the side at a right angle: an edge.
        expect(alike(normal, face)).toBe(true);
      } else {
        // The side: straight out from the axis at every vertex, whichever face it belongs to.
        expect(normal[0]).toBeCloseTo(at[0], 5);
        expect(normal[1]).toBeCloseTo(at[1], 5);
        expect(normal[2]).toBeCloseTo(0, 5);
      }
    }
  });

  it('draws the line at its crease: eight sides are round, six are a hexagon, a box is a box', () => {
    // The sides of an n-sided tube meet at 360 / n degrees.
    expect(360 / 8).toBeLessThan(CREASE_DEG);
    expect(360 / 6).toBeGreaterThan(CREASE_DEG);
    const sideOf = (mesh: MeshData) => corners(mesh).filter(({ face }) => Math.abs(face[2]) < 0.5);
    for (const { at, normal } of sideOf(tube(8)))
      expect(dot(normal, at) - at[2] * normal[2]).toBeCloseTo(1, 5);
    for (const { normal, face } of sideOf(tube(6))) expect(alike(normal, face)).toBe(true);
    for (const { normal, face } of corners(
      new MeshBuilder().box([0, 0, 0], [1, 2, 3], RED).build(),
    )) {
      expect(alike(normal, face)).toBe(true);
    }
  });

  it('counts the two triangles of a quad as the one face they are', () => {
    // A corner of a tube's side has two triangles of one quad and one of the next: weighed by
    // their angles there, the two quads count the same, and the normal is straight out.
    for (const { at, normal, face } of corners(tube(16))) {
      if (Math.abs(face[2]) > 0.5) continue;
      expect(Math.atan2(normal[1], normal[0])).toBeCloseTo(Math.atan2(at[1], at[0]), 5);
    }
  });

  it('leaves every face flat when asked to, and unit normals either way', () => {
    for (const { normal, face } of corners(tube(12, false))) expect(alike(normal, face)).toBe(true);
    for (const { normal } of corners(tube(12))) expect(Math.hypot(...normal)).toBeCloseTo(1, 5);
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
    expect([...mesh.normals.slice(9)]).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
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
