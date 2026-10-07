import {
  BackSide,
  Color,
  CustomBlending,
  DoubleSide,
  LineBasicMaterial,
  Matrix3,
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
import { edge } from './shaders/edge';
import { glow } from './shaders/glow';
import { hyperDashes, hyperTube } from './shaders/hyperspace';
import { bloomDown, bloomUp, composite } from './shaders/post';
import { GLOW_COUNT, backdrop, stars } from './shaders/sky';
import { toonFlat } from './shaders/toonFlat';
import { THEME_KEYS, tokens, type ThemeKey } from './tokens';
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
 * flat, 2 glow) and whether it is a decal. core/geometry.ts names its attributes after these.
 */
export const UNLIT_ATTRIBUTE = 'aUnlit';
export const DECAL_ATTRIBUTE = 'aDecal';

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

// --- hyperspace (world/Hyperspace.ts) ----------------------------------------------------------------

export type HyperTubeMaterial = ShaderMaterial & {
  uniforms: {
    uAxis: IUniform<Vector3>;
    uOpen: IUniform<number>;
    uFlow: IUniform<number>;
    /** The ring: its angle off the course (rad), and its alpha (0: none). */
    uRing: IUniform<Vector2>;
    uBands: IUniform<number>;
    uEye: IUniform<number>;
    uWash: IUniform<Vector2>;
    uRibAlpha: IUniform<number>;
    uShade: IUniform<Color>;
    uLine: IUniform<Color>;
  };
};

/**
 * The walls of the tunnel (shaders/hyperspace.ts): paint over the sky that never blooms. The eye
 * is the deepest navy, the wash is deep space's own navy in EVERY family, and the ring is the
 * cream of the ink; the ribs are dressed by `wearHyperFamily`. `ribs`: the thin line at each
 * band's edge, left out on the low tier.
 *
 * Why the wash wears no family (looked at in the lab, all five, 2026-10-06): a wash in the
 * family's shade is a clean blue, green and purple for sky, mint and lilac, but over the navy sky
 * coral's goes brick and butter's goes khaki. One rule, no table per family: the walls are navy,
 * and the family is in the lines.
 */
export function createHyperTubeMaterial(options: { ribs: boolean }): HyperTubeMaterial {
  const look = tuning.hyper;
  const material = new ShaderMaterial({
    name: 'hyperTube',
    vertexShader: hyperTube.vertexShader,
    fragmentShader: hyperTube.fragmentShader,
    uniforms: {
      uAxis: { value: new Vector3(0, 0, 1) },
      uOpen: { value: 0 },
      uFlow: { value: 0 },
      uRing: { value: new Vector2() },
      uBands: { value: look.bands },
      uEye: { value: look.eyeRad },
      uRibs: { value: options.ribs ? 1 : 0 },
      uWash: { value: new Vector2(...look.wash) },
      uRibAlpha: { value: look.ribAlpha },
      uGround: { value: new Color(tokens.color.space[950]) },
      uShade: { value: new Color(tokens.color.space[700]) },
      uLine: { value: new Color(tokens.color.star.cool) },
      uInk: { value: new Color(tokens.color.ink.high) },
    },
    side: BackSide,
    transparent: true,
    depthWrite: false,
  });
  return keepBloomMask(material, false) as HyperTubeMaterial;
}

/**
 * Which tint a dash wears, as shares of all the dashes, in the order of `uTint`: the stars' own
 * white, cool and warm; the base of the family the jump is going to; and the bases of the four
 * other families, a few of each. Half of the dashes are starlight and half are colour, half of
 * that the destination's own: a jump reads as where it is going at a glance, and as the
 * galaxy's five pastels at a second one. (Allen's two references, 2026-10-06: white-violet
 * streaks, and dashes of many colours on a coloured field.)
 */
export const HYPER_TINT_SHARES = [0.3, 0.14, 0.08, 0.24, 0.06, 0.06, 0.06, 0.06] as const;
/** The first tint that is a family's colour: from here on a dash is dealt brighter (world/Hyperspace.ts). */
export const HYPER_FAMILY_TINT = 3;

export type HyperDashMaterial = ShaderMaterial & {
  uniforms: {
    uFrame: IUniform<Matrix3>;
    uFlow: IUniform<number>;
    uTwist: IUniform<number>;
    uStretch: IUniform<number>;
    uAlpha: IUniform<number>;
    uLength: IUniform<number>;
    uWidth: IUniform<number>;
    uPixel: IUniform<number>;
    uTint: IUniform<Color[]>;
  };
};

/** The dashes (shaders/hyperspace.ts): light that adds up, as the stars they stand over are. */
export function createHyperDashMaterial(): HyperDashMaterial {
  const { white, cool, warm } = tokens.color.star;
  const tints = HYPER_TINT_SHARES.map(() => new Color(white));
  tints[1]?.set(cool);
  tints[2]?.set(warm);
  dressDashes(tints, undefined);
  const material = new ShaderMaterial({
    name: 'hyperDashes',
    vertexShader: hyperDashes.vertexShader,
    fragmentShader: hyperDashes.fragmentShader,
    uniforms: {
      uFrame: { value: new Matrix3() },
      uFlow: { value: 0 },
      uTwist: { value: 0 },
      uStretch: { value: 0 },
      uAlpha: { value: 0 },
      uLength: { value: tuning.hyper.dashLength },
      uWidth: { value: 0 },
      uPixel: { value: 0 },
      uTint: { value: tints },
    },
    // A dash is a sliver of paper in the sky: whichever way round it lies, it shows.
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
  });
  return keepBloomMask(material, true) as HyperDashMaterial;
}

/**
 * The dashes' colours: the base of the family the jump is going to, then the bases of the other
 * families in the tokens' own order, as many as there are tints left. With no family the
 * destination's share is the stars' cool white, and the others are the first four families.
 */
function dressDashes(tints: readonly Color[], theme: ThemeKey | undefined): void {
  const families = tokens.color.system;
  tints[HYPER_FAMILY_TINT]?.set(
    theme === undefined ? tokens.color.star.cool : families[theme].base,
  );
  let slot = HYPER_FAMILY_TINT + 1;
  for (const key of THEME_KEYS) {
    if (key === theme) continue;
    tints[slot]?.set(families[key].base);
    slot += 1;
  }
}

/**
 * Dress a jump in the family of where it is going: the ribs of the tunnel in its base, and the
 * dashes with it in the lead (`dressDashes`). A body with no family (one of a system the manifest
 * does not list) gets the stars' cool white in both.
 */
export function wearHyperFamily(
  tube: HyperTubeMaterial,
  dashes: HyperDashMaterial,
  theme: ThemeKey | undefined,
): void {
  tube.uniforms.uLine.value.set(
    theme === undefined ? tokens.color.star.cool : tokens.color.system[theme].base,
  );
  dressDashes(dashes.uniforms.uTint.value, theme);
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
