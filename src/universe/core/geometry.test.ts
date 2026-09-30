import { describe, expect, it } from 'vitest';
import { DECAL_ATTRIBUTE, UNLIT_ATTRIBUTE } from '../design/materials';
import { geometryFrom } from './geometry';

/** One triangle, facing +Y. */
const triangle = () => ({
  positions: new Float32Array([0, 0, 0, 0, 0, 1, 1, 0, 0]),
  normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
  colors: new Float32Array([1, 0.5, 0.25, 1, 0.5, 0.25, 1, 0.5, 0.25]),
  triangleCount: 1,
});

describe('geometryFrom', () => {
  it('hands the arrays over as they are, and leaves out flags nobody set', () => {
    const mesh = triangle();
    const geometry = geometryFrom(mesh);
    expect(geometry.getAttribute('position').array).toBe(mesh.positions);
    expect(geometry.getAttribute('normal').array).toBe(mesh.normals);
    expect(geometry.getAttribute('color').array).toBe(mesh.colors);
    // A generated planet or a model: no flags, so the material's defaults (lit, no decal) hold.
    expect(geometry.getAttribute(UNLIT_ATTRIBUTE)).toBeUndefined();
    expect(geometry.getAttribute(DECAL_ATTRIBUTE)).toBeUndefined();
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

    // All zeros says nothing the defaults do not.
    const plain = geometryFrom({
      ...triangle(),
      unlit: new Float32Array(3),
      decal: new Uint8Array(3),
    });
    expect(plain.getAttribute(UNLIT_ATTRIBUTE)).toBeUndefined();
    expect(plain.getAttribute(DECAL_ATTRIBUTE)).toBeUndefined();
  });
});
