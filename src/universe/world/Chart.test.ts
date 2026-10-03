import type { BufferAttribute, BufferGeometry, Color, Mesh, ShaderMaterial, Vector3 } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { CHART_ROOM_PX, setBloomMask } from '../design/materials';
import { tokens } from '../design/tokens';
import { tuning } from '../design/tuning';
import { DISC_SIDES, gridCell, RING_SIDES } from '../sim/chartMesh';
import { Chart } from './Chart';

const districts = [
  { x: 0, z: 0, radius: 66, family: 'butter' },
  { x: -488, z: 488, radius: 400, family: 'sky' },
] as const;
const hexOf = ([r = 0, g = 0, b = 0]: readonly number[]): string =>
  `#${[r, g, b]
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
const hexes = (value: unknown): string[] =>
  (value as Color[]).map((color) => hexOf(color.toArray()));

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
    // The dot grid's spacing at that zoom: 34 px of 2.25 u are 76.5 u, and the nearest of
    // 1, 2 and 5 times a power of ten is 100.
    expect(uniforms.uCell.value).toBe(gridCell(2.25, tuning.look.chart.dotSpacingPx));
    expect(uniforms.uCell.value).toBe(100);
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
    // With post-processing one program lays every part: the plane is all there is.
    expect(chart.object.material.name).toBe('chart');
    expect(chart.object.children).toHaveLength(0);
    chart.dispose();
  });
});

// Without post-processing the canvas's own blending lays the paint, and each part is drawn on
// a mesh that holds only that part (design/shaders/chart.ts): on a software renderer one
// program for everything cost 24 ms of every frame of the map.
describe('the chart, straight to the canvas', () => {
  afterEach(() => setBloomMask(true));

  const parts = (chart: Chart): Mesh<BufferGeometry, ShaderMaterial>[] =>
    chart.object.children as Mesh<BufferGeometry, ShaderMaterial>[];
  const rows = (
    geometry: BufferGeometry,
    name: string,
    from: number,
    count: number,
  ): number[][] => {
    const attribute = geometry.getAttribute(name) as BufferAttribute;
    return Array.from({ length: count }, (_, i) =>
      Array.from({ length: 3 }, (_, k) => attribute.array[(from + i) * 3 + k] ?? NaN),
    );
  };

  it('is three parts in the order the paint is laid: the dots, the discs, the rings', () => {
    setBloomMask(false);
    const chart = new Chart({ districts, map: { weight: 1, unitsPerPx: 1 } });
    const [discs, rings] = parts(chart);
    expect(parts(chart)).toHaveLength(2);
    expect([chart.object.material.name, discs?.material.name, rings?.material.name]).toEqual([
      'chart-dots',
      'chart-discs',
      'chart-rings',
    ]);
    const orders = [chart.object.renderOrder, discs?.renderOrder ?? NaN, rings?.renderOrder ?? NaN];
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(new Set(orders).size).toBe(3);
    // All of it after the backdrop (-2) and before the stars (-1).
    expect(Math.min(...orders)).toBeGreaterThan(-2);
    expect(Math.max(...orders)).toBeLessThan(-1);
    // On the plane, wherever that is: the parts are its children and have no place of their own.
    for (const part of parts(chart)) {
      expect(part.parent).toBe(chart.object);
      expect(part.position.toArray()).toEqual([0, 0, 0]);
      expect(part.frustumCulled).toBe(false);
    }
    chart.dispose();
    expect(chart.object.children).toHaveLength(0);
  });

  it('shows and fades all three as the map does, and tells them the map’s scale', () => {
    setBloomMask(false);
    const map = { weight: 0, unitsPerPx: 1.5 };
    const chart = new Chart({ districts, map });
    expect(chart.object.visible).toBe(false);
    map.weight = 0.6;
    map.unitsPerPx = 2.25;
    chart.frameUpdate();
    // A hidden parent hides its children: one switch for the three.
    expect(chart.object.visible).toBe(true);
    for (const { material } of [chart.object, ...parts(chart)]) {
      expect(material.uniforms.uWeight?.value).toBe(0.6);
      expect(material.uniforms.uUnitsPerPx?.value).toBe(2.25);
    }
    expect(chart.object.material.uniforms.uCell.value).toBe(100);
    chart.dispose();
  });

  it('gives each system a polygon round its discs and a strip along its ring, in its paints', () => {
    setBloomMask(false);
    const look = tuning.look.chart;
    const chart = new Chart({ districts, map: { weight: 1, unitsPerPx: 1 } });
    const [discs, rings] = parts(chart);
    if (!discs || !rings) throw new Error('no parts');
    const { nebula, system } = tokens.color;
    const families = [
      [nebula.butter.mid, nebula.butter.lit, system.butter.base],
      [nebula.sky.mid, nebula.sky.lit, system.sky.base],
    ];
    districts.forEach(({ x, z, radius }, d) => {
      // Every corner of a district's polygon knows the district, and wears its two dim tones.
      const corner = d * DISC_SIDES;
      expect(new Set(rows(discs.geometry, 'aDisc', corner, DISC_SIDES).map(String))).toEqual(
        new Set([String([x, z, radius])]),
      );
      expect(rows(discs.geometry, 'aOuter', corner, DISC_SIDES).map(hexOf)).toEqual(
        Array.from({ length: DISC_SIDES }, () => families[d]?.[0]),
      );
      expect(rows(discs.geometry, 'aInner', corner, DISC_SIDES).map(hexOf)).toEqual(
        Array.from({ length: DISC_SIDES }, () => families[d]?.[1]),
      );
      // The polygon stands round the outer disc.
      const [[px = NaN, , pz = NaN] = []] = rows(discs.geometry, 'position', corner, 1);
      expect(Math.hypot(px - x, pz - z)).toBeCloseTo(
        (radius * look.districtOuter) / Math.cos(Math.PI / DISC_SIDES),
        3,
      );
      // The strip lies along the ring at its reach, in its family's base.
      const pair = d * RING_SIDES * 2;
      expect(new Set(rows(rings.geometry, 'aDisc', pair, RING_SIDES * 2).map(String))).toEqual(
        new Set([String([x, z, radius])]),
      );
      expect(rows(rings.geometry, 'aRing', pair, RING_SIDES * 2).map(hexOf)).toEqual(
        Array.from({ length: RING_SIDES * 2 }, () => families[d]?.[2]),
      );
      const [[rx = NaN, , rz = NaN] = []] = rows(rings.geometry, 'position', pair, 1);
      expect(Math.hypot(rx - x, rz - z)).toBeCloseTo(radius, 3);
    });
    expect(discs.geometry.getIndex()?.count).toBe(districts.length * (DISC_SIDES - 2) * 3);
    expect(rings.geometry.getIndex()?.count).toBe(districts.length * RING_SIDES * 6);
    chart.dispose();
  });

  it('is only the dots for a galaxy with no system at all', () => {
    setBloomMask(false);
    const chart = new Chart({ districts: [], map: { weight: 1, unitsPerPx: 1 } });
    expect(chart.object.material.name).toBe('chart-dots');
    expect(chart.object.children).toHaveLength(0);
    chart.frameUpdate();
    chart.dispose();
  });

  // THE ONE THING THE PARTS DO IN ANOTHER ORDER: every ring is laid after every disc, where the
  // one program lays a district whole before the next. The two give the same picture unless a
  // district's disc reaches under ANOTHER district's ring, and the layout keeps them apart
  // (data/build.ts refuses two systems nearer than their reaches and `minSystemGap`): a disc
  // comes `districtOuter` reaches out, so at most this far past its own ring...
  it('lays no district’s disc under another district’s ring', () => {
    const { maxSystemRadius, minSystemGap } = tuning.layout;
    const past = (tuning.look.chart.districtOuter - 1) * maxSystemRadius;
    // ...and the gap is wider, by more than the soft edge of the disc (half a pixel) and half
    // the ring's line with its own soft edge, even on a map of forty units a pixel (today's
    // galaxy fills a phone at about six).
    const edgesPx = 0.5 + (0.5 * tuning.look.chart.ringWidthPx + 0.5);
    expect(past + edgesPx * 40).toBeLessThan(minSystemGap);
  });

  it('leaves each part room for its soft edge and for a pixel of the picture', () => {
    setBloomMask(false);
    const chart = new Chart({ districts, map: { weight: 1, unitsPerPx: 1 } });
    const [discs, rings] = parts(chart);
    // Half a CSS px of soft edge, and the far corner of a pixel of the picture, which is as
    // many CSS px as the pixel ratio is small: two at the least the governor may go.
    const needed = 0.5 + Math.SQRT2 / tuning.quality.minPixelRatio / 2;
    expect(CHART_ROOM_PX).toBeGreaterThan(needed);
    expect(discs?.material.uniforms.uRoom?.value).toBe(CHART_ROOM_PX);
    // A ring's line reaches half its width to either side of the ring itself.
    expect(rings?.material.uniforms.uRoom?.value).toBe(
      CHART_ROOM_PX + 0.5 * tuning.look.chart.ringWidthPx,
    );
    chart.dispose();
  });
});
