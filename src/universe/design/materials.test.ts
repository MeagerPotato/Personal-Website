import { describe, expect, it } from 'vitest';
import {
  DECAL_ATTRIBUTE,
  UNLIT_ATTRIBUTE,
  createGlowMaterial,
  createToonMaterial,
  refreshToonLook,
} from './materials';
import { glow } from './shaders/glow';
import { toonFlat } from './shaders/toonFlat';
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
    // A missing attribute reads the material's default, not whatever another program left there.
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
