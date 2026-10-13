import type { InstancedBufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import type { Frame } from '../core/Engine';
import { tokens } from '../design/tokens';
import { tuning } from '../design/tuning';
import { BODIES } from '../design/worlds/bodies';
import { livingSun, lookOf } from './looks';
import { SunCorona, type CoronaSun } from './SunCorona';

const sun = (row: number, living: boolean, radius = 20): CoronaSun => ({
  row,
  family: living ? 'sky' : 'coral',
  radius,
  seed: 1 + row,
  living,
});
const frame = (simTime: number, alpha = 1): Frame => ({ elapsed: 0, dt: 1 / 60, alpha, simTime });
const attribute = (corona: SunCorona, name: string): InstancedBufferAttribute =>
  corona.object.geometry.getAttribute(name) as InstancedBufferAttribute;

describe('the coronas', () => {
  it('draws two quads a living sun (its light, its lens) and one a plain sun, in one call', () => {
    const corona = new SunCorona({
      suns: [sun(0, true), sun(1, false), sun(2, true)],
      positions: [10, 20, 30, 40, 50, 60],
      scales: [1, 1, 2],
      low: false,
      reducedMotion: false,
    });
    expect(corona.object.geometry.instanceCount).toBe(5);
    // [seed, layer]: 1 a light and 2 its lens, 0 a plain sun's light.
    expect(Array.from(attribute(corona, 'aSun').array)).toEqual([1, 1, 1, 2, 2, 0, 3, 1, 3, 2]);
    // Each where its sun is, at the size it is drawn (the star map's scale).
    expect(Array.from(attribute(corona, 'aCenter').array)).toEqual([
      10, 0, 20, 20, 10, 0, 20, 20, 30, 0, 40, 20, 50, 0, 60, 40, 50, 0, 60, 40,
    ]);
    // After the stars, before every other see-through thing; never culled by its own bounds.
    expect(corona.object.renderOrder).toBeGreaterThan(-1);
    expect(corona.object.renderOrder).toBeLessThan(0);
    expect(corona.object.frustumCulled).toBe(false);
    corona.dispose();
  });

  it('follows its suns each frame, and breathes by the exact time of the frame', () => {
    const positions = [0, 0];
    const scales = [1];
    const corona = new SunCorona({
      suns: [sun(0, true, 15)],
      positions,
      scales,
      low: false,
      reducedMotion: false,
    });
    positions[0] = 7;
    positions[1] = -3;
    scales[0] = 0.5;
    const step = 1 / tuning.loop.stepHz;
    corona.frameUpdate(frame(10, 0.25));
    expect(Array.from(attribute(corona, 'aCenter').array.slice(0, 4))).toEqual([7, 0, -3, 7.5]);
    expect(corona.object.material.uniforms.uTime.value).toBeCloseTo(10 - 0.75 * step, 12);
    corona.setCalm(0.4);
    expect(corona.object.material.uniforms.uCalm.value).toBe(0.4);
    corona.dispose();
  });

  it('holds the frame of time zero under reduced motion', () => {
    const corona = new SunCorona({
      suns: [sun(0, true)],
      positions: [0, 0],
      scales: [1],
      low: false,
      reducedMotion: true,
    });
    for (const time of [0, 12.5, 4000]) {
      corona.frameUpdate(frame(time));
      expect(corona.object.material.uniforms.uTime.value).toBe(0);
    }
    corona.dispose();
  });

  it('gives each sun its family’s tones, in display space', () => {
    const corona = new SunCorona({
      suns: [sun(0, true), sun(1, false)],
      positions: [0, 0, 0, 0],
      scales: [1, 1],
      low: true,
      reducedMotion: false,
    });
    const base = Array.from(attribute(corona, 'aBase').array, (v) => Math.round(v * 255));
    const hex = (i: number): string =>
      `#${base
        .slice(i * 3, i * 3 + 3)
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('')}`;
    // The token itself on both quads of the living sun, and coral's on the plain one's.
    expect(hex(0)).toBe(tokens.color.system.sky.base);
    expect(hex(1)).toBe(hex(0));
    expect(hex(2)).toBe(tokens.color.system.coral.base);
    // The hottest tone is lighter than the light one, on every channel.
    const light = attribute(corona, 'aLight').array;
    const hot = attribute(corona, 'aHot').array;
    for (let i = 0; i < 9; i += 1) expect(hot[i]).toBeGreaterThan(light[i] ?? 1);
    corona.dispose();
  });

  it('knows the real suns: three living ones, and Hardware’s ball of gears, which is plain', () => {
    const living = (id: string): boolean =>
      livingSun(lookOf({ id, kind: 'sun' }, 'sky', {}, BODIES));
    expect(['system/software', 'system/research', 'system/hackathons'].map(living)).toEqual([
      true,
      true,
      true,
    ]);
    expect(living('system/hardware')).toBe(false);
    // A sun with no rows is a generated globe: plain.
    expect(livingSun(lookOf({ id: 'system/none', kind: 'sun' }, 'sky', {}, {}))).toBe(false);
  });
});
