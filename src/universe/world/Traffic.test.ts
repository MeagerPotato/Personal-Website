import type { BufferAttribute, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Frame } from '../core/Engine';
import { trafficColor } from '../design/materials';
import { tokens } from '../design/tokens';
import { tuning } from '../design/tuning';
import { bodyPositions, createOrbitTable } from '../sim/orbits';
import { Traffic } from './Traffic';

/** A sun, two planets round it and a relay on the second planet's ring. */
const orbits = createOrbitTable(
  [{ id: 's', position: [40, 0] }],
  [
    { id: 'sun', parent: null, system: 's', orbit: null },
    { id: 'near', parent: 'sun', system: 's', orbit: { radius: 60, phase: 0, periodSec: 100 } },
    { id: 'far', parent: 'sun', system: 's', orbit: { radius: 90, phase: 1, periodSec: 200 } },
    { id: 'relay', parent: 'sun', system: 's', orbit: { radius: 90, phase: 4, periodSec: 200 } },
  ],
);
const families = [undefined, 'sky', 'coral', undefined] as const;
const frame = (simTime: number, alpha = 1): Frame => ({ elapsed: 0, dt: 1 / 60, alpha, simTime });
const places = (traffic: Traffic): number[] =>
  Array.from((traffic.object.geometry.getAttribute('aDot') as BufferAttribute).array);
const sizes = (traffic: Traffic): number[] => places(traffic).filter((_, i) => i % 3 === 1);
const twice = (values: readonly number[]): number[] => [...values, ...values].map(Math.fround);

function build(
  reducedMotion: boolean,
  scales = [1, 1, 1, 1],
): { traffic: Traffic; positions: Float64Array } {
  const positions = bodyPositions(orbits, 0, new Float64Array(orbits.count * 2));
  const traffic = new Traffic({ orbits, families, positions, scales, reducedMotion });
  return { traffic, positions };
}

describe('traffic on the orbits', () => {
  it('is one draw of quads: two dots a line that has a family, in its light, over the lines', () => {
    const { traffic } = build(false);
    const { geometry } = traffic.object;
    expect(geometry.instanceCount).toBe(4);
    expect(geometry.getAttribute('aDot').count).toBe(4);
    const colors = Array.from((geometry.getAttribute('aColor') as BufferAttribute).array);
    const sky = trafficColor('sky').toArray();
    const coral = trafficColor('coral').toArray();
    expect(colors).toEqual([...sky, ...sky, ...coral, ...coral].map(Math.fround));
    // The family's light, as the tokens have it.
    expect(`#${trafficColor('sky').getHexString()}`).toBe(tokens.color.system.sky.light);
    // A dot's size rides in its place's y (design/shaders/traffic.ts): CSS px.
    expect(sizes(traffic)).toEqual(twice(tuning.look.traffic.sizesPx));
    expect(traffic.object.renderOrder).toBeGreaterThan(0);
    expect(traffic.object.frustumCulled).toBe(false);
    expect(traffic.object.material.uniforms.uOpacity?.value).toBe(tuning.look.traffic.opacity);
    traffic.dispose();
  });

  it('moves by the exact time of the frame, and is the same dots in a rebuilt engine', () => {
    const { traffic, positions } = build(false);
    const step = 1 / tuning.loop.stepHz;
    const at0 = places(traffic);
    bodyPositions(orbits, 30 - 0.75 * step, positions);
    traffic.frameUpdate(frame(30, 0.25));
    const at30 = places(traffic);
    expect(at30).not.toEqual(at0);
    // Another engine, booted from a snapshot of the same step count: the same dots, there.
    const again = build(false);
    bodyPositions(orbits, 30 - 0.75 * step, again.positions);
    again.traffic.frameUpdate(frame(30, 0.25));
    expect(places(again.traffic)).toEqual(at30);
    // And it is the time between the steps that counts, not the step.
    again.traffic.frameUpdate(frame(30, 1));
    expect(places(again.traffic)).not.toEqual(at30);
    traffic.dispose();
    again.traffic.dispose();
  });

  it('rests at its start under reduced motion, whatever the time', () => {
    const { traffic } = build(true);
    const at0 = places(traffic);
    for (const time of [0.5, 12, 4000]) {
      traffic.frameUpdate(frame(time));
      expect(places(traffic)).toEqual(at0);
    }
    traffic.dispose();
  });

  it('draws no dots on the orbit of a body the star map hides, and knows the view in pixels', () => {
    const scales = [1, 1, 1, 1];
    const { traffic } = build(false, scales);
    scales[2] = 0;
    traffic.frameUpdate(frame(1));
    expect(sizes(traffic)).toEqual([...tuning.look.traffic.sizesPx, 0, 0].map(Math.fround));
    traffic.resize({ width: 800, height: 600, pixelRatio: 2.5 });
    const view = traffic.object.material.uniforms.uView.value as Vector3;
    expect(view.toArray()).toEqual([2000, 1500, 2.5]);
    traffic.dispose();
  });
});
