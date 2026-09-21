import { describe, expect, it } from 'vitest';
import type { MeshData } from '../../sim/meshBuilder';
import { buildFlame } from './flame';
import { buildRocket } from './rocket';

function bounds(mesh: MeshData): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  mesh.positions.forEach((value, index) => {
    const axis = index % 3;
    min[axis] = Math.min(min[axis] ?? Infinity, value);
    max[axis] = Math.max(max[axis] ?? -Infinity, value);
  });
  return { min, max };
}

const isColour = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1;

/** What logic relies on, however the models are restyled (docs/PLAN.md §5.6). */
describe('the model conventions', () => {
  it('the rocket is about 2 u long, nose along +Z, and the same on both sides', () => {
    const { mesh, sockets } = buildRocket();
    const { min, max } = bounds(mesh);

    expect(max[2]).toBeCloseTo(1, 1);
    expect((max[2] ?? 0) - (min[2] ?? 0)).toBeGreaterThan(1.8);
    expect((max[2] ?? 0) - (min[2] ?? 0)).toBeLessThan(2.3);
    expect((min[0] ?? 0) + (max[0] ?? 0)).toBeCloseTo(0, 6);
    // Wider than tall would read as a plane, not a rocket.
    expect((max[0] ?? 0) - (min[0] ?? 0)).toBeLessThan(2);

    expect(mesh.triangleCount).toBeGreaterThan(50);
    expect(mesh.triangleCount).toBeLessThan(400);
    expect(mesh.colors.every(isColour)).toBe(true);
    expect(mesh.normals.every(Number.isFinite)).toBe(true);

    // The flame starts on the axis, at the back.
    expect(sockets.engine?.[0]).toBe(0);
    expect(sockets.engine?.[1]).toBe(0);
    expect(sockets.engine?.[2]).toBeLessThan(-0.8);
  });

  it('the flame is one unit long and one unit wide, pointing along -Z from the origin', () => {
    const { mesh } = buildFlame();
    const { min, max } = bounds(mesh);
    expect(min[2]).toBeCloseTo(-1, 6);
    expect(max[2]).toBeCloseTo(0, 6);
    expect(max[0]).toBeLessThanOrEqual(1);
    expect(max[0]).toBeGreaterThan(0.8);
    expect(mesh.colors.every(isColour)).toBe(true);
  });
});
