import { OneFactor, OneMinusSrcAlphaFactor, ZeroFactor } from 'three';
import { describe, expect, it } from 'vitest';
import {
  DECAL_ATTRIBUTE,
  UNLIT_ATTRIBUTE,
  createEdgeMaterial,
  createGlowMaterial,
  createToonMaterial,
  refreshToonLook,
} from './materials';
import { edge } from './shaders/edge';
import { glow } from './shaders/glow';
import { toonFlat } from './shaders/toonFlat';
import { hexToLinear } from '../sim/color';
import { tokens } from './tokens';
import { tuning } from './tuning';

// The GLSL itself only runs on a GPU; what is checked here is its contract with logic: the names
// of its attributes and uniforms, the defaults a geometry without the flags reads, and the bloom
// guest list (shaders/post.ts), which a glowing vertex must write exactly as shaders/glow.ts does.

describe('the toon material and its per-vertex flags', () => {
  it('declares the flags the geometry carries, under the names materials.ts exports', () => {
    expect(toonFlat.vertexShader).toContain(`attribute float ${UNLIT_ATTRIBUTE};`);
    expect(toonFlat.vertexShader).toContain(`attribute float ${DECAL_ATTRIBUTE};`);
  });

  it('lights geometry without the flags as before: lit, and no decal', () => {
    const material = createToonMaterial({ vertexColors: true });
    // Every geometry carries both (core/geometry.ts); these defaults are a backstop for its first
    // frame only. Position is at location 0, which a driver must never find switched off.
    expect(material.index0AttributeName).toBe('position');
    expect(material.defaultAttributeValues).toMatchObject({
      [UNLIT_ATTRIBUTE]: [0],
      [DECAL_ATTRIBUTE]: [0],
      // three's own defaults are kept.
      color: [1, 1, 1],
    });
    material.dispose();
  });

  it('writes the bloom guest list as the glow shader does, and a lit surface off it', () => {
    // Lit and flat: 1 - uBloomMask, as before the flag existed. Glowing: the glow shader's own.
    expect(glow.fragmentShader).toContain('mix(1.0, uBloom, uBloomMask)');
    expect(toonFlat.fragmentShader).toContain('float bloom = mix(0.0, uGlowBloom, vGlow);');
    expect(toonFlat.fragmentShader).toContain('mix(1.0, bloom, uBloomMask)');
    // A glowing vertex blooms as much as a sun does.
    const sun = createGlowMaterial({ intensity: 1, bloom: tuning.world.sunBloom });
    const toon = createToonMaterial();
    expect(toon.uniforms.uGlowBloom?.value).toBe(sun.uniforms.uBloom.value);
    sun.dispose();
    toon.dispose();
  });

  it('shares the look by reference, so one change reaches every lit surface', () => {
    const a = createToonMaterial();
    const b = createToonMaterial({ vertexColors: true });
    for (const name of ['uGlowBloom', 'uDecalPull', 'uFlatness', 'uBloomMask'] as const) {
      expect(a.uniforms[name]).toBe(b.uniforms[name]);
    }
    // As the dev panel's sliders write it.
    const shading = tuning.shading as { decalPull: number };
    const before = shading.decalPull;
    try {
      shading.decalPull = before * 2;
      refreshToonLook();
      expect(a.uniforms.uDecalPull?.value).toBe(before * 2);
    } finally {
      shading.decalPull = before;
      refreshToonLook();
    }
    a.dispose();
    b.dispose();
  });
});

describe('the blueprint edge material', () => {
  it('draws opaque lines in the family colour that never bloom, pulled over their own fill', () => {
    const material = createEdgeMaterial({ color: tokens.color.system.mint.base });
    const { r, g, b } = material.uniforms.uColor.value;
    const expected = hexToLinear(tokens.color.system.mint.base);
    [r, g, b].forEach((value, k) => expect(value).toBeCloseTo(expected[k] ?? NaN, 6));
    // Its colour replaces what is below; the bloom guest list is left as it was.
    expect(edge.fragmentShader).toContain('gl_FragColor = vec4(uColor, 1.0);');
    expect(material.blendDst).toBe(OneMinusSrcAlphaFactor);
    expect([material.blendSrcAlpha, material.blendDstAlpha]).toEqual([ZeroFactor, OneFactor]);
    // Twice a decal's pull, and the same one: a slider moves both.
    expect(edge.vertexShader).toContain('1.0 - 2.0 * uDecalPull');
    expect(material.uniforms.uDecalPull).toBe(createToonMaterial().uniforms.uDecalPull);
    material.dispose();
  });
});
