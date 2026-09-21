import { describe, expect, it } from 'vitest';
import { MeshBuilder, type MeshData, type Point, type Rgb } from './meshBuilder';

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
