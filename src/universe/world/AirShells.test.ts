import {
  Vector3,
  type InstancedBufferAttribute,
  type InstancedBufferGeometry,
  type Mesh,
} from 'three';
import { describe, expect, it } from 'vitest';
import type { Frame } from '../core/Engine';
import { airColor, cloudColor } from '../design/materials';
import { tuning } from '../design/tuning';
import { cloudCut, cloudSeed } from '../sim/clouds';
import { planetTriangleCount } from '../sim/planet';
import { AirShells, type AirWorldView } from './AirShells';

const light = new Vector3(-6000, 4200, 3000);
const world = (row: number, cloudy: boolean, radius = 8): AirWorldView => ({
  id: `project/world-${row}`,
  row,
  radius,
  air: row === 0 ? 'terra' : 'bloom',
  light,
  cloud: cloudy ? { share: 0.5, peak: 'frost' } : undefined,
});
const frame = (simTime: number, alpha = 1): Frame => ({ elapsed: 0, dt: 1 / 60, alpha, simTime });
const meshOf = (air: AirShells, name: string): Mesh<InstancedBufferGeometry> => {
  const mesh = air.object.getObjectByName(name);
  if (!mesh) throw new Error(`no ${name}`);
  return mesh as Mesh<InstancedBufferGeometry>;
};
const attribute = (air: AirShells, name: string, of: string): InstancedBufferAttribute =>
  meshOf(air, name).geometry.getAttribute(of) as InstancedBufferAttribute;
const uniform = (air: AirShells, name: string, of: string): unknown =>
  (meshOf(air, name).material as unknown as { uniforms: Record<string, { value: unknown }> })
    .uniforms[of]?.value;

describe('the air of the worlds', () => {
  it('draws every shell in one call and every cloud in another, whichever worlds there are', () => {
    const air = new AirShells({
      worlds: [world(0, true), world(1, false), world(2, true)],
      positions: [10, 20, 30, 40, 50, 60],
      scales: [1, 1, 2],
      low: false,
      reducedMotion: false,
    });
    expect(air.object.children).toHaveLength(2);
    expect(meshOf(air, 'shells').geometry.instanceCount).toBe(3);
    // Only the worlds that wear clouds this tier.
    expect(meshOf(air, 'clouds').geometry.instanceCount).toBe(2);
    // Each where its world is, at the size it is drawn (the star map's scale).
    expect(Array.from(attribute(air, 'shells', 'aCenter').array)).toEqual([
      10, 0, 20, 8, 30, 0, 40, 8, 50, 0, 60, 16,
    ]);
    expect(Array.from(attribute(air, 'clouds', 'aCenter').array)).toEqual([
      10, 0, 20, 8, 50, 0, 60, 16,
    ]);
    // Its air in display space, and its clouds in their lit colour.
    expect(Array.from(attribute(air, 'shells', 'aAir').array.slice(0, 3))).toEqual(
      Array.from(new Float32Array(airColor('terra').toArray())),
    );
    expect(Array.from(attribute(air, 'clouds', 'aCloud').array.slice(3, 6))).toEqual(
      Array.from(new Float32Array(cloudColor('bloom', 'frost').toArray())),
    );
    // Its own place in the noise, its threshold, the turn it starts at.
    const seed = cloudSeed('project/world-2');
    const sky = attribute(air, 'clouds', 'aSky').array;
    expect(sky[3]).toBeCloseTo(seed, 5);
    expect(sky[4]).toBeCloseTo(cloudCut(0.5, tuning.look.air.cloud), 6);
    expect(sky[5]).toBeCloseTo(seed, 5);
    // A ball as fine as the look says.
    const corners = meshOf(air, 'clouds').geometry.getAttribute('position').count;
    expect(corners).toBe(3 * planetTriangleCount(tuning.look.air.cloud.detail));
    // After the coronas and before every other see-through thing; the hairline over the clouds.
    const [shells, clouds] = [meshOf(air, 'shells'), meshOf(air, 'clouds')];
    expect(clouds.renderOrder).toBeGreaterThan(-0.5);
    expect(shells.renderOrder).toBeGreaterThan(clouds.renderOrder);
    expect(shells.renderOrder).toBeLessThan(0);
    expect([shells.frustumCulled, clouds.frustumCulled]).toEqual([false, false]);
    air.dispose();
  });

  it('follows its worlds and their lights each frame, and drifts by the exact time of the frame', () => {
    const positions = [0, 0];
    const scales = [1];
    const sun = new Vector3(1, 2, 3);
    const air = new AirShells({
      worlds: [{ ...world(0, true, 5), light: sun }],
      positions,
      scales,
      low: false,
      reducedMotion: false,
    });
    positions[0] = 7;
    positions[1] = -3;
    scales[0] = 0.5;
    sun.set(40, 0, -9);
    air.frameUpdate(frame(10, 0.25));
    for (const name of ['shells', 'clouds']) {
      expect(Array.from(attribute(air, name, 'aCenter').array)).toEqual([7, 0, -3, 2.5]);
      expect(Array.from(attribute(air, name, 'aLight').array)).toEqual([40, 0, -9]);
    }
    expect(uniform(air, 'clouds', 'uTime')).toBeCloseTo(10 - 0.75 / tuning.loop.stepHz, 12);
    air.dispose();
  });

  it('has no clouds where none are asked for, and still ones under reduced motion', () => {
    const none = new AirShells({
      worlds: [world(0, false)],
      positions: [0, 0],
      scales: [1],
      low: true,
      reducedMotion: false,
    });
    expect(none.object.children.map((child) => child.name)).toEqual(['shells']);
    // The low tier keeps fewer rings.
    expect(uniform(none, 'shells', 'uRingCount')).toBe(tuning.look.air.shell.lowRings);
    none.frameUpdate(frame(3));
    none.dispose();

    const still = new AirShells({
      worlds: [world(0, true)],
      positions: [0, 0],
      scales: [1],
      low: false,
      reducedMotion: true,
    });
    expect((uniform(still, 'clouds', 'uSkin') as { y: number }).y).toBe(0);
    still.dispose();
  });

  it('is gone from the star map', () => {
    const air = new AirShells({
      worlds: [world(0, true)],
      positions: [0, 0],
      scales: [1],
      low: false,
      reducedMotion: false,
    });
    air.setCalm(0.4);
    expect(uniform(air, 'shells', 'uCalm')).toBe(0.4);
    expect(uniform(air, 'clouds', 'uCalm')).toBe(0.4);
    expect(air.object.visible).toBe(true);
    air.setCalm(1);
    expect(air.object.visible).toBe(false);
    air.setCalm(0);
    expect(air.object.visible).toBe(true);
    air.dispose();
    expect(air.object.parent).toBeNull();
  });

  it('draws nothing when no world has air', () => {
    const air = new AirShells({
      worlds: [],
      positions: [],
      scales: [],
      low: false,
      reducedMotion: false,
    });
    expect(meshOf(air, 'shells').visible).toBe(false);
    air.frameUpdate(frame(1));
    air.dispose();
  });
});
