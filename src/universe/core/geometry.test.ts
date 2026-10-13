import { describe, expect, it } from 'vitest';
import { BEND_ATTRIBUTE, DECAL_ATTRIBUTE, UNLIT_ATTRIBUTE } from '../design/materials';
import { geometryFrom } from './geometry';

/** One triangle, facing +Y. */
const triangle = () => ({
  positions: new Float32Array([0, 0, 0, 0, 0, 1, 1, 0, 0]),
  normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
  colors: new Float32Array([1, 0.5, 0.25, 1, 0.5, 0.25, 1, 0.5, 0.25]),
  triangleCount: 1,
});

describe('geometryFrom', () => {
  it('hands the arrays over as they are, and gives flags nobody set as zeros', () => {
    const mesh = triangle();
    const geometry = geometryFrom(mesh);
    expect(geometry.getAttribute('position').array).toBe(mesh.positions);
    expect(geometry.getAttribute('normal').array).toBe(mesh.normals);
    expect(geometry.getAttribute('color').array).toBe(mesh.colors);
    // A generated planet or a model: lit, and no decal, said by the geometry itself. A missing
    // attribute would read whatever value another program left at its location.
    for (const name of [UNLIT_ATTRIBUTE, DECAL_ATTRIBUTE]) {
      const flag = geometry.getAttribute(name);
      expect(flag.count, name).toBe(3);
      expect(flag.itemSize, name).toBe(1);
      expect([...flag.array], name).toEqual([0, 0, 0]);
    }
    expect(geometry.boundingSphere?.radius).toBeGreaterThan(0);
  });

  it('carries how each vertex is lit, and which are decals, when any is set', () => {
    const unlit = new Float32Array([2, 2, 2]);
    const decal = new Uint8Array([1, 1, 1]);
    const geometry = geometryFrom({ ...triangle(), unlit, decal });
    const flag = geometry.getAttribute(UNLIT_ATTRIBUTE);
    expect(flag.array).toBe(unlit);
    expect(flag.itemSize).toBe(1);
    expect(geometry.getAttribute(DECAL_ATTRIBUTE).array).toBe(decal);
  });

  it("carries how a face's lines bend, and zeros where nothing does", () => {
    const plain = geometryFrom(triangle()).getAttribute(BEND_ATTRIBUTE);
    expect(plain.itemSize).toBe(4);
    expect([...plain.array]).toEqual(new Array(12).fill(0));
    const bends = new Float32Array([0, 0.5, 0, 0, 1, 0.5, 0, 0, 0.5, 0.5, 0, 0]);
    expect(geometryFrom({ ...triangle(), bends }).getAttribute(BEND_ATTRIBUTE).array).toBe(bends);
  });
});
