import {
  BackSide,
  Color,
  CustomBlending,
  LineBasicMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  SrcAlphaFactor,
  Vector2,
  Vector3,
  Vector4,
  ZeroFactor,
  type IUniform,
  type Material,
  type Texture,
} from 'three';
import { hexToLinear } from '../sim/color';
import { sunLadder } from '../sim/sunSurface';
import { corona } from './shaders/corona';
import { dust } from './shaders/dust';
import { edge } from './shaders/edge';
import { glow } from './shaders/glow';
import { bloomDown, bloomUp, composite } from './shaders/post';
import type { StarClass, SunTone } from './lookTypes';
import { GLOW_COUNT, backdrop, stars } from './shaders/sky';
import { SUN_SPOTS, toonFlat } from './shaders/toonFlat';
import { tokens, type ThemeKey } from './tokens';
import { tuning } from './tuning';

/**
 * MATERIALS: where tokens and tuning meet the shaders. Every material in the universe is made
 * here, so "which colour feeds which uniform" is decided in one place, inside the design surface
 * (docs/PLAN.md §5.6). Logic asks for a material by what it is for, never by what it looks like.
 *
 * `new Color(hex)` converts the token from sRGB to the linear working space; the shaders convert
 * back on output. With no tone mapping, a fully lit surface therefore shows exactly its token.
 *
 * Callers own what they create here: track it in a Scope (core/scope.ts).
 */

/** Where light comes from when there is no sun nearby (deep space, the sunless home system). */
export const KEY_LIGHT_POSITION = new Vector3(-6000, 4200, 3000);

/**
 * The look constants of the toon shader are shared BY REFERENCE between every toon material, so
 * one tweak (the dev panel, or a future day/night mood) restyles the whole world at once.
 */
const toonLook = {
  uShadowTint: { value: new Color(tokens.color.shading.shadow) },
  uBandEdges: { value: new Vector2(...tuning.shading.bandEdges) },
  uMidLevel: { value: tuning.shading.midLevel },
  uFlatness: { value: 0 },
  /** A glowing vertex (aUnlit 2) blooms as a sun does. */
  uGlowBloom: { value: tuning.world.sunBloom },
  /** A decal's pull toward the camera; the ghost lines (shaders/edge.ts) take twice it. */
  uDecalPull: { value: tuning.shading.decalPull },
};

/**
 * THE BLOOM GUEST LIST lives in the picture's alpha channel (shaders/post.ts), but only while
 * somebody reads it. three.js always gives the canvas an alpha channel, so a picture that goes
 * straight to the canvas must be opaque there, or the page would shine through it. One switch,
 * shared by reference with every material that writes alpha: 1 = write the list, 0 = write 1.
 */
const bloomMask = { value: 1 };

/** main.ts says which, once, from the quality tier: is there post-processing to read the list? */
export function setBloomMask(enabled: boolean): void {
  bloomMask.value = enabled ? 1 : 0;
}

/**
 * How much of the shading is taken out of EVERY lit surface, 0 to 1. The star map flattens the
 * world as the camera pulls out to it (main.ts); everywhere else this is 0.
 */
export function setToonFlatness(flatness: number): void {
  toonLook.uFlatness.value = Math.min(1, Math.max(0, flatness));
}

/** Re-read the look constants after tuning changed at run time (the dev panel). */
export function refreshToonLook(): void {
  toonLook.uBandEdges.value.set(...tuning.shading.bandEdges);
  toonLook.uMidLevel.value = tuning.shading.midLevel;
  toonLook.uGlowBloom.value = tuning.world.sunBloom;
  toonLook.uDecalPull.value = tuning.shading.decalPull;
}

/**
 * The per-vertex flags of the emblem worlds (shaders/toonFlat.ts): how a vertex is lit (0 lit, 1
 * flat, 2 glow) and whether it is a decal; and a face's other colours (a side, and an over), each
 * with where the vertex stands on its line. core/geometry.ts names its attributes after these.
 */
export const UNLIT_ATTRIBUTE = 'aUnlit';
export const DECAL_ATTRIBUTE = 'aDecal';
export const SIDE_ATTRIBUTE = 'aSide';
export const OVER_ATTRIBUTE = 'aOver';
/** How the side's line and the over's bend inside a face (sim/meshBuilder.ts, `MeshData.bends`). */
export const BEND_ATTRIBUTE = 'aBend';

export interface ToonOptions {
  /** Multiply by the geometry's `color` attribute (per-facet colours). */
  vertexColors?: boolean;
  /** A token hex that multiplies everything. White when left out. */
  tint?: string;
  /** Each instance carries its own sun in an `aSunPosition` attribute. */
  instancedSun?: boolean;
  /** A sun's own material, in this family: its ball is a living surface (shaders/toonFlat.ts, SUN). */
  sun?: ThemeKey;
}

/**
 * A sun's six tones (sim/sunSurface.ts; as many as the shader's SUN_TONES, which a test holds),
 * darkest first, from its family's three tokens: linear.
 */
export function sunTones(family: ThemeKey): Vector3[] {
  const { shade, base, light } = tokens.color.system[family];
  const ladder = sunLadder(
    { shade: hexToLinear(shade), base: hexToLinear(base), light: hexToLinear(light) },
    tuning.look.sun.hotMix,
  );
  return ladder.map((tone) => new Vector3(...tone));
}

export type ToonMaterial = ShaderMaterial & {
  uniforms: { uSunPosition: IUniform<Vector3>; uTint: IUniform<Color> };
};

export function createToonMaterial(options: ToonOptions = {}): ToonMaterial {
  const material = new ShaderMaterial({
    name: 'toonFlat',
    vertexShader: toonFlat.vertexShader,
    fragmentShader: toonFlat.fragmentShader,
    uniforms: {
      ...toonLook,
      uBloomMask: bloomMask,
      uSunPosition: { value: KEY_LIGHT_POSITION.clone() },
      uTint: { value: new Color(options.tint ?? tokens.color.star.white) },
      ...(options.sun ? sunSurfaceUniforms(options.sun) : {}),
    },
    vertexColors: options.vertexColors ?? false,
    defines: {
      ...(options.instancedSun ? { INSTANCED_SUN: '' } : {}),
      ...(options.sun ? { SUN: '' } : {}),
    },
  });
  // Location 0 is always an array that is there (a driver that finds it switched off emulates
  // it, slowly), whatever order the driver would have put the attributes in. (Set here: three's
  // setValues passes over a property that starts out undefined.)
  material.index0AttributeName = 'position';
  // Every geometry carries the worlds' flags (core/geometry.ts: zeros for a planet or a model).
  // These are a backstop only: three writes a default when it first sets up a geometry's vertex
  // array, and WebGL's generic value at that location is the context's, for any program to change.
  Object.assign(material.defaultAttributeValues, {
    [UNLIT_ATTRIBUTE]: [0],
    [DECAL_ATTRIBUTE]: [0],
    [SIDE_ATTRIBUTE]: [0, 0, 0, 0],
    [OVER_ATTRIBUTE]: [0, 0, 0, 0],
    [BEND_ATTRIBUTE]: [0, 0, 0, 0],
  });
  return material as ToonMaterial;
}

/**
 * A sun's living surface as the shader's uniforms (shaders/toonFlat.ts, SUN): the family's
 * ladder, and `tuning.look.sun` laid out as the shader reads it.
 */
function sunSurfaceUniforms(family: ThemeKey): Record<string, IUniform> {
  const { granulation, limbNz, softLimb, softSpotRad, spots } = tuning.look.sun;
  if (spots.length !== SUN_SPOTS) throw new RangeError(`a sun has ${SUN_SPOTS} spots`);
  return {
    uSunTone: { value: sunTones(family) },
    uSunGrain: {
      value: new Vector4(granulation.freq, granulation.weight, granulation.freq2, granulation.soft),
    },
    uSunCut: { value: new Vector3(...granulation.thresholds) },
    uSunLimb: { value: new Vector4(...limbNz, softLimb, softSpotRad) },
    uSunSpot: {
      value: spots.map(({ normal, radius }) => {
        const n = new Vector3(...normal).normalize();
        return new Vector4(n.x, n.y, n.z, radius);
      }),
    },
  };
}

export type GlowMaterial = ShaderMaterial & {
  uniforms: { uIntensity: IUniform<number>; uBloom: IUniform<number> };
};

/**
 * For things that are light themselves, or that no sun should shade (shaders/glow.ts). Colours
 * come from the geometry; `tint` (a token hex) multiplies them, so a white model can be reused
 * in any colour. `bloom` (0 to 1) is how much of it bleeds into the picture around it.
 */
export function createGlowMaterial(options: {
  intensity: number;
  bloom?: number;
  tint?: string;
}): GlowMaterial {
  const material = new ShaderMaterial({
    name: 'glow',
    vertexShader: glow.vertexShader,
    fragmentShader: glow.fragmentShader,
    uniforms: {
      uIntensity: { value: options.intensity },
      uBloom: { value: options.bloom ?? 0 },
      uBloomMask: bloomMask,
      uTint: { value: new Color(options.tint ?? tokens.color.star.white) },
    },
    vertexColors: true,
  });
  return material as GlowMaterial;
}

/**
 * The alpha channel of the picture is the bloom guest list (shaders/post.ts), so anything
 * SEE-THROUGH must blend its colour and leave alpha as it found it, or every star and every
 * orbit line would glow a little. `additive`: light that adds up (stars, dust) instead of paint
 * that covers (lines).
 */
function keepBloomMask<T extends Material>(material: T, additive: boolean): T {
  material.blending = CustomBlending;
  material.blendSrc = SrcAlphaFactor;
  material.blendDst = additive ? OneFactor : OneMinusSrcAlphaFactor;
  material.blendSrcAlpha = ZeroFactor;
  material.blendDstAlpha = OneFactor;
  return material;
}

/** Thin guide lines drawn in the world: orbit rings now, motorway lanes later. */
export function createLineMaterial(options: { color: string; opacity: number }): LineBasicMaterial {
  return keepBloomMask(
    new LineBasicMaterial({
      color: new Color(options.color),
      transparent: true,
      opacity: options.opacity,
      depthWrite: false,
    }),
    false,
  );
}

export type EdgeMaterial = ShaderMaterial & { uniforms: { uColor: IUniform<Color> } };

/**
 * The lines of a blueprint (shaders/edge.ts): the parts of a planned world still to come, drawn
 * as their edges in `color` (a token hex: the base of the family the body will wear). Opaque
 * colour that leaves the bloom guest list as it found it, so the lines never bloom; drawn after
 * the solid world, over the navy fill they outline.
 */
export function createEdgeMaterial(options: { color: string }): EdgeMaterial {
  const material = new ShaderMaterial({
    name: 'edge',
    vertexShader: edge.vertexShader,
    fragmentShader: edge.fragmentShader,
    uniforms: {
      uColor: { value: new Color(options.color) },
      uDecalPull: toonLook.uDecalPull,
    },
    transparent: true,
    depthWrite: false,
  });
  return keepBloomMask(material, false) as EdgeMaterial;
}

export function createBackdropMaterial(): ShaderMaterial {
  const { horizonFalloff, glows } = tuning.backdrop;
  if (glows.length > GLOW_COUNT) throw new RangeError(`backdrop: at most ${GLOW_COUNT} glows`);

  // Unused slots stay black, which adds nothing.
  const directions = Array.from({ length: GLOW_COUNT }, () => new Vector3(0, 1, 0));
  const colors = Array.from({ length: GLOW_COUNT }, () => new Color(0, 0, 0));
  const tightness = Array.from({ length: GLOW_COUNT }, () => 1);
  glows.forEach((glow, index) => {
    const [x, y, z] = glow.direction;
    directions[index]?.set(x, y, z).normalize();
    colors[index]?.set(tokens.color.system[glow.theme].shade).multiplyScalar(glow.strength);
    tightness[index] = glow.tightness;
  });

  return new ShaderMaterial({
    name: 'backdrop',
    vertexShader: backdrop.vertexShader,
    fragmentShader: backdrop.fragmentShader,
    uniforms: {
      uBloomMask: bloomMask,
      uDeep: { value: new Color(tokens.color.space[950]) },
      uHorizon: { value: new Color(tokens.color.space[800]) },
      uHorizonFalloff: { value: horizonFalloff },
      uGlowDirection: { value: directions },
      uGlowColor: { value: colors },
      uGlowTightness: { value: tightness },
    },
    side: BackSide,
    depthWrite: false,
  });
}

export type StarMaterial = ShaderMaterial & {
  uniforms: {
    uTime: IUniform<number>;
    uView: IUniform<Vector2>;
    uScale: IUniform<Vector2>;
    uOpacity: IUniform<number>;
    uSpikes: IUniform<number>;
  };
};

/**
 * The stars (shaders/sky.ts): the star classes of tuning.starfield, laid out as the shader's
 * tables, a row a kind in the order of STAR_KINDS (sim/starList.ts; STAR_KIND_COUNT rows, which a test holds). `motion`: do some twinkle
 * and the heroes breathe? (Not under reduced motion.) Additive, and not on the bloom guest list.
 */
export function createStarMaterial(options: { motion: boolean }): StarMaterial {
  const { classes, hero, spike, twinkleDepth } = tuning.starfield;
  const kinds: readonly StarClass[] = [classes.dust, classes.field, classes.bright, classes.mid];
  // A kind without a halo or a spike gets one that gives no light, of size 1: the shader divides
  // by these sizes.
  const [near, far] = hero.halos;
  const material = new ShaderMaterial({
    name: 'stars',
    vertexShader: stars.vertexShader,
    fragmentShader: stars.fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uView: { value: new Vector2(1, 1) },
      uScale: { value: new Vector2(1, 1) },
      uTwinkleDepth: { value: options.motion ? twinkleDepth : 0 },
      uOpacity: { value: 1 },
      uSpikes: { value: 1 },
      uBreath: { value: options.motion ? hero.breath : 0 },
      uBreathSec: { value: new Vector2(...hero.breathSec) },
      uCore: { value: [...kinds.map((kind) => kind.sigmaPx), hero.sigmaPx] },
      uHalo: {
        value: [
          ...kinds.map((kind) => new Vector4(kind.haloSigmaPx ?? 1, kind.haloGain ?? 0, 1, 0)),
          new Vector4(...near, ...far),
        ],
      },
      uArm: {
        value: [
          // A mid star's plus: the line across is as long and as bright as the upright one.
          ...kinds.map((kind) => {
            const [length, gain] = [kind.spikeLenPx ?? 1, kind.spikeGain ?? 0];
            return new Vector4(length, gain, length, gain);
          }),
          new Vector4(
            hero.spikeLenPx,
            hero.spikeGain,
            hero.spikeLenPx * hero.crossLen,
            hero.crossGain,
          ),
        ],
      },
      uThick: {
        value: [
          ...kinds.map((kind) => new Vector2().setScalar(kind.spikeThicknessPx ?? 1)),
          // A hero's faint line across is as thin as a mid star's plus.
          new Vector2(hero.spikeThicknessPx, classes.mid.spikeThicknessPx),
        ],
      },
      uProfile: { value: new Vector2(spike.exponent, spike.taper) },
      uBloomMask: bloomMask,
      uUnder: { value: new Color(tokens.color.space[900]) },
    },
    transparent: true,
    depthWrite: false,
  });
  return keepBloomMask(material, true) as StarMaterial;
}

export type CoronaMaterial = ShaderMaterial & {
  uniforms: { uTime: IUniform<number>; uCalm: IUniform<number> };
};

/** A tone of a sun's family as the corona's shader counts them. */
const CORONA_TONE: Record<SunTone, number> = { shade: 0, base: 1, light: 2 };

/**
 * The light round the suns (shaders/corona.ts): `tuning.look.sun.corona` laid out as the
 * shader's tables. `low`: the low tier keeps fewer rays, and neither prominences nor the glint.
 * Premultiplied colour over what is behind it, and not on the bloom guest list. The tables are
 * as long as the shader's (CORONA_STEPS and the rest): materials.test.ts holds them equal.
 */
export function createCoronaMaterial(options: { low: boolean }): CoronaMaterial {
  const { corona: look, rayBreath, rayBreathSec, promBreath, promBreathSec } = tuning.look.sun;
  const { steps, glow, rays, prominences, glint, edge, half, pull, lensHalf, rayBase } = look;
  const stops = (list: ReadonlyArray<readonly [number, SunTone, number]>): Vector3[] =>
    list.map(([at, tone, alpha]) => new Vector3(at, CORONA_TONE[tone], alpha));
  // A loop is a quadratic arch from limb to limb: its apex is halfway to its control point.
  const proms = prominences.angles.map((angle, i) => {
    const span = prominences.halfSpan[i] ?? 0;
    return new Vector3(angle, span, 0.5 * (Math.cos(span) + (prominences.control[i] ?? 1)));
  });
  const all = (1 << rays.count) - 1;
  const kept = rays.lowIndices.reduce<number>((mask, index) => mask | (1 << index), 0);
  const material = new ShaderMaterial({
    name: 'corona',
    vertexShader: corona.vertexShader,
    fragmentShader: corona.fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uCalm: { value: 0 },
      uFull: { value: options.low ? 0 : 1 },
      uRayMask: { value: options.low ? kept : all },
      uBloomMask: bloomMask,
      // Display space: the parts are laid over each other as paint is.
      uUnder: { value: new Color(tokens.color.space[900]).convertLinearToSRGB() },
      uReach: { value: new Vector2(half, lensHalf) },
      uPull: { value: new Vector2(...pull) },
      uSteps: { value: steps.map((ring) => new Vector3(...ring)) },
      uGlow: { value: new Vector2(glow.from, glow.to) },
      uGlowStops: { value: stops(glow.stops) },
      uRay: { value: new Vector4(rays.count, rays.reach, rayBreath, rayBase) },
      uRayShape: { value: new Vector4(...rays.length, ...rays.halfAngle) },
      uRaySec: { value: new Vector2(...rayBreathSec) },
      uRayStops: { value: stops(rays.alphas) },
      uProm: { value: proms },
      uPromStroke: {
        value: prominences.strokes.map(
          ([tone, alpha, width]) => new Vector3(CORONA_TONE[tone], alpha, width),
        ),
      },
      uPromBreath: { value: new Vector3(promBreath, ...promBreathSec) },
      uEdge: { value: new Vector3(edge.from, edge.alpha, edge.widthR) },
      // The design's glint is written with the screen's y down: here it is up.
      uGlint: { value: new Vector4(glint.at[0], -glint.at[1], glint.length, glint.alpha) },
      uGlintSize: { value: new Vector2(glint.widthR, glint.dotR) },
    },
    transparent: true,
    depthWrite: false,
  });
  keepBloomMask(material, false);
  material.blendSrc = OneFactor;
  return material as CoronaMaterial;
}

export type DustMaterial = ShaderMaterial & {
  uniforms: {
    uCenter: IUniform<Vector3>;
    uField: IUniform<Vector3>;
    uBox: IUniform<Vector3>;
    uVelocity: IUniform<Vector3>;
    uStreakSec: IUniform<number>;
    uOpacity: IUniform<number>;
  };
};

export function createDustMaterial(options: { streaks: boolean }): DustMaterial {
  const params = tuning.dust;
  const material = new ShaderMaterial({
    name: 'dust',
    vertexShader: dust.vertexShader,
    fragmentShader: dust.fragmentShader,
    uniforms: {
      uCenter: { value: new Vector3() },
      uField: { value: new Vector3() },
      uBox: { value: new Vector3(...params.box) },
      uVelocity: { value: new Vector3() },
      uStreakSec: { value: options.streaks ? params.streakSec : 0 },
      uRadius: { value: params.radius },
      uColor: { value: new Color(tokens.color.star.cool) },
      uOpacity: { value: params.opacity },
    },
    transparent: true,
    depthWrite: false,
  });
  return keepBloomMask(material, true) as DustMaterial;
}

// --- post-processing (fx/PostFX.ts) ------------------------------------------------------------------

/** A pass reads pictures and writes one: nothing to test against, nothing to blend with. */
function createPassMaterial(
  name: string,
  shader: { vertexShader: string; fragmentShader: string },
  uniforms: Record<string, IUniform>,
  defines: Record<string, string> = {},
): ShaderMaterial {
  return new ShaderMaterial({
    name,
    ...shader,
    uniforms,
    defines,
    depthTest: false,
    depthWrite: false,
  });
}

export type BloomDownMaterial = ShaderMaterial & {
  uniforms: { tInput: IUniform<Texture | null>; uTexel: IUniform<Vector2> };
};

/** Halves a picture. `masked`: the first halving, which reads the scene through its guest list. */
export function createBloomDownMaterial(options: { masked: boolean }): BloomDownMaterial {
  return createPassMaterial(
    options.masked ? 'bloomDownMasked' : 'bloomDown',
    bloomDown,
    { tInput: { value: null }, uTexel: { value: new Vector2() } },
    options.masked ? { MASKED: '' } : {},
  ) as BloomDownMaterial;
}

export type BloomUpMaterial = ShaderMaterial & {
  uniforms: {
    tInput: IUniform<Texture | null>;
    tBase: IUniform<Texture | null>;
    uTexel: IUniform<Vector2>;
    uRadius: IUniform<number>;
  };
};

export function createBloomUpMaterial(): BloomUpMaterial {
  return createPassMaterial('bloomUp', bloomUp, {
    tInput: { value: null },
    tBase: { value: null },
    uTexel: { value: new Vector2() },
    uRadius: { value: tuning.post.bloomRadius },
  }) as BloomUpMaterial;
}

export type CompositeMaterial = ShaderMaterial & {
  uniforms: {
    tScene: IUniform<Texture | null>;
    tBloom: IUniform<Texture | null>;
    uBloomStrength: IUniform<number>;
    uSelfBloom: IUniform<number>;
    uVignette: IUniform<number>;
    uVignetteRange: IUniform<Vector2>;
  };
};

export function createCompositeMaterial(): CompositeMaterial {
  return createPassMaterial('composite', composite, {
    tScene: { value: null },
    tBloom: { value: null },
    uBloomStrength: { value: tuning.post.bloomStrength },
    uSelfBloom: { value: tuning.post.selfBloom },
    uVignette: { value: tuning.post.vignette },
    uVignetteRange: { value: new Vector2(...tuning.post.vignetteRange) },
  }) as CompositeMaterial;
}
