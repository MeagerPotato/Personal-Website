import {
  BufferAttribute,
  BufferGeometry,
  Camera,
  LinearFilter,
  Mesh,
  RepeatWrapping,
  SRGBColorSpace,
  WebGLRenderTarget,
  type ShaderMaterial,
  type WebGLRenderer,
} from 'three';
import type { Frame, System } from '../core/Engine';
import { Scope } from '../core/scope';
import type { SkyTier } from '../design/lookTypes';
import { createSkyBakeMaterial, setSky } from '../design/materials';
import { tuning } from '../design/tuning';
import { bandCount, createSkySchedule, type SkySchedule } from '../sim/skySchedule';

/** `baking`: on its way (today's glows are the sky). `ready`: painted. `off`: it cannot be. */
export type SkyState = 'baking' | 'ready' | 'off';

export interface SkyBakeOptions {
  renderer: WebGLRenderer;
  /** What this quality tier paints: the panorama's size, and which layers (tuning.look.sky.tiers). */
  tier: SkyTier;
  /**
   * The visitor has seen the sky already (an engine rebuilt after a lost context): it is painted
   * two bands a frame, and shown with a cut instead of a fade.
   */
  seen: boolean;
  reducedMotion: boolean;
  /** Told with a frame, like everything the engine reports: first `baking`, then how it ended. */
  onState(state: SkyState): void;
  /** A band was painted in this frame: not a frame to judge the device by (core/Engine.ts). */
  onBand(): void;
}

/**
 * THE BAKED SKY: gas cliffs under each system, a Milky Way, far galaxies (design/shaders/skyBake.ts
 * says what is in it). It is painted ONCE into a panorama, after the first frame, and from then on
 * the backdrop and the stars only read it (design/shaders/sky.ts): a texture fetch a pixel, the
 * same picture on every frame and every visit.
 *
 * The first frame is never held up: the program that paints it compiles in the background
 * (seconds, on Direct3D), and the panorama is then drawn a band of rows a frame
 * (sim/skySchedule.ts). Until it is whole the sky is the navy and the old glows; then it comes in
 * over them (a cut under reduced motion, and for a visitor who has seen it). Where it cannot be
 * painted at all the old sky simply stays (`off`).
 *
 * Nothing here is state: the panorama follows from the tuning and the tokens, so an engine
 * rebuilt from a snapshot paints the same one. The snapshot only carries "seen".
 */
export class SkyBake implements System {
  private readonly scope = new Scope();
  private readonly camera = new Camera();
  private readonly target: WebGLRenderTarget;
  private readonly triangle: Mesh<BufferGeometry, ShaderMaterial>;
  /** The bands still to paint, once the program is there; null while there is nothing to paint. */
  private schedule: SkySchedule | null = null;
  private band = 0;
  /** Counts the paintings, so that a program that arrives for an older one is left alone. */
  private run = 0;
  private state: SkyState = 'baking';
  private told: SkyState | null = null;
  private reveal = 0;
  /** How much of the sky's light the view wants (docked, the star map), and how much it has. */
  private want = 1;
  private exposure = 1;

  constructor(private readonly options: SkyBakeOptions) {
    const { panoWidth, panoHeight } = options.tier;
    // The added light is stored sRGB-encoded (the GPU converts both ways), so 8 bits are enough
    // for a dark sky; no mipmaps, so the seam in azimuth cannot pick a wrong level.
    this.target = this.scope.track(
      new WebGLRenderTarget(panoWidth, panoHeight, {
        colorSpace: SRGBColorSpace,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        wrapS: RepeatWrapping,
        generateMipmaps: false,
        depthBuffer: false,
      }),
    );
    this.target.scissorTest = true;
    const geometry = this.scope.track(new BufferGeometry());
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    );
    this.triangle = new Mesh(geometry, createSkyBakeMaterial(options.tier));
    this.triangle.frustumCulled = false;
    this.scope.onDispose(() => {
      this.triangle.material.dispose();
      setSky(null, 0, 0);
    });
    this.paint();
  }

  /** Has the visitor seen the baked sky? What a snapshot keeps of it (core/snapshot.ts). */
  get seen(): boolean {
    return this.state === 'ready';
  }

  /** The panorama itself, for whoever measures it (the lab). */
  get pano(): WebGLRenderTarget {
    return this.target;
  }

  /**
   * Start painting the panorama from the numbers as they are now. Once at the start; again from
   * the lab and the tweak panel, after a slider moved (`repaint`: with a new program).
   */
  paint(repaint = false): void {
    const { renderer, tier } = this.options;
    const run = (this.run += 1);
    this.schedule = null;
    this.band = 0;
    // A strength of 0 switches the whole pass off: no program, no panorama.
    if (!(tuning.look.sky.intensity > 0)) {
      this.fail();
      return;
    }
    try {
      if (repaint) {
        this.triangle.material.dispose();
        this.triangle.material = createSkyBakeMaterial(tier);
      }
      // A program is compiled for where it draws: say so, or the first band compiles it again.
      renderer.setRenderTarget(this.target);
      const compiled = renderer.compileAsync(this.triangle, this.camera);
      renderer.setRenderTarget(null);
      compiled.then(
        () => {
          if (run !== this.run || this.scope.disposed) return;
          const { panoHeight, bandRows } = tier;
          const { bandSlowMs } = tuning.look.sky;
          this.schedule = createSkySchedule(
            bandCount(panoHeight, bandRows),
            bandSlowMs,
            this.options.seen,
          );
        },
        () => this.fail(),
      );
    } catch {
      renderer.setRenderTarget(null);
      this.fail();
    }
  }

  /** What the view is doing: the sky is quieter while docked, and quieter still on the star map. */
  setView(docked: boolean, calm: number): void {
    const { exposureDocked, exposureMap } = tuning.look.sky;
    this.want = (docked ? exposureDocked : 1) * (1 + (exposureMap - 1) * calm);
  }

  frameUpdate(frame: Frame): void {
    const { renderer, tier, reducedMotion, seen } = this.options;
    const look = tuning.look.sky;
    const count = this.schedule?.next(frame.dt * 1000) ?? 0;
    if (count > 0) {
      this.target.scissor.set(0, this.band * tier.bandRows, tier.panoWidth, count * tier.bandRows);
      renderer.setRenderTarget(this.target);
      renderer.render(this.triangle, this.camera);
      renderer.setRenderTarget(null);
      this.band += count;
      this.options.onBand();
      // A program that did not link has drawn nothing: three says so once it has been used.
      const used = renderer.properties.get(this.triangle.material) as {
        currentProgram?: { diagnostics?: { runnable: boolean } };
      };
      if (used.currentProgram?.diagnostics?.runnable === false) this.fail();
    }
    if (this.schedule?.left === 0) {
      this.schedule = null;
      // (A repaint leaves a sky that is showing as it is.)
      if (this.state !== 'ready') {
        this.state = 'ready';
        this.reveal = seen || reducedMotion ? 1 : 0;
        this.exposure = this.want;
      }
    }
    if (this.state === 'ready') {
      this.reveal = Math.min(1, this.reveal + frame.dt / look.revealSec);
      const ease = reducedMotion ? 1 : 1 - Math.exp(-look.exposureOmega * frame.dt);
      this.exposure += (this.want - this.exposure) * ease;
      const shown = this.reveal * this.reveal * (3 - 2 * this.reveal);
      setSky(this.target.texture, shown, shown * this.exposure);
    }
    if (this.told !== this.state) this.options.onState((this.told = this.state));
  }

  dispose(): void {
    this.scope.dispose();
  }

  /** The sky cannot be painted here: the old one stays, and nothing else notices. */
  private fail(): void {
    if (this.scope.disposed) return;
    this.schedule = null;
    this.state = 'off';
    setSky(null, 0, 0);
    if (import.meta.env.DEV) console.warn('[sky] the baked sky is off: the old glows stay');
  }
}
