import { describe, expect, it } from 'vitest';
import { hexToLinear } from '../../sim/color';
import type { MeshData } from '../../sim/meshBuilder';
import { tokens } from '../tokens';
import { buildRelay, buildSatellite } from './docks';
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
    // Round: 24 sides, a nose of eight bands and a window laid on the curve (it was under 400).
    expect(mesh.triangleCount).toBeLessThan(1000);
    expect(mesh.colors.every(isColour)).toBe(true);
    expect(mesh.normals.every(Number.isFinite)).toBe(true);

    // The flame starts on the axis, at the back.
    expect(sockets.engine?.[0]).toBe(0);
    expect(sockets.engine?.[1]).toBe(0);
    expect(sockets.engine?.[2]).toBeLessThan(-0.8);
  });

  it('a relay stands upright in a sphere of radius 1, beacon up, and never in butter or cream', () => {
    const { mesh } = buildRelay();
    const { min, max } = bounds(mesh);
    for (let at = 0; at < mesh.positions.length; at += 3) {
      const [x = 0, y = 0, z = 0] = mesh.positions.slice(at, at + 3);
      expect(Math.hypot(x, y, z)).toBeLessThanOrEqual(1 + 1e-9);
    }
    // Taller than wide: a buoy with a mast, the beacon at the top.
    expect((max[1] ?? 0) - (min[1] ?? 0)).toBeGreaterThan(1.8);
    expect((max[0] ?? 0) - (min[0] ?? 0)).toBeLessThan(1);
    expect(max[1]).toBeGreaterThan(0.9);
    expect(mesh.colors.every(isColour)).toBe(true);
    expect(mesh.normals.every(Number.isFinite)).toBe(true);
    // Butter says "here" and the cream face "on" (docs/DESIGN.md): neither is a relay's.
    const said = (hex: string): number[] => [...hexToLinear(hex)];
    const colours = new Set<string>();
    for (let at = 0; at < mesh.colors.length; at += 3) {
      colours.add(
        [...mesh.colors.slice(at, at + 3)].map((value) => Math.fround(value).toFixed(5)).join(),
      );
    }
    for (const hex of [tokens.color.system.butter.base, tokens.color.ink.high]) {
      expect(
        colours.has(
          said(hex)
            .map((value) => Math.fround(value).toFixed(5))
            .join(),
        ),
      ).toBe(false);
    }
    // And it is not the satellite: no solar wings. They spread the satellite over 1.5 wide; the
    // relay is under 1 (above).
    const satellite = bounds(buildSatellite().mesh);
    expect((satellite.max[0] ?? 0) - (satellite.min[0] ?? 0)).toBeGreaterThan(1.5);
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
