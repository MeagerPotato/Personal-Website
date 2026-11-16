import { describe, expect, it } from 'vitest';
import { finishNow, voxelize, type VoxelInput } from './voxel';

/** A closed box from (0,0,0) to (s,s,s), one colour, as twelve triangles. */
function box(s: number, rgb: [number, number, number] = [0.5, 0.25, 0.75]): VoxelInput {
  const v = (x: number, y: number, z: number): number[] => [x * s, y * s, z * s];
  // prettier-ignore
  const quads: ReadonlyArray<readonly [number[], number[], number[], number[]]> = [
    [v(0,0,0), v(1,0,0), v(1,1,0), v(0,1,0)], [v(0,0,1), v(0,1,1), v(1,1,1), v(1,0,1)],
    [v(0,0,0), v(0,1,0), v(0,1,1), v(0,0,1)], [v(1,0,0), v(1,0,1), v(1,1,1), v(1,1,0)],
    [v(0,0,0), v(0,0,1), v(1,0,1), v(1,0,0)], [v(0,1,0), v(1,1,0), v(1,1,1), v(0,1,1)],
  ];
  const positions: number[] = [];
  for (const [a, b, c, d] of quads) positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  const count = positions.length / 3;
  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(Array.from({ length: count }, () => rgb).flat()),
    triangleCount: count / 3,
  };
}

describe('voxelize', () => {
  it('fills a closed box and keeps only its outer faces', () => {
    const out = finishNow(voxelize(box(4), { cell: 1 }));
    // The surface lands in a 5x5x5 block of cubes (its far faces sit on a cube's edge); a solid
    // block shows 6 faces of 5x5 squares, two triangles each.
    expect(out.triangleCount).toBe(6 * 25 * 2);
    for (let i = 0; i < out.normals.length; i += 3) {
      expect(
        Math.abs(out.normals[i] ?? 0) +
          Math.abs(out.normals[i + 1] ?? 0) +
          Math.abs(out.normals[i + 2] ?? 0),
      ).toBe(1);
    }
  });

  it('gives every cube the colour of the surface through it, exactly', () => {
    const out = finishNow(voxelize(box(3, [0.2, 0.4, 0.6]), { cell: 1 }));
    for (let i = 0; i < out.colors.length; i += 3) {
      expect([out.colors[i], out.colors[i + 1], out.colors[i + 2]]).toEqual([
        Math.fround(0.2),
        Math.fround(0.4),
        Math.fround(0.6),
      ]);
    }
  });

  it('leaves an open face fully open and darkens only inside corners', () => {
    const out = finishNow(voxelize(box(4), { cell: 1 }));
    // A convex block has no inside corners: every corner of every face is open.
    expect(Math.min(...out.shade)).toBe(255);
  });

  it('is deterministic', () => {
    const a = finishNow(voxelize(box(5), { cell: 0.7 }));
    const b = finishNow(voxelize(box(5), { cell: 0.7 }));
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.shade)).toEqual(Array.from(b.shade));
  });

  it('grows the cube rather than exceed the widest grid', () => {
    const out = finishNow(voxelize(box(100), { cell: 0.01, maxCells: 24 }));
    expect(out.triangleCount).toBeGreaterThan(0);
    expect(out.triangleCount).toBeLessThan(6 * 24 * 24 * 2);
  });

  it('gives nothing for nothing', () => {
    const out = finishNow(
      voxelize(
        { positions: new Float32Array(0), colors: new Float32Array(0), triangleCount: 0 },
        { cell: 1 },
      ),
    );
    expect(out.triangleCount).toBe(0);
  });
});
