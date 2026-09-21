import {
  AdditiveBlending,
  BackSide,
  Color,
  ShaderMaterial,
  Vector2,
  Vector3,
  type IUniform,
} from 'three';
import { dust } from './shaders/dust';
import { glow } from './shaders/glow';
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
      uSunPosition: { value: KEY_LIGHT_POSITION.clone() },
      uTint: { value: new Color(options.tint ?? tokens.color.star.white) },
    },
    vertexColors: options.vertexColors ?? false,
    defines: options.instancedSun ? { INSTANCED_SUN: '' } : {},
  });
  return material as ToonMaterial;
}

export type GlowMaterial = ShaderMaterial & { uniforms: { uIntensity: IUniform<number> } };

/** For things that are light themselves (shaders/glow.ts). Colours come from the geometry. */
export function createGlowMaterial(options: { intensity: number }): GlowMaterial {
  const material = new ShaderMaterial({
    name: 'glow',
    vertexShader: glow.vertexShader,
    fragmentShader: glow.fragmentShader,
    uniforms: { uIntensity: { value: options.intensity } },
    vertexColors: true,
  });
  return material as GlowMaterial;
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
    blending: AdditiveBlending,
  });
  return material as StarMaterial;
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
    blending: AdditiveBlending,
  });
  return material as DustMaterial;
}
