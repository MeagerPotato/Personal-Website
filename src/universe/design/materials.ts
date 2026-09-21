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
  ZeroFactor,
  type IUniform,
  type Material,
  type Texture,
} from 'three';
import { dust } from './shaders/dust';
import { glow } from './shaders/glow';
import { bloomDown, bloomUp, composite } from './shaders/post';
import { GLOW_COUNT, backdrop, stars } from './shaders/sky';
import { toonFlat } from './shaders/toonFlat';
import { tokens } from './tokens';
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

/** Re-read the look constants after tuning changed at run time (the dev panel). */
export function refreshToonLook(): void {
  toonLook.uBandEdges.value.set(...tuning.shading.bandEdges);
  toonLook.uMidLevel.value = tuning.shading.midLevel;
}

export interface ToonOptions {
  /** Multiply by the geometry's `color` attribute (per-facet colours). */
  vertexColors?: boolean;
  /** A token hex that multiplies everything. White when left out. */
  tint?: string;
  /** Each instance carries its own sun in an `aSunPosition` attribute. */
  instancedSun?: boolean;
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
    },
    vertexColors: options.vertexColors ?? false,
    defines: options.instancedSun ? { INSTANCED_SUN: '' } : {},
  });
  return material as ToonMaterial;
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
    uPixelRatio: IUniform<number>;
    uTwinkleDepth: IUniform<number>;
    uOpacity: IUniform<number>;
  };
};

export function createStarMaterial(options: { twinkle: boolean }): StarMaterial {
  const material = new ShaderMaterial({
    name: 'stars',
    vertexShader: stars.vertexShader,
    fragmentShader: stars.fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uTwinkleDepth: { value: options.twinkle ? tuning.starfield.twinkleDepth : 0 },
      uOpacity: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
  });
  return keepBloomMask(material, true) as StarMaterial;
}

export type DustMaterial = ShaderMaterial & {
  uniforms: {
    uCenter: IUniform<Vector3>;
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
    uVignette: IUniform<number>;
    uVignetteRange: IUniform<Vector2>;
  };
};

export function createCompositeMaterial(): CompositeMaterial {
  return createPassMaterial('composite', composite, {
    tScene: { value: null },
    tBloom: { value: null },
    uBloomStrength: { value: tuning.post.bloomStrength },
    uVignette: { value: tuning.post.vignette },
    uVignetteRange: { value: new Vector2(...tuning.post.vignetteRange) },
  }) as CompositeMaterial;
}
