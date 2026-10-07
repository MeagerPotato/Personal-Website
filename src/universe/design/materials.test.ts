import {
  BackSide,
  CustomBlending,
  DoubleSide,
  OneFactor,
  OneMinusSrcAlphaFactor,
  SrcAlphaFactor,
  ZeroFactor,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  DECAL_ATTRIBUTE,
  HYPER_FAMILY_TINT,
  HYPER_TINT_SHARES,
  UNLIT_ATTRIBUTE,
  createEdgeMaterial,
  createGlowMaterial,
  createHyperDashMaterial,
  createHyperTubeMaterial,
  createToonMaterial,
  refreshToonLook,
  wearHyperFamily,
} from './materials';
import { edge } from './shaders/edge';
import { glow } from './shaders/glow';
import { DASH_SPAN, DASH_TINTS, hyperDashes, hyperTube } from './shaders/hyperspace';
import { toonFlat } from './shaders/toonFlat';
import { hexToLinear } from '../sim/color';
import { THEME_KEYS, tokens } from './tokens';
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

describe('the materials of hyperspace', () => {
  it('are paint and light over the sky that leave the bloom guest list alone', () => {
    const tube = createHyperTubeMaterial({ ribs: true });
    const dashes = createHyperDashMaterial();
    for (const material of [tube, dashes]) {
      expect(material.transparent, material.name).toBe(true);
      expect(material.depthWrite, material.name).toBe(false);
      // Behind every body: the depth test is what keeps the destination clear of them.
      expect(material.depthTest, material.name).toBe(true);
      expect(material.blending, material.name).toBe(CustomBlending);
      expect(material.blendSrc, material.name).toBe(SrcAlphaFactor);
      expect([material.blendSrcAlpha, material.blendDstAlpha], material.name).toEqual([
        ZeroFactor,
        OneFactor,
      ]);
    }
    // The tunnel is paint that covers; the dashes are light that adds up, as the stars are.
    expect(tube.blendDst).toBe(OneMinusSrcAlphaFactor);
    expect(dashes.blendDst).toBe(OneFactor);
    // The tunnel is seen from inside; a dash shows whichever way round it lies.
    expect(tube.side).toBe(BackSide);
    expect(dashes.side).toBe(DoubleSide);
    tube.dispose();
    dashes.dispose();
  });

  it('draw at the far plane, turned by the view and never moved by it, as the sky is', () => {
    for (const shader of [hyperTube, hyperDashes]) {
      expect(shader.vertexShader).toContain('mat3(viewMatrix)');
      expect(shader.vertexShader).toContain('clip.z = clip.w;');
      expect(shader.vertexShader).not.toContain('modelViewMatrix');
      // The last word is three's: the same colours straight to the canvas and through post.
      expect(shader.fragmentShader.trimEnd()).toMatch(/#include <colorspace_fragment>\s*\}$/);
    }
    // The dashes run from the rim of the eye to 69 degrees off the course, and the shader says
    // so in numbers.
    expect(hyperDashes.vertexShader).toContain(`${DASH_SPAN[0]} * pow(`);
    expect(Math.atan(DASH_SPAN[0])).toBeLessThan(tuning.hyper.eyeRad);
    expect(Math.atan(DASH_SPAN[1])).toBeLessThan(Math.PI / 2);
  });

  it('start at nothing: a tunnel that is shut, dashes that do not show, no ring', () => {
    const tube = createHyperTubeMaterial({ ribs: false });
    const dashes = createHyperDashMaterial();
    expect(tube.uniforms.uOpen.value).toBe(0);
    expect(tube.uniforms.uRing.value.toArray()).toEqual([0, 0]);
    expect(dashes.uniforms.uAlpha.value).toBe(0);
    expect(dashes.uniforms.uStretch.value).toBe(0);
    // What tuning says of them.
    expect(tube.uniforms.uBands.value).toBe(tuning.hyper.bands);
    expect(tube.uniforms.uEye.value).toBe(tuning.hyper.eyeRad);
    expect(tube.uniforms.uWash.value.toArray()).toEqual([...tuning.hyper.wash]);
    expect(dashes.uniforms.uLength.value).toBe(tuning.hyper.dashLength);
    tube.dispose();
    dashes.dispose();
  });

  it('wear the destination family: its base in the ribs and in the lead among the dashes, the other families after it', () => {
    const tube = createHyperTubeMaterial({ ribs: true });
    const dashes = createHyperDashMaterial();
    const linear = (hex: string): number[] =>
      hexToLinear(hex).map((value) => expect.closeTo(value, 6) as number);
    const { white, cool, warm } = tokens.color.star;
    const base = (theme: (typeof THEME_KEYS)[number]): string => tokens.color.system[theme].base;
    for (const theme of THEME_KEYS) {
      wearHyperFamily(tube, dashes, theme);
      const family = tokens.color.system[theme];
      // The walls are deep space's navy in every family: coral's and butter's shade go brown.
      expect(tube.uniforms.uShade.value.toArray(), theme).toEqual(linear(tokens.color.space[700]));
      expect(tube.uniforms.uLine.value.toArray(), theme).toEqual(linear(family.base));
      expect(
        dashes.uniforms.uTint.value.map((tint) => tint.toArray()),
        theme,
      ).toEqual(
        [
          white,
          cool,
          warm,
          family.base,
          ...THEME_KEYS.filter((other) => other !== theme).map(base),
        ].map(linear),
      );
    }
    // No family: the stars' cool white in its place, and four of the families after it.
    wearHyperFamily(tube, dashes, undefined);
    expect(tube.uniforms.uShade.value.toArray()).toEqual(linear(tokens.color.space[700]));
    expect(tube.uniforms.uLine.value.toArray()).toEqual(linear(cool));
    expect(dashes.uniforms.uTint.value.map((tint) => tint.toArray())).toEqual(
      [white, cool, warm, cool, ...THEME_KEYS.slice(0, 4).map(base)].map(linear),
    );
    // As many tints as the shader has room for: the three of the stars, and every family.
    expect(dashes.uniforms.uTint.value).toHaveLength(DASH_TINTS);
    expect(HYPER_TINT_SHARES).toHaveLength(DASH_TINTS);
    expect(DASH_TINTS).toBe(HYPER_FAMILY_TINT + THEME_KEYS.length);
    expect(hyperDashes.vertexShader).toContain(`uniform vec3 uTint[${DASH_TINTS}];`);
    // Their shares are all of the dashes; of the colours, the destination's is the largest by far.
    expect(HYPER_TINT_SHARES.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 12);
    const [lead = 0, ...rest] = HYPER_TINT_SHARES.slice(HYPER_FAMILY_TINT);
    expect(lead).toBeGreaterThanOrEqual(3 * Math.max(...rest));
    tube.dispose();
    dashes.dispose();
  });
});
