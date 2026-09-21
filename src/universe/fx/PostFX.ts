import {
  BufferAttribute,
  BufferGeometry,
  Camera,
  LinearFilter,
  Mesh,
  SRGBColorSpace,
  WebGLRenderTarget,
  type Material,
  type Object3D,
  type WebGLRenderer,
} from 'three';
import { Scope } from '../core/scope';
import {
  createBloomDownMaterial,
  createBloomUpMaterial,
  createCompositeMaterial,
} from '../design/materials';
import { tuning } from '../design/tuning';

export interface PostParams {
  readonly bloomStrength: number;
  readonly bloomRadius: number;
  readonly bloomLevels: number;
  readonly vignette: number;
  readonly vignetteRange: readonly [from: number, to: number];
}

/** A bloom level smaller than this adds nothing but passes. */
const SMALLEST_LEVEL_PX = 8;

/**
 * WHAT HAPPENS TO THE FINISHED PICTURE, on the tiers that can afford it: the scene is drawn into
 * an anti-aliased render target instead of the canvas, the things that asked to glow are blurred
 * into a bloom, and one last pass puts scene, bloom, vignette and a grain of dither on the canvas.
 * The shaders and the reasoning live in design/shaders/post.ts.
 *
 * Everything is 8 bits per channel and sRGB-encoded by the GPU, which every WebGL2 device can
 * do; no float textures, no extensions. It is our own 3 KB and not a library, because the usual
 * one costs twenty times that and the whole engine has a download budget.
 */
export class PostFX {
  private readonly scope = new Scope();
  private readonly camera = new Camera();
  private readonly triangle: Mesh;
  private readonly scene: WebGLRenderTarget;
  private readonly downMasked = this.scope.track(createBloomDownMaterial({ masked: true }));
  private readonly down = this.scope.track(createBloomDownMaterial({ masked: false }));
  private readonly up = this.scope.track(createBloomUpMaterial());
  private readonly composite = this.scope.track(createCompositeMaterial());
  /** Halvings of the scene on the way down, and the same sizes on the way back up. */
  private downs: WebGLRenderTarget[] = [];
  private ups: WebGLRenderTarget[] = [];

  constructor(
    private readonly renderer: WebGLRenderer,
    samples: number,
  ) {
    // One triangle that covers the screen: cheaper than a quad, and no seam down the diagonal.
    const geometry = this.scope.track(new BufferGeometry());
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    );
    this.triangle = new Mesh(geometry, this.composite);
    this.triangle.frustumCulled = false;

    this.scene = this.scope.track(createTarget(1, 1, { samples, depth: true }));
  }

  /** `width` and `height` in drawing-buffer pixels. */
  resize(width: number, height: number): void {
    this.scene.setSize(width, height);

    for (const target of [...this.downs, ...this.ups]) target.dispose();
    this.downs = [];
    this.ups = [];
    let w = width;
    let h = height;
    for (let level = 0; level < tuning.post.bloomLevels; level += 1) {
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
      if (level > 0 && Math.min(w, h) < SMALLEST_LEVEL_PX) break;
      this.downs.push(createTarget(w, h));
      this.ups.push(createTarget(w, h));
    }
    // The smallest level is its own blur: nothing below it to mix in.
    this.ups.pop()?.dispose();
  }

  render(scene: Object3D, camera: Camera): void {
    const { renderer, downs, ups } = this;
    renderer.setRenderTarget(this.scene);
    renderer.render(scene, camera);

    // Down: the first halving reads the scene through its bloom guest list (the alpha channel).
    let source = this.scene;
    downs.forEach((target, level) => {
      const material = level === 0 ? this.downMasked : this.down;
      material.uniforms.tInput.value = source.texture;
      material.uniforms.uTexel.value.set(1 / source.width, 1 / source.height);
      this.pass(material, target);
      source = target;
    });

    // Up: each level is its own halving mixed with the blur of everything below it.
    this.up.uniforms.uRadius.value = tuning.post.bloomRadius;
    for (let level = ups.length - 1; level >= 0; level -= 1) {
      const target = ups[level];
      const base = downs[level];
      if (!target || !base) continue;
      this.up.uniforms.tInput.value = source.texture;
      this.up.uniforms.tBase.value = base.texture;
      this.up.uniforms.uTexel.value.set(1 / source.width, 1 / source.height);
      this.pass(this.up, target);
      source = target;
    }

    const { uniforms } = this.composite;
    uniforms.tScene.value = this.scene.texture;
    uniforms.tBloom.value = source.texture;
    uniforms.uBloomStrength.value = tuning.post.bloomStrength;
    uniforms.uVignette.value = tuning.post.vignette;
    uniforms.uVignetteRange.value.set(...tuning.post.vignetteRange);
    this.pass(this.composite, null);
  }

  dispose(): void {
    for (const target of [...this.downs, ...this.ups]) target.dispose();
    this.downs = [];
    this.ups = [];
    this.scope.dispose();
  }

  private pass(material: Material, target: WebGLRenderTarget | null): void {
    this.triangle.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.triangle, this.camera);
  }
}

function createTarget(
  width: number,
  height: number,
  options: { samples?: number; depth?: boolean } = {},
): WebGLRenderTarget {
  return new WebGLRenderTarget(width, height, {
    // Stored sRGB-encoded (the GPU converts both ways), so 8 bits are enough even for dark skies.
    colorSpace: SRGBColorSpace,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: false,
    depthBuffer: options.depth ?? false,
    samples: options.samples ?? 0,
  });
}
