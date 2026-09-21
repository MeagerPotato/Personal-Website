import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
} from 'three';
import type { System, Viewport } from '../core/Engine';
import { tokens } from '../design/tokens';
import { tuning } from '../design/tuning';
import { createRng, pickWeighted } from '../sim/rng';

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute float aTwinkle;
  attribute vec3 aColor;

  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uTwinkleDepth;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vColor = aColor;
    float wave = 0.5 + 0.5 * sin(uTime * (0.7 + aPhase * 1.3) + aPhase * 6.2831853);
    vAlpha = 1.0 - aTwinkle * uTwinkleDepth * wave;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio; // stars are "infinitely far": no size attenuation
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float disc = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5));
    gl_FragColor = vec4(vColor, disc * vAlpha);
    #include <colorspace_fragment>
  }
`;

export interface StarfieldOptions {
  coarsePointer: boolean;
  reducedMotion: boolean;
}

/**
 * The sky: one draw call of soft round points on a thick shell around the camera. Fully
 * deterministic (seeded), so the same sky appears on every visit and in every screenshot.
 */
export class Starfield implements System {
  readonly object: Points<BufferGeometry, ShaderMaterial>;
  private readonly drift: number;
  /** Shared by reference with the material, so writing `.value` here updates the GPU uniform. */
  private readonly uniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: 1 },
    uTwinkleDepth: { value: 0 },
  };

  constructor(options: StarfieldOptions) {
    const params = tuning.starfield;
    const count = options.coarsePointer ? params.countCoarse : params.count;
    const rng = createRng(params.seed);

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const twinkles = new Float32Array(count);

    // new Color(hex) converts sRGB -> linear working space; the shader converts back on output.
    const palette = params.palette.map(
      ([name, weight]) => [new Color(tokens.color.star[name]), weight] as const,
    );

    for (let i = 0; i < count; i += 1) {
      // Uniform direction on a sphere, then a radius within the shell.
      const y = rng() * 2 - 1;
      const azimuth = rng() * Math.PI * 2;
      const ring = Math.sqrt(1 - y * y);
      const radius = params.radiusMin + (params.radiusMax - params.radiusMin) * rng();
      positions[i * 3] = ring * Math.cos(azimuth) * radius;
      positions[i * 3 + 1] = y * radius;
      positions[i * 3 + 2] = ring * Math.sin(azimuth) * radius;

      const color = pickWeighted(rng, palette);
      const brightness = params.brightnessMin + (1 - params.brightnessMin) * rng();
      colors[i * 3] = color.r * brightness;
      colors[i * 3 + 1] = color.g * brightness;
      colors[i * 3 + 2] = color.b * brightness;

      sizes[i] = params.sizeMin + (params.sizeMax - params.sizeMin) * rng() ** 3;
      phases[i] = rng();
      twinkles[i] = rng() < params.twinkleShare ? 1 : 0;
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new Float32BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new Float32BufferAttribute(sizes, 1));
    geometry.setAttribute('aPhase', new Float32BufferAttribute(phases, 1));
    geometry.setAttribute('aTwinkle', new Float32BufferAttribute(twinkles, 1));

    this.uniforms.uTwinkleDepth.value = options.reducedMotion ? 0 : params.twinkleDepth;
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
    });

    this.object = new Points(geometry, material);
    this.object.frustumCulled = false; // the shell surrounds the camera: always visible
    this.drift = options.reducedMotion ? 0 : params.driftRadPerSec;
  }

  frameUpdate(elapsed: number, dt: number): void {
    this.uniforms.uTime.value = elapsed;
    this.object.rotation.y += this.drift * dt;
  }

  resize(viewport: Viewport): void {
    this.uniforms.uPixelRatio.value = viewport.pixelRatio;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.object.material.dispose();
  }
}
