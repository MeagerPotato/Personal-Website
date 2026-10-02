import {
  OneFactor,
  OneMinusSrcAlphaFactor,
  SrcAlphaFactor,
  Texture,
  Vector3,
  ZeroFactor,
  type Color,
  type Vector2,
  type Vector4,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  DECAL_ATTRIBUTE,
  BEND_ATTRIBUTE,
  OVER_ATTRIBUTE,
  SIDE_ATTRIBUTE,
  UNLIT_ATTRIBUTE,
  airBands,
  airColor,
  cloudColor,
  createAirShellMaterial,
  createBackdropMaterial,
  createChartMaterial,
  createCloudMaterial,
  createCoronaMaterial,
  createEdgeMaterial,
  createGlowMaterial,
  createSkyBakeMaterial,
  createStarMaterial,
  createToonMaterial,
  createTrafficMaterial,
  refreshToonLook,
  setSky,
} from './materials';
import {
  AIR_MASK_STOPS,
  AIR_RIM_STOPS,
  AIR_RINGS,
  CLOUD_OCTAVES,
  airCloud,
  airShell,
} from './shaders/air';
import { chart } from './shaders/chart';
import { edge } from './shaders/edge';
import { glow } from './shaders/glow';
import { AIR_LIMB_STEPS, SUN_SPOTS, SUN_TONES, toonFlat } from './shaders/toonFlat';
import { traffic } from './shaders/traffic';
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
    // The normal comes down from the vertices unflattened, how far the place faces its sun is
    // asked at the pixel, and the three bands are cut from that, a pixel soft.
    expect(vertexShader).toContain('varying vec3 vNormal;');
    expect(vertexShader).not.toContain('flat varying vec3 vNormal');
    expect(fragmentShader).toContain('float facing = dot(normalize(vNormal), normalize(vToSun));');
    expect(fragmentShader).toContain('float dusk = past(facing, uBandEdges.x);');
    expect(fragmentShader).toContain('float day = past(facing, uBandEdges.y);');
    expect(fragmentShader).toContain('float level = mix(uMidLevel * dusk, 1.0, day);');
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

describe('a world with air: its material, its shell and its clouds', () => {
  const { air: look } = tuning.look;

  it('gives a world its air, its dusk and its night, and reads where its centre is', () => {
    const center = new Vector3(3, 0, -4);
    const material = createToonMaterial({ vertexColors: true, air: { key: 'tide', center } });
    expect(material.defines).toEqual({ AIR: '' });
    const { uniforms } = material;
    // The very vector: the world moves, and its air with it.
    expect(uniforms.uAirCenter?.value).toBe(center);
    const tide = hexToLinear(tokens.color.air.tide);
    (uniforms.uAir?.value as Color).toArray().forEach((value, k) => {
      expect(value).toBeCloseTo(tide[k] ?? NaN, 6);
    });
    // The night is its token times its strength; the dusk is as much of its token as the look
    // says, and the rest is the colour as lit. Neither is ever black.
    const night = hexToLinear(tokens.color.shading.night);
    const dusk = hexToLinear(tokens.color.shading.dusk);
    const { duskShare } = look.bands;
    (uniforms.uNight?.value as Color).toArray().forEach((value, k) => {
      expect(value).toBeCloseTo((night[k] ?? NaN) * look.bands.night, 6);
      expect(value).toBeGreaterThan(0.04);
    });
    (uniforms.uDusk?.value as Color).toArray().forEach((value, k) => {
      expect(value).toBeCloseTo(1 + ((dusk[k] ?? NaN) * look.bands.dusk - 1) * duskShare, 6);
    });
    // The limb's numbers, as the shader reads them.
    const { limb } = look;
    expect(limb.steps).toBeLessThanOrEqual(AIR_LIMB_STEPS);
    expect((uniforms.uAirLimb?.value as Vector4).toArray()).toEqual([
      limb.power,
      limb.lit,
      limb.always,
      limb.steps,
    ]);
    expect((uniforms.uAirLit?.value as Vector4).toArray()).toEqual([
      ...limb.litEdges,
      ...limb.topRadii,
    ]);
    expect(uniforms.uLampNight?.value).toBe(look.windows.night);
    // It shares the look of every lit surface, and no other material pays for the air.
    const plain = createToonMaterial();
    expect(uniforms.uBandEdges).toBe(plain.uniforms.uBandEdges);
    expect(uniforms.uFlatness).toBe(plain.uniforms.uFlatness);
    for (const name of ['uAir', 'uDusk', 'uNight', 'uAirLimb', 'uAirLit', 'uAirCenter']) {
      expect(plain.uniforms).not.toHaveProperty(name);
    }
    expect(plain.defines).toEqual({});
    plain.dispose();
    material.dispose();
  });

  it('keeps a lit place its colour, flattens on the star map, and never lets a lamp bloom', () => {
    const { fragmentShader, vertexShader } = toonFlat;
    // The three bands: the colour itself where it is lit (`day` 1), then the dusk, then the night.
    expect(fragmentShader).toContain('mix(mix(base * uNight, base * uDusk, dusk), base, day),');
    // Where a place is in the air is asked of the BALL, from the world's centre, at the pixel.
    expect(vertexShader).toContain('vec3 from = worldPosition.xyz - uAirCenter;');
    expect(fragmentShader).toContain('vec3 ball = normalize(vAir.xyz);');
    // Straight on (the ball faces the camera) the limb is nothing, so the tint is nothing.
    expect(fragmentShader).toContain(
      'float limb = pow(1.0 - clamp(dot(ball, normalize(vView)), 0.0, 1.0), uAirLimb.x);',
    );
    // The star map: every band is the colour, and there is no air.
    expect(fragmentShader).toContain('lit = mix(lit, base, uFlatness);');
    expect(fragmentShader).toContain('air *= 1.0 - uFlatness;');
    // A lamp (3) is there only at night, and is never on the bloom guest list.
    expect(fragmentShader).toContain('if (ballFacing > uLampNight || uFlatness > 0.5) discard;');
    expect(fragmentShader.indexOf('bloom = 0.0;')).toBeGreaterThan(
      fragmentShader.indexOf('vUnlit > 2.5 && vUnlit < 3.5'),
    );
  });

  it('lays the shell’s tables out as its shader reads them, and never on the bloom guest list', () => {
    const full = createAirShellMaterial({ low: false });
    const low = createAirShellMaterial({ low: true });
    const { uniforms } = full;
    expect(uniforms.uRings?.value).toHaveLength(AIR_RINGS);
    expect(uniforms.uMask?.value).toHaveLength(AIR_MASK_STOPS);
    expect(uniforms.uRimStops?.value).toHaveLength(AIR_RIM_STOPS);
    expect([uniforms.uRingCount?.value, low.uniforms.uRingCount?.value]).toEqual([
      look.shell.rings.length,
      look.shell.lowRings,
    ]);
    // A tone of the hairline: the air 0, the air toward white 1, the dusk 2 (at the terminator).
    expect((uniforms.uRimStops?.value as Vector3[]).map((stop) => stop.y)).toEqual([1, 1, 2, 0, 0]);
    expect((uniforms.uRimStops?.value as Vector3[])[2]?.x).toBe(90);
    expect((uniforms.uReach?.value as Vector2).toArray()).toEqual([
      look.shell.half,
      look.shell.pull,
    ]);
    // The outermost ring fits on the quad.
    expect(look.shell.rings.at(-1)?.[1]).toBeLessThanOrEqual(look.shell.half);
    for (const material of [full, low]) {
      // Premultiplied colour over what is behind, and alpha left as it was found.
      expect(material.blendSrc).toBe(OneFactor);
      expect(material.blendDst).toBe(OneMinusSrcAlphaFactor);
      expect([material.blendSrcAlpha, material.blendDstAlpha]).toEqual([ZeroFactor, OneFactor]);
      expect(material.depthWrite).toBe(false);
      expect(material.uniforms.uBloomMask).toBe(createToonMaterial().uniforms.uBloomMask);
      material.dispose();
    }
    // On the map (uCalm 1) nothing is left of it.
    expect(airShell.fragmentShader).toContain('float live = 1.0 - uCalm;');
    expect(airShell.fragmentShader).toContain('over(vAir, shell * mask * live);');
    // The air's colour in display space, where the shader lays its paint.
    const sea = Number.parseInt(tokens.color.air.terra.slice(1, 3), 16) / 255;
    expect(airColor('terra').r).toBeCloseTo(sea, 4);
  });

  it('draws clouds in the ground’s own bands, drifting unless asked not to, never blooming', () => {
    const { cloud } = look;
    const drifting = createCloudMaterial({ motion: true });
    const still = createCloudMaterial({ motion: false });
    expect(cloud.octaves).toBeLessThanOrEqual(CLOUD_OCTAVES);
    expect((drifting.uniforms.uSkin?.value as Vector2).toArray()).toEqual([
      cloud.skin,
      cloud.driftRadPerSec,
    ]);
    expect((still.uniforms.uSkin?.value as Vector2).y).toBe(0);
    // The same dusk and night as the ground's material, and the same band edges (by reference).
    const bands = airBands();
    expect((drifting.uniforms.uDusk?.value as Color).toArray()).toEqual(
      bands.uDusk.value.toArray(),
    );
    expect((drifting.uniforms.uNight?.value as Color).toArray()).toEqual(
      bands.uNight.value.toArray(),
    );
    expect(drifting.uniforms.uBandEdges).toBe(createToonMaterial().uniforms.uBandEdges);
    for (const material of [drifting, still]) {
      // Paint over what is behind, and alpha left as it was found.
      expect(material.blendSrc).toBe(SrcAlphaFactor);
      expect(material.blendDst).toBe(OneMinusSrcAlphaFactor);
      expect([material.blendSrcAlpha, material.blendDstAlpha]).toEqual([ZeroFactor, OneFactor]);
      expect(material.depthWrite).toBe(false);
      material.dispose();
    }
    // A cloud is a flat shape: two levels, each with a soft edge never thinner than a pixel.
    expect(airCloud.fragmentShader).toContain('float reach = max(uSoft, fwidth(value));');
    expect(airCloud.fragmentShader).toContain('alpha * (1.0 - uCalm)');
    // Its colour: the peak, toned down, a little toward the air. Brighter than the air is dark.
    const lit = cloudColor('terra', 'frost');
    const peak = hexToLinear(tokens.color.biome.frost.peak);
    const air = hexToLinear(tokens.color.air.terra);
    lit.toArray().forEach((value, k) => {
      const mixed = (peak[k] ?? NaN) + ((air[k] ?? NaN) - (peak[k] ?? NaN)) * cloud.mix;
      expect(value).toBeCloseTo(mixed * cloud.tone, 6);
    });
  });
});

describe('traffic and the chart', () => {
  it('paints a dot of traffic over what is behind it, behind the solid world, never blooming', () => {
    const material = createTrafficMaterial();
    expect(material.uniforms.uOpacity?.value).toBe(tuning.look.traffic.opacity);
    expect(material.blendSrc).toBe(SrcAlphaFactor);
    expect(material.blendDst).toBe(OneMinusSrcAlphaFactor);
    expect([material.blendSrcAlpha, material.blendDstAlpha]).toEqual([ZeroFactor, OneFactor]);
    expect([material.depthTest, material.depthWrite]).toEqual([true, false]);
    // Its place's y is its size, not a height: every dot lies on the flight plane.
    expect(traffic.vertexShader).toContain('modelViewMatrix * vec4(aDot.x, 0.0, aDot.z, 1.0)');
    expect(traffic.vertexShader).toContain('0.5 * aDot.y * uView.z');
    material.dispose();
  });

  it('lays the chart’s numbers out as its shader reads them, and never on the bloom guest list', () => {
    const look = tuning.look.chart;
    const material = createChartMaterial([{ x: 3, z: -4, radius: 50, family: 'mint' }]);
    const { uniforms } = material;
    expect(material.defines?.DISTRICTS).toBe(1);
    expect((uniforms.uGrid?.value as Vector3).toArray()).toEqual([
      look.dotSpacingPx,
      look.dotRadiusPx,
      look.dotAlpha,
    ]);
    expect((uniforms.uDistrict?.value as Vector4).toArray()).toEqual([
      look.districtOuter,
      look.districtOuterAlpha,
      look.districtInnerAlpha,
      look.ringAlpha,
    ]);
    expect((uniforms.uDash?.value as Vector3).toArray()).toEqual([
      look.ringWidthPx,
      ...look.ringDashPx,
    ]);
    // The dots in the quietest ink, in display space: the token itself.
    const low = Number.parseInt(tokens.color.ink.low.slice(1, 3), 16) / 255;
    expect((uniforms.uDot?.value as Color).r).toBeCloseTo(low, 4);
    // Under it, the sky straight down: all but the deepest navy.
    const deep = Number.parseInt(tokens.color.space[950].slice(5, 7), 16) / 255;
    const horizon = Number.parseInt(tokens.color.space[800].slice(5, 7), 16) / 255;
    const under = (uniforms.uUnder?.value as Color).b;
    expect(under).toBeGreaterThanOrEqual(deep - 1e-6);
    expect(under).toBeLessThan(deep + 0.1 * (horizon - deep));
    // Premultiplied colour over what is behind, and alpha left as it was found.
    expect(material.blendSrc).toBe(OneFactor);
    expect(material.blendDst).toBe(OneMinusSrcAlphaFactor);
    expect([material.blendSrcAlpha, material.blendDstAlpha]).toEqual([ZeroFactor, OneFactor]);
    expect(material.depthWrite).toBe(false);
    expect(uniforms.uBloomMask).toBe(createToonMaterial().uniforms.uBloomMask);
    // Every part is as much there as the map is: the dots, and a district's three alphas.
    expect(chart.fragmentShader.match(/uWeight \* /g)).toHaveLength(2);
    material.dispose();
    // A galaxy with no system at all still compiles: one district nobody can see.
    const empty = createChartMaterial([]);
    expect(empty.defines?.DISTRICTS).toBe(1);
    expect((empty.uniforms.uDisc?.value as Vector3[])[0]?.z).toBe(0);
    empty.dispose();
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

describe('the sky’s bake', () => {
  it('hands the shader tables as long as it declares them, on every tier', () => {
    for (const tier of Object.values(tuning.look.sky.tiers)) {
      const material = createSkyBakeMaterial(tier);
      const { uniforms, fragmentShader } = material;
      const declared = (name: string): number =>
        Number(new RegExp(`uniform \\w+ ${name}\\[(\\d+)\\]`).exec(fragmentShader)?.[1]);
      // Colours go in end to end, three numbers each.
      expect(uniforms.uRamp?.value).toHaveLength(declared('uRamp') * 3);
      expect(uniforms.uStar?.value).toHaveLength(declared('uStar') * 3);
      expect(uniforms.uLoop?.value).toHaveLength(declared('uLoop'));
      // The recipe is in the program, and no number of it failed to print.
      expect(fragmentShader).toContain('const float INTENSITY=');
      expect(fragmentShader).not.toMatch(/NaN|undefined/);
      // It is drawn into a panorama, over nothing: no depth, no blending.
      expect(material.depthTest).toBe(false);
      expect(material.transparent).toBe(false);
      material.dispose();
    }
  });

  it('the backdrop and the stars read one sky', () => {
    const backdrop = createBackdropMaterial();
    const stars = createStarMaterial({ motion: false });
    // Until a panorama is there: no light of it, and no star dimmed by it.
    expect(backdrop.uniforms.uExposure?.value).toBe(0);
    expect(stars.uniforms.uReveal).toBe(backdrop.uniforms.uReveal);
    expect(stars.uniforms.uPano).toBe(backdrop.uniforms.uPano);
    const pano = new Texture();
    setSky(pano, 0.5, 0.25);
    expect(backdrop.uniforms.uPano?.value).toBe(pano);
    expect(stars.uniforms.uReveal?.value).toBe(0.5);
    expect(backdrop.uniforms.uExposure?.value).toBe(0.25);
    // Without a panorama nothing of a sky shows, whatever is asked.
    setSky(null, 1, 1);
    expect(backdrop.uniforms.uPano?.value).toBeNull();
    expect(backdrop.uniforms.uReveal?.value).toBe(0);
    expect(backdrop.uniforms.uExposure?.value).toBe(0);
    backdrop.dispose();
    stars.dispose();
    pano.dispose();
  });
});
