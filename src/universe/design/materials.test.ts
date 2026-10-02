import {
  OneFactor,
  OneMinusSrcAlphaFactor,
  ZeroFactor,
  type Color,
  type Vector3,
  type Vector4,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  DECAL_ATTRIBUTE,
  BEND_ATTRIBUTE,
  OVER_ATTRIBUTE,
  SIDE_ATTRIBUTE,
  UNLIT_ATTRIBUTE,
  createCoronaMaterial,
  createEdgeMaterial,
  createGlowMaterial,
  createToonMaterial,
  refreshToonLook,
} from './materials';
import { edge } from './shaders/edge';
import { glow } from './shaders/glow';
import { SUN_SPOTS, SUN_TONES, toonFlat } from './shaders/toonFlat';
import {
  CORONA_GLOW_STOPS,
  CORONA_PROMS,
  CORONA_RAY_STOPS,
  CORONA_STEPS,
  corona,
} from './shaders/corona';
import { SUN_TONE_COUNT } from '../sim/sunSurface';
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
    expect(toonFlat.vertexShader).toContain(`attribute vec4 ${SIDE_ATTRIBUTE};`);
    expect(toonFlat.vertexShader).toContain(`attribute vec4 ${OVER_ATTRIBUTE};`);
    expect(toonFlat.vertexShader).toContain(`attribute vec4 ${BEND_ATTRIBUTE};`);
  });

  it('keeps colour flat and makes light round: a band is decided for every pixel', () => {
    const { vertexShader, fragmentShader } = toonFlat;
    // A face is one colour, edge to edge: its colours never blend across it.
    for (const name of ['vColor', 'vSide', 'vOver']) {
      expect(vertexShader).toContain(`flat varying vec3 ${name};`);
      expect(fragmentShader).toContain(`flat varying vec3 ${name};`);
    }
    // How far a place faces its sun comes down from the vertices' normals, unflattened, and the
    // three bands are cut from it in the fragment shader, a pixel soft.
    expect(vertexShader).toContain('varying float vFacing;');
    expect(vertexShader).not.toContain('flat varying float vFacing');
    expect(fragmentShader).toContain(
      'float level = mix(uMidLevel * past(vFacing, uBandEdges.x), 1.0, past(vFacing, uBandEdges.y));',
    );
    expect(fragmentShader).toContain(
      'return clamp((value - edge) / max(fwidth(value), 1e-6) + 0.5, 0.0, 1.0);',
    );
    // A lit place is exactly its colour: the shade is mixed in by the level alone.
    expect(fragmentShader).toContain('mix(base * uShadowTint, base, level)');
    // A face's other colours are laid over its own along their lines: zeros leave it alone.
    expect(fragmentShader).toContain('mix(vColor, vSide, past(vEdge.x + arc(vBend.xy), 0.5)),');
    expect(fragmentShader).toContain('past(vEdge.y + arc(vBend.zw), 0.5)');
    // And a line is an arc: its bend is nothing at its two ends (and beyond them), the most
    // halfway along. No bend: the straight line it was.
    expect(fragmentShader).toContain('float along = clamp(bend.x, 0.0, 1.0);');
    expect(fragmentShader).toContain('return bend.y * along * (1.0 - along);');
    // The map and an unlit vertex take all the light, as before.
    expect(fragmentShader).toContain('level = mix(level, 1.0, uFlatness);');
    expect(fragmentShader).toContain('if (vUnlit > 0.5) level = 1.0;');
  });

  it('lights geometry without the flags as before: lit, and no decal', () => {
    const material = createToonMaterial({ vertexColors: true });
    // Every geometry carries both (core/geometry.ts); these defaults are a backstop for its first
    // frame only. Position is at location 0, which a driver must never find switched off.
    expect(material.index0AttributeName).toBe('position');
    expect(material.defaultAttributeValues).toMatchObject({
      [UNLIT_ATTRIBUTE]: [0],
      [DECAL_ATTRIBUTE]: [0],
      [SIDE_ATTRIBUTE]: [0, 0, 0, 0],
      [OVER_ATTRIBUTE]: [0, 0, 0, 0],
      [BEND_ATTRIBUTE]: [0, 0, 0, 0],
      // three's own defaults are kept.
      color: [1, 1, 1],
    });
    material.dispose();
  });

  it('writes the bloom guest list as the glow shader does, and a lit surface off it', () => {
    // Lit and flat: 1 - uBloomMask, as before the flag existed. Glowing: the glow shader's own.
    expect(glow.fragmentShader).toContain('mix(1.0, uBloom, uBloomMask)');
    expect(toonFlat.fragmentShader).toContain('float bloom = vUnlit > 1.5 ? uGlowBloom : 0.0;');
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

describe('a sun’s material and its corona', () => {
  it('gives a sun the ladder of its family: its three tokens, hot, and the spots’ two shades', () => {
    const material = createToonMaterial({ vertexColors: true, sun: 'lilac' });
    expect(material.defines).toEqual({ SUN: '' });
    const ladder = material.uniforms.uSunTone?.value as Vector3[];
    expect(ladder).toHaveLength(SUN_TONES);
    expect(SUN_TONES).toBe(SUN_TONE_COUNT);
    const { shade, base, light } = tokens.color.system.lilac;
    expect(ladder[0]?.toArray()).toEqual([...hexToLinear(shade)]);
    expect(ladder[1]?.toArray()).toEqual([...hexToLinear(base)]);
    expect(ladder[2]?.toArray()).toEqual([...hexToLinear(light)]);
    // The surface's numbers, as the shader reads them (design/tuning.ts, `look.sun`).
    const { granulation, limbNz, softLimb, softSpotRad, spots } = tuning.look.sun;
    expect((material.uniforms.uSunLimb?.value as Vector4).toArray()).toEqual([
      ...limbNz,
      softLimb,
      softSpotRad,
    ]);
    expect((material.uniforms.uSunGrain?.value as Vector4).toArray()).toEqual([
      granulation.freq,
      granulation.weight,
      granulation.freq2,
      granulation.soft,
    ]);
    expect((material.uniforms.uSunCut?.value as Vector3).toArray()).toEqual([
      ...granulation.thresholds,
    ]);
    const marks = material.uniforms.uSunSpot?.value as Vector4[];
    expect(marks).toHaveLength(SUN_SPOTS);
    marks.forEach((mark, i) => {
      expect(Math.hypot(mark.x, mark.y, mark.z)).toBeCloseTo(1, 12);
      expect(mark.w).toBe(spots[i]?.radius);
    });
    // No other material pays for it.
    const plain = createToonMaterial();
    for (const name of ['uSunTone', 'uSunGrain', 'uSunCut', 'uSunLimb', 'uSunSpot']) {
      expect(plain.uniforms).not.toHaveProperty(name);
    }
    plain.dispose();
    material.dispose();
  });

  it('is a flat disc of its token on the star map, and steps down its ladder at the limb', () => {
    const { fragmentShader } = toonFlat;
    // uFlatness 1 takes every tone, the limb and the spots back to tone 1, the family's base:
    // uSunTone[1] is exactly the token (above), so the map's sun is its token.
    expect(fragmentShader).toContain('return uTint * mix(surface, uSunTone[1], uFlatness);');
    // Only the ball's own facets are the surface; a plain glow (2: a gear, a sign) keeps its colour.
    expect(fragmentShader).toContain('if (vUnlit > 4.0) base = surface;');
    // The limb moves the four tones of the granulation down the ladder, never below shade, and
    // the spots are laid over it afterwards: they keep their shades.
    expect(fragmentShader).toContain(
      'tone - 2.0 + soft(vLimb, uSunLimb.x, uSunLimb.z) + soft(vLimb, uSunLimb.y, uSunLimb.z),\n          0.0',
    );
    expect(fragmentShader.indexOf('uSunTone[5], core')).toBeGreaterThan(
      fragmentShader.indexOf('soft(vLimb, uSunLimb.x'),
    );
    // Every edge on a sun is soft, and never thinner than a pixel.
    expect(fragmentShader).toContain('reach = max(reach, fwidth(value));');
    // A sun's facet still glows and blooms as any glowing vertex does.
    expect(fragmentShader).toContain('float bloom = vUnlit > 1.5 ? uGlowBloom : 0.0;');
  });

  it('lays the corona’s tables out as its shader reads them, and never on the bloom guest list', () => {
    const { corona: look } = tuning.look.sun;
    const full = createCoronaMaterial({ low: false });
    const low = createCoronaMaterial({ low: true });
    const { uniforms } = full;
    expect(uniforms.uSteps?.value).toHaveLength(CORONA_STEPS);
    expect(uniforms.uGlowStops?.value).toHaveLength(CORONA_GLOW_STOPS);
    expect(uniforms.uRayStops?.value).toHaveLength(CORONA_RAY_STOPS);
    expect(uniforms.uProm?.value).toHaveLength(CORONA_PROMS);
    // A tone is its place in the family: shade 0, base 1, light 2.
    expect((uniforms.uGlowStops?.value as Vector3[]).map((stop) => stop.y)).toEqual([2, 1, 0, 0]);
    // A loop's apex is halfway from its feet to its control point: about 1.2 to 1.27 radii.
    for (const loop of uniforms.uProm?.value as Vector3[]) {
      expect(loop.z).toBeGreaterThan(1.19);
      expect(loop.z).toBeLessThan(1.28);
    }
    // Every ray, or the low tier's six; and the low tier has neither loops nor the glint.
    expect(uniforms.uRayMask?.value).toBe(2 ** look.rays.count - 1);
    const kept = low.uniforms.uRayMask?.value as number;
    expect(look.rays.lowIndices.every((index) => (kept >> index) & 1)).toBe(true);
    expect(kept.toString(2).replaceAll('0', '')).toHaveLength(look.rays.lowIndices.length);
    expect([uniforms.uFull?.value, low.uniforms.uFull?.value]).toEqual([1, 0]);
    // Upper left on the screen, whose y is up here.
    expect((uniforms.uGlint?.value as Vector4).y).toBe(-look.glint.at[1]);
    // The navy it is laid over, in display space.
    const navy = Number.parseInt(tokens.color.space[900].slice(1, 3), 16) / 255;
    expect((uniforms.uUnder?.value as Color).r).toBeCloseTo(navy, 6);
    for (const material of [full, low]) {
      // Premultiplied colour over what is behind, and alpha left as it was found.
      expect(material.blendSrc).toBe(OneFactor);
      expect(material.blendDst).toBe(OneMinusSrcAlphaFactor);
      expect(material.blendSrcAlpha).toBe(ZeroFactor);
      expect(material.blendDstAlpha).toBe(OneFactor);
      expect(material.depthWrite).toBe(false);
      expect(material.uniforms.uBloomMask).toBe(createToonMaterial().uniforms.uBloomMask);
      material.dispose();
    }
    // On the map (uCalm 1) only the halo's steps are left: everything else is times its `live`.
    expect(corona.fragmentShader).toContain('float live = 1.0 - uCalm;');
    expect(corona.fragmentShader).toContain('over(vBase, halo);');
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
