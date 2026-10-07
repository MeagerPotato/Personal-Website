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
  Vector4,
  ZeroFactor,
  type IUniform,
  type Material,
  type Texture,
} from 'three';
import { hexToLinear } from '../sim/color';
import { sunLadder } from '../sim/sunSurface';
import {
  AIR_MASK_STOPS,
  AIR_RIM_STOPS,
  AIR_RINGS,
  CLOUD_OCTAVES,
  airCloud,
  airShell,
} from './shaders/air';
import { chart, chartDiscs, chartDots, chartRings } from './shaders/chart';
import { corona } from './shaders/corona';
import { dust } from './shaders/dust';
import { edge } from './shaders/edge';
import { glow } from './shaders/glow';
import { hyperDashes, hyperTube } from './shaders/hyperspace';
import { bloomDown, bloomUp, composite } from './shaders/post';
import type { RimTone, StarClass, SunTone } from './lookTypes';
import { backdrop, stars } from './shaders/sky';
import { skyBake } from './shaders/skyBake';
import { skyBand, skyConstants, skyLoops, skyStars } from './skyRecipe';
import { AIR_LIMB_STEPS, SUN_SPOTS, toonFlat } from './shaders/toonFlat';
import { traffic } from './shaders/traffic';
import { THEME_KEYS, tokens, type AirKey, type BiomeKey, type ThemeKey } from './tokens';
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
 * Does the picture go straight to the canvas (no post-processing)? Then what a material writes
 * is display space, and so is what it blends with: paint laid over paint there needs no sums of
 * its own (the chart: shaders/chart.ts).
 */
export function drawsToCanvas(): boolean {
  return bloomMask.value < 0.5;
}

/**
 * THE BAKED SKY, as everything that draws the sky reads it (shaders/sky.ts): the panorama, how
 * far it has come in (the stars: how much its dark lane dims them) and how much of its light
 * shows (the backdrop). Shared BY REFERENCE between the backdrop and the stars; world/SkyBake.ts
 * is the one that writes them.
 */
const skyLight = {
  uPano: { value: null as Texture | null },
  uReveal: { value: 0 },
  uExposure: { value: 0 },
};

/**
 * Show a baked sky: its panorama (null: none, and the sky is the navy and the stars), `reveal`
 * 0 to 1 as it comes in, and `exposure`, how much of its added light shows.
 */
export function setSky(pano: Texture | null, reveal: number, exposure: number): void {
  skyLight.uPano.value = pano;
  skyLight.uReveal.value = pano ? reveal : 0;
  skyLight.uExposure.value = pano ? exposure : 0;
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
  /**
   * A world with air's own material (shaders/toonFlat.ts, AIR): which air, and where the world's
   * centre is. `center` is READ every frame and never copied: hand over the very vector that
   * moves with the world.
   */
  air?: { key: AirKey; center: Vector3 };
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
      ...(options.air ? airUniforms(options.air.key, options.air.center) : {}),
    },
    vertexColors: options.vertexColors ?? false,
    defines: {
      ...(options.instancedSun ? { INSTANCED_SUN: '' } : {}),
      ...(options.sun ? { SUN: '' } : {}),
      ...(options.air ? { AIR: '' } : {}),
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

/**
 * The multipliers of a world with air's middle and shade bands (linear): the dusk (as much of it
 * as `bands.duskShare` says: the rest is the colour as lit) and the night.
 */
export function airBands(): { uDusk: IUniform<Color>; uNight: IUniform<Color> } {
  const { shading, star } = tokens.color;
  const { dusk, night, duskShare } = tuning.look.air.bands;
  return {
    uDusk: {
      value: new Color(star.white).lerp(new Color(shading.dusk).multiplyScalar(dusk), duskShare),
    },
    uNight: { value: new Color(shading.night).multiplyScalar(night) },
  };
}

/** A world's air as the toon shader's uniforms (shaders/toonFlat.ts, AIR): `tuning.look.air`. */
function airUniforms(key: AirKey, center: Vector3): Record<string, IUniform> {
  const { limb, windows } = tuning.look.air;
  if (limb.steps > AIR_LIMB_STEPS)
    throw new RangeError(`a limb has at most ${AIR_LIMB_STEPS} levels`);
  return {
    uAirCenter: { value: center },
    uAir: { value: new Color(tokens.color.air[key]) },
    ...airBands(),
    uAirLimb: { value: new Vector4(limb.power, limb.lit, limb.always, limb.steps) },
    uAirLit: { value: new Vector4(...limb.litEdges, ...limb.topRadii) },
    uLampNight: { value: windows.night },
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

/** The sky behind everything (shaders/sky.ts): the navy, and the baked sky's light on it. */
export function createBackdropMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'backdrop',
    vertexShader: backdrop.vertexShader,
    fragmentShader: backdrop.fragmentShader,
    uniforms: {
      uBloomMask: bloomMask,
      uDeep: { value: new Color(tokens.color.space[950]) },
      uHorizon: { value: new Color(tokens.color.space[800]) },
      uHorizonFalloff: { value: tuning.backdrop.horizonFalloff },
      uPano: skyLight.uPano,
      uExposure: skyLight.uExposure,
    },
    side: BackSide,
    depthWrite: false,
  });
}

/**
 * The program that paints the sky's panorama (shaders/skyBake.ts), the same on every quality
 * tier: the recipe of `tuning.look.sky` as its constants (skyRecipe.ts), the Milky Way's haze
 * and the star tints as linear colours. It is drawn into a render target, never onto the screen.
 */
export function createSkyBakeMaterial(): ShaderMaterial {
  const { space } = tokens.color;
  return new ShaderMaterial({
    name: 'sky-bake',
    vertexShader: skyBake.vertexShader,
    fragmentShader: skyBake.fragmentShader(skyConstants()),
    uniforms: {
      uDeep: { value: hexToLinear(space[950]) },
      uHorizon: { value: hexToLinear(space[800]) },
      uFalloff: { value: tuning.backdrop.horizonFalloff },
      uBand: { value: skyBand() },
      uStar: { value: skyStars() },
      uLoop: { value: skyLoops() },
    },
    depthTest: false,
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
          // A mid star's six spikes, and no line across (whose length the shader still divides by).
          ...kinds.map((kind) => {
            const length = kind.spikeLenPx ?? 1;
            return new Vector4(length, kind.spikeGain ?? 0, length, 0);
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
          // A hero's faint line across is as thin as a mid star's spikes.
          new Vector2(hero.spikeThicknessPx, classes.mid.spikeThicknessPx),
        ],
      },
      uProfile: { value: new Vector2(spike.exponent, spike.taper) },
      uBloomMask: bloomMask,
      uUnder: { value: new Color(tokens.color.space[900]) },
      uPano: skyLight.uPano,
      uReveal: skyLight.uReveal,
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

export type AirShellMaterial = ShaderMaterial & { uniforms: { uCalm: IUniform<number> } };

/** A colour of the hairline as the shell's shader counts them. */
const RIM_TONE: Record<RimTone, number> = { air: 0, airLight: 1, dusk: 2 };

/**
 * The air round the worlds that have it (shaders/air.ts, the shell): `tuning.look.air.shell` and
 * `rim` laid out as the shader's tables. `low`: the low tier keeps fewer rings. Premultiplied
 * colour over what is behind it, and not on the bloom guest list. The tables are as long as the
 * shader's: materials.test.ts holds them equal.
 */
export function createAirShellMaterial(options: { low: boolean }): AirShellMaterial {
  const { shell, rim } = tuning.look.air;
  if (
    shell.rings.length !== AIR_RINGS ||
    shell.mask.length !== AIR_MASK_STOPS ||
    rim.stops.length !== AIR_RIM_STOPS
  ) {
    throw new RangeError('air: the shell’s tables are not the size its shader loops over');
  }
  const material = new ShaderMaterial({
    name: 'air-shell',
    vertexShader: airShell.vertexShader,
    fragmentShader: airShell.fragmentShader,
    uniforms: {
      uCalm: { value: 0 },
      uBloomMask: bloomMask,
      // Display space: the parts are laid over each other as paint is.
      uUnder: { value: new Color(tokens.color.space[900]).convertLinearToSRGB() },
      uDusk: { value: new Color(tokens.color.shading.dusk).convertLinearToSRGB() },
      uReach: { value: new Vector2(shell.half, shell.pull) },
      uRings: { value: shell.rings.map((ring) => new Vector3(...ring)) },
      uRingCount: { value: options.low ? shell.lowRings : shell.rings.length },
      uMask: { value: shell.mask.map((stop) => new Vector2(...stop)) },
      uRim: { value: new Vector3(rim.radius, rim.widthPx, rim.widthR) },
      uRimStops: {
        value: rim.stops.map(([deg, tone, alpha]) => new Vector3(deg, RIM_TONE[tone], alpha)),
      },
      uRimMix: { value: new Vector2(rim.whiten, rim.duskAir) },
    },
    transparent: true,
    depthWrite: false,
  });
  keepBloomMask(material, false);
  material.blendSrc = OneFactor;
  return material as AirShellMaterial;
}

export type CloudMaterial = ShaderMaterial & {
  uniforms: { uTime: IUniform<number>; uCalm: IUniform<number> };
};

/**
 * The clouds of the worlds that have them (shaders/air.ts, the clouds): `tuning.look.air.cloud`
 * as the shader reads it. `motion`: do they drift? (Not under reduced motion.) Paint over what
 * is behind it, and not on the bloom guest list.
 */
export function createCloudMaterial(options: { motion: boolean }): CloudMaterial {
  const { cloud } = tuning.look.air;
  if (cloud.octaves > CLOUD_OCTAVES)
    throw new RangeError(`clouds: at most ${CLOUD_OCTAVES} octaves`);
  const material = new ShaderMaterial({
    name: 'air-cloud',
    vertexShader: airCloud.vertexShader,
    fragmentShader: airCloud.fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uCalm: { value: 0 },
      uSkin: { value: new Vector2(cloud.skin, options.motion ? cloud.driftRadPerSec : 0) },
      uField: {
        value: new Vector4(cloud.noiseWeight, cloud.bandWeight, cloud.bandFreq, cloud.core),
      },
      uFreq: { value: new Vector3(...cloud.freq) },
      uOctaves: { value: cloud.octaves },
      uSoft: { value: cloud.softness },
      uAlpha: { value: new Vector2(...cloud.alpha) },
      ...airBands(),
      uBandEdges: toonLook.uBandEdges,
    },
    transparent: true,
    depthWrite: false,
  });
  return keepBloomMask(material, false) as CloudMaterial;
}

/** A cloud's lit colour (linear): its world's peak, toned down and mixed a little toward its air. */
export function cloudColor(air: AirKey, peak: BiomeKey): Color {
  const { tone, mix } = tuning.look.air.cloud;
  return new Color(tokens.color.biome[peak].peak)
    .lerp(new Color(tokens.color.air[air]), mix)
    .multiplyScalar(tone);
}

/** A world's air in display space, as the shell's shader lays it over the sky. */
export function airColor(air: AirKey): Color {
  return new Color(tokens.color.air[air]).convertLinearToSRGB();
}

export type TrafficMaterial = ShaderMaterial & { uniforms: { uView: IUniform<Vector3> } };

/**
 * The dots on the orbit lines (shaders/traffic.ts): `tuning.look.traffic`. Paint over what is
 * behind it, and not on the bloom guest list.
 */
export function createTrafficMaterial(): TrafficMaterial {
  const material = new ShaderMaterial({
    name: 'traffic',
    vertexShader: traffic.vertexShader,
    fragmentShader: traffic.fragmentShader,
    uniforms: {
      uView: { value: new Vector3(1, 1, 1) },
      uOpacity: { value: tuning.look.traffic.opacity },
    },
    transparent: true,
    depthWrite: false,
  });
  return keepBloomMask(material, false) as TrafficMaterial;
}

/** A dot of traffic's colour (linear): its family's light. */
export function trafficColor(family: ThemeKey): Color {
  return new Color(tokens.color.system[family].light);
}

/** A system as the chart draws its district: where it is, how far it reaches, and its family. */
export interface ChartDistrict {
  readonly x: number;
  readonly z: number;
  /** The reach of its outermost docking orbit (u). */
  readonly radius: number;
  readonly family: ThemeKey;
}

/**
 * What world/Chart.ts sets every frame: how much of the picture is the map's, the map's scale,
 * and the dot grid's spacing at that scale (sim/chartMesh.ts, gridCell).
 */
export type ChartMaterial = ShaderMaterial & {
  uniforms: {
    uWeight: IUniform<number>;
    uUnitsPerPx: IUniform<number>;
    uCell: IUniform<number>;
  };
};

/** The chart's paint is laid in display space: a token as the screen shows it. */
const chartPaint = (hex: string): Color => new Color(hex).convertLinearToSRGB();

/**
 * A district's three paints (display space): its family's two dim tones (color.nebula) for the
 * disc out past its reach and the disc at its reach, and its base for the dashed ring.
 */
export function chartPaints(family: ThemeKey): { outer: Color; inner: Color; ring: Color } {
  const { nebula, system } = tokens.color;
  return {
    outer: chartPaint(nebula[family].mid),
    inner: chartPaint(nebula[family].lit),
    ring: chartPaint(system[family].base),
  };
}

/** `tuning.look.chart` as the chart's programs read it (shaders/chart.ts). */
function chartLook(): Record<'uDot' | 'uGrid' | 'uDistrict' | 'uDash', IUniform> {
  const look = tuning.look.chart;
  return {
    uDot: { value: chartPaint(tokens.color.ink.low) },
    uGrid: { value: new Vector3(look.dotSpacingPx, look.dotRadiusPx, look.dotAlpha) },
    uDistrict: {
      value: new Vector4(
        look.districtOuter,
        look.districtOuterAlpha,
        look.districtInnerAlpha,
        look.ringAlpha,
      ),
    },
    uDash: { value: new Vector3(look.ringWidthPx, ...look.ringDashPx) },
  };
}

/** Premultiplied paint over what is behind it, which leaves alpha as it found it. */
function chartBlend<T extends Material>(material: T): T {
  keepBloomMask(material, false);
  material.blendSrc = OneFactor;
  return material;
}

/**
 * The star map's ground WITH POST-PROCESSING (shaders/chart.ts, `chart`): one program that lays
 * the dots and a district for each system over each other in display space, and writes the sum
 * for a picture of linear light. Premultiplied colour over what is behind it, and not on the
 * bloom guest list. Straight to the canvas the chart is `createChartParts`.
 */
export function createChartMaterial(districts: readonly ChartDistrict[]): ChartMaterial {
  const { space } = tokens.color;
  // A shader cannot loop over nothing: with no system at all, one district nobody can see.
  const shown: readonly ChartDistrict[] =
    districts.length > 0 ? districts : [{ x: 0, z: 0, radius: 0, family: 'butter' }];
  const paints = shown.map(({ family }) => chartPaints(family));
  const material = new ShaderMaterial({
    name: 'chart',
    vertexShader: chart.vertexShader,
    fragmentShader: chart.fragmentShader,
    defines: { DISTRICTS: shown.length },
    uniforms: {
      uWeight: { value: 0 },
      uUnitsPerPx: { value: 1 },
      uCell: { value: 1 },
      // The sky as the map's camera sees it, straight down (shaders/sky.ts, the backdrop).
      uUnder: {
        value: new Color(space[950])
          .lerp(new Color(space[800]), Math.exp(-tuning.backdrop.horizonFalloff))
          .convertLinearToSRGB(),
      },
      ...chartLook(),
      uDisc: { value: shown.map(({ x, z, radius }) => new Vector3(x, z, radius)) },
      uOuter: { value: paints.map(({ outer }) => outer) },
      uInner: { value: paints.map(({ inner }) => inner) },
      uRing: { value: paints.map(({ ring }) => ring) },
    },
    transparent: true,
    depthWrite: false,
  });
  return chartBlend(material) as ChartMaterial;
}

/**
 * The room round a part of the chart, CSS px: its mesh reaches this far past the part itself
 * (sim/chartMesh.ts). Half a pixel is the part's own soft edge; the rest is a pixel of the
 * PICTURE, of which any corner may be what an anti-aliased edge samples, and which is two CSS
 * px wide once the frame governor has halved the resolution (tuning.quality.minPixelRatio).
 */
export const CHART_ROOM_PX = 4;

/** The chart's three parts where the picture goes straight to the canvas. */
export interface ChartParts {
  /** On the plane. Its uWeight and uUnitsPerPx are the other two's as well, by reference. */
  readonly dots: ChartMaterial;
  /** On sim/chartMesh.ts's polygons (`discMesh`), with aDisc, aOuter and aInner a vertex. */
  readonly discs: ShaderMaterial;
  /** On its strips (`ringMesh`), with aDisc and aRing a vertex. */
  readonly rings: ShaderMaterial;
}

/**
 * The star map's ground STRAIGHT TO THE CANVAS (shaders/chart.ts): a program for each part,
 * drawn in this order on a mesh that holds only that part, and the canvas's own blending lays
 * one over the next. Premultiplied paint in display space; alpha is left as it was found (on
 * this tier it is what the page sees of the canvas).
 */
export function createChartParts(): ChartParts {
  const look = chartLook();
  // One of each for all three: whoever sets the dots' sets the others'.
  const shared = { uWeight: { value: 0 }, uUnitsPerPx: { value: 1 } };
  const part = (
    name: string,
    shader: { vertexShader: string; fragmentShader: string },
    uniforms: Record<string, IUniform>,
  ): ShaderMaterial =>
    chartBlend(
      new ShaderMaterial({
        name,
        vertexShader: shader.vertexShader,
        fragmentShader: shader.fragmentShader,
        uniforms: { ...shared, ...uniforms },
        transparent: true,
        depthWrite: false,
      }),
    );
  return {
    dots: part('chart-dots', chartDots, {
      uCell: { value: 1 },
      uDot: look.uDot,
      uGrid: look.uGrid,
    }) as ChartMaterial,
    discs: part('chart-discs', chartDiscs, {
      uDistrict: look.uDistrict,
      uRoom: { value: CHART_ROOM_PX },
    }),
    rings: part('chart-rings', chartRings, {
      uDistrict: look.uDistrict,
      uDash: look.uDash,
      // A ring is as wide as its line, half of it to either side.
      uRoom: { value: CHART_ROOM_PX + 0.5 * tuning.look.chart.ringWidthPx },
    }),
  };
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
