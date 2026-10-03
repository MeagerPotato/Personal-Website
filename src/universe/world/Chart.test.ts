import type { Color, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { tokens } from '../design/tokens';
import { tuning } from '../design/tuning';
import { Chart } from './Chart';

const districts = [
  { x: 0, z: 0, radius: 66, family: 'butter' },
  { x: -488, z: 488, radius: 400, family: 'sky' },
] as const;
const hexes = (value: unknown): string[] =>
  (value as Color[]).map((color) => {
    const [r, g, b] = color.toArray().map((v) => Math.round(v * 255));
    return `#${[r, g, b].map((v) => (v ?? 0).toString(16).padStart(2, '0')).join('')}`;
  });

describe('the chart', () => {
  it('lies under the flight plane, behind the stars, and shows only as the map does', () => {
    const map = { weight: 0, unitsPerPx: 1.5 };
    const chart = new Chart({ districts, map });
    expect(chart.object.position.y).toBe(tuning.look.chart.planeY);
    expect(chart.object.position.y).toBeLessThan(0);
    // After the backdrop (-2), before the stars (-1).
    expect(chart.object.renderOrder).toBeGreaterThan(-2);
    expect(chart.object.renderOrder).toBeLessThan(-1);
    expect(chart.object.visible).toBe(false);
    chart.frameUpdate();
    expect(chart.object.visible).toBe(false);
    map.weight = 0.6;
    map.unitsPerPx = 2.25;
    chart.frameUpdate();
    expect(chart.object.visible).toBe(true);
    const { uniforms } = chart.object.material;
    expect([uniforms.uWeight.value, uniforms.uUnitsPerPx.value]).toEqual([0.6, 2.25]);
    map.weight = 0;
    chart.frameUpdate();
    expect(chart.object.visible).toBe(false);
    chart.dispose();
  });

  it('gives each system a district where it is, in its family’s dim tones and its base', () => {
    const chart = new Chart({ districts, map: { weight: 1, unitsPerPx: 1 } });
    const { uniforms, defines } = chart.object.material;
    expect(defines?.DISTRICTS).toBe(2);
    expect((uniforms.uDisc?.value as Vector3[]).map((disc) => disc.toArray())).toEqual([
      [0, 0, 66],
      [-488, 488, 400],
    ]);
    // Display space: the token itself.
    const { nebula, system } = tokens.color;
    expect(hexes(uniforms.uOuter?.value)).toEqual([nebula.butter.mid, nebula.sky.mid]);
    expect(hexes(uniforms.uInner?.value)).toEqual([nebula.butter.lit, nebula.sky.lit]);
    expect(hexes(uniforms.uRing?.value)).toEqual([system.butter.base, system.sky.base]);
    chart.dispose();
  });
});
