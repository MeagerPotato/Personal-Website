import { BufferGeometry, Color, Float32BufferAttribute, Points } from 'three';
import type { Frame, System, Viewport } from '../core/Engine';
import { Scope } from '../core/scope';
import { createStarMaterial, type StarMaterial } from '../design/materials';
import { tokens } from '../design/tokens';
import { tuning } from '../design/tuning';
import { createRng, pickWeighted } from '../sim/rng';

export interface StarfieldOptions {
  coarsePointer: boolean;
  reducedMotion: boolean;
}

/**
 * The stars: one draw call of soft round points. Fully deterministic (seeded), so the same sky
 * appears on every visit and in every screenshot. A star is only a DIRECTION: the shader ignores
 * where the camera is (design/shaders/sky.ts), so no amount of flying brings one closer.
 */
export class Starfield implements System {
  readonly object: Points<BufferGeometry, StarMaterial>;
  private readonly scope = new Scope();
  private readonly drift: number;

  constructor(options: StarfieldOptions) {
    const params = tuning.starfield;
    const count = options.coarsePointer ? params.countCoarse : params.count;
    const rng = createRng(params.seed);

    const directions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const twinkles = new Float32Array(count);

    // new Color(hex) converts sRGB -> linear working space; the shader converts back on output.
    const palette = params.palette.map(
      ([name, weight]) => [new Color(tokens.color.star[name]), weight] as const,
    );

    for (let i = 0; i < count; i += 1) {
      // A uniform direction on the unit sphere.
      const y = rng() * 2 - 1;
      const azimuth = rng() * Math.PI * 2;
      const ring = Math.sqrt(1 - y * y);
      directions[i * 3] = ring * Math.cos(azimuth);
      directions[i * 3 + 1] = y;
      directions[i * 3 + 2] = ring * Math.sin(azimuth);

      const color = pickWeighted(rng, palette);
      const brightness = params.brightnessMin + (1 - params.brightnessMin) * rng();
      colors[i * 3] = color.r * brightness;
      colors[i * 3 + 1] = color.g * brightness;
      colors[i * 3 + 2] = color.b * brightness;

      sizes[i] = params.sizeMin + (params.sizeMax - params.sizeMin) * rng() ** 3;
      phases[i] = rng();
      twinkles[i] = rng() < params.twinkleShare ? 1 : 0;
    }

    const geometry = this.scope.track(new BufferGeometry());
    geometry.setAttribute('position', new Float32BufferAttribute(directions, 3));
    geometry.setAttribute('aColor', new Float32BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new Float32BufferAttribute(sizes, 1));
    geometry.setAttribute('aPhase', new Float32BufferAttribute(phases, 1));
    geometry.setAttribute('aTwinkle', new Float32BufferAttribute(twinkles, 1));

    const material = this.scope.track(createStarMaterial({ twinkle: !options.reducedMotion }));
    this.object = new Points(geometry, material);
    this.object.frustumCulled = false; // the sky surrounds the camera: always visible
    this.object.renderOrder = -1;
    this.scope.onDispose(() => this.object.removeFromParent());
    this.drift = options.reducedMotion ? 0 : params.driftRadPerSec;
  }

  frameUpdate(frame: Frame): void {
    this.object.material.uniforms.uTime.value = frame.elapsed;
    this.object.rotation.y += this.drift * frame.dt;
  }

  resize(viewport: Viewport): void {
    this.object.material.uniforms.uPixelRatio.value = viewport.pixelRatio;
  }

  dispose(): void {
    this.scope.dispose();
  }
}
