import { Color, PerspectiveCamera, Scene, WebGLRenderer, type Camera, type Object3D } from 'three';
import { tokens } from '../design/tokens';
import { tuning } from '../design/tuning';
import { FixedClock } from './loop';
import { FrameGovernor } from './quality/governor';
import type { TierSettings } from './quality/tiers';
import { computePixelRatio } from './viewport';

export interface Viewport {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

/** What a system may know about the frame being drawn. One object, reused: do not keep it. */
export interface Frame {
  /** Seconds of rendering since the engine started; pauses and hidden tabs do not count. */
  readonly elapsed: number;
  /** Duration of this frame in seconds, clamped after a stall. For per-frame easing only. */
  readonly dt: number;
  /** Where the frame sits between the previous simulation state (0) and the current one (1). */
  readonly alpha: number;
  /** Simulation time of the current state, in seconds. */
  readonly simTime: number;
}

/**
 * Anything that lives in the loop. The split is the rule that keeps flight identical on every
 * display (docs/PLAN.md §5.5): SIMULATE in `fixedUpdate`, which always gets the same `dt`;
 * DRAW in `frameUpdate`, interpolating by `frame.alpha`. Whoever creates a GPU resource
 * disposes it, so `dispose` is mandatory.
 */
export interface System {
  fixedUpdate?(dt: number, simTime: number): void;
  frameUpdate?(frame: Frame): void;
  resize?(viewport: Viewport): void;
  dispose(): void;
}

/** Something that draws the scene in place of a plain `renderer.render` (fx/PostFX.ts). */
export interface RenderPipeline {
  /** Size of the drawing buffer, in real pixels. */
  resize(width: number, height: number): void;
  render(scene: Object3D, camera: Camera): void;
  dispose(): void;
}

export interface EngineOptions {
  mount: HTMLElement;
  /** Simulation steps already taken, when the engine is rebuilt from a snapshot (core/snapshot.ts). */
  startSteps?: number;
  /**
   * The quality tier's settings (core/quality/tiers.ts). They are fixed for the life of an
   * engine, because whether the canvas is anti-aliased is decided when its context is created.
   */
  quality: TierSettings;
  /** Builds the post-processing, on the tiers that have it. Injected: core/ does not know fx/. */
  pipeline?: (renderer: WebGLRenderer, samples: number) => RenderPipeline;
  /** A phone or a tablet: `(pointer: coarse)`. */
  coarsePointer: boolean;
  /** May the first seconds decide that this tier is too much? Not for a forced or the lowest tier. */
  canDemote: boolean;
  onFirstFrame(): void;
  /** The probe found the tier too heavy for this device. The owner rebuilds one tier down. */
  onDemote(): void;
  /**
   * The browser took the WebGL context away. The engine has stopped and is of no further use:
   * the owner takes a snapshot, disposes it, and builds a new one on a fresh canvas (api.ts).
   */
  onContextLost(): void;
}

/**
 * Owns the canvas, the renderer, and the frame loop; knows nothing about what is being drawn.
 * The engine creates its own <canvas>, and an engine whose context was lost is replaced whole,
 * canvas and all (api.ts), so nothing outside src/universe ever holds a reference to it.
 *
 * The loop: every animation frame runs zero or more fixed simulation steps (core/loop.ts), then
 * one frame update, then one render. It sleeps while the tab is hidden or the engine is paused,
 * and the time spent asleep never reaches the simulation.
 */
export class Engine {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;

  private readonly systems: System[] = [];
  private readonly resizeObserver: ResizeObserver;
  private readonly clock = new FixedClock({
    stepSec: 1 / tuning.loop.stepHz,
    maxFrameSec: tuning.loop.maxFrameSec,
    maxStepsPerFrame: tuning.loop.maxStepsPerFrame,
  });
  private readonly frame = { elapsed: 0, dt: 0, alpha: 0, simTime: 0 };
  private readonly pipeline: RenderPipeline | null;
  private readonly governor: FrameGovernor;
  /** Shortest time between two frames, in ms: the 30 fps cap of a tier. 0 = every display frame. */
  private readonly minFrameMs: number;
  private viewport: Viewport = { width: 1, height: 1, pixelRatio: 1 };
  private frameId = 0;
  private lastTime = 0;
  private started = false;
  private paused = false;
  private disposed = false;
  private hasRendered = false;

  constructor(private readonly options: EngineOptions) {
    const { quality } = options;
    this.clock.reset(options.startSteps ?? 0);
    this.canvas = document.createElement('canvas');
    options.mount.append(this.canvas);

    try {
      this.renderer = new WebGLRenderer({
        canvas: this.canvas,
        // With post-processing the anti-aliasing happens on its render target instead.
        antialias: !quality.post && quality.msaaSamples > 0,
        alpha: false,
        powerPreference: 'default',
        // A software renderer would "work" at 3 fps. Refuse it: the caller falls back to plain mode.
        failIfMajorPerformanceCaveat: true,
      });
    } catch (error) {
      this.canvas.remove();
      throw error;
    }

    // Colour policy (docs/PLAN.md §5.5): sRGB output and NO tone mapping (three's defaults), so
    // a colour in the scene is exactly the token hex and the 3D world matches the CSS. With
    // post-processing, alpha is the bloom guest list (design/shaders/post.ts), empty by default;
    // without it, alpha is what the page sees of the canvas, and must be 1.
    this.renderer.setClearColor(new Color(tokens.color.space[900]), quality.post ? 0 : 1);
    // A frame may be several render calls (post-processing); count them all, reset once a frame.
    this.renderer.info.autoReset = false;
    this.pipeline =
      quality.post && options.pipeline
        ? options.pipeline(this.renderer, quality.msaaSamples)
        : null;

    const maxFps = options.coarsePointer ? quality.maxFpsCoarse : 0;
    // A few ms of slack: display frames do not arrive on the dot, and being late costs a whole one.
    this.minFrameMs = maxFps > 0 ? 1000 / maxFps - 4 : 0;
    this.governor = new FrameGovernor(tuning.quality.governor, {
      targetFps: maxFps > 0 ? maxFps : 60,
      canDemote: options.canDemote,
    });

    const { fovDegrees, near, far } = tuning.camera;
    this.camera = new PerspectiveCamera(fovDegrees, 1, near, far);

    this.canvas.addEventListener('webglcontextlost', this.handleContextLost);
    document.addEventListener('visibilitychange', this.handleVisibility);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(options.mount);
  }

  /** Simulation steps taken so far: the one number that says where every planet is. */
  get steps(): number {
    return this.clock.steps;
  }

  /** Share of the full resolution being rendered: below 1 when the governor is saving frames. */
  get resolutionScale(): number {
    return this.governor.scale;
  }

  /** True once dispose() ran: late arrivals (a lazy chunk) must not add themselves any more. */
  get isDisposed(): boolean {
    return this.disposed;
  }

  add<T extends System>(system: T): T {
    this.systems.push(system);
    system.resize?.(this.viewport);
    return system;
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.resize();
    this.wake();
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) this.sleep();
    else this.wake();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sleep();
    this.resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    for (const system of this.systems.splice(0).reverse()) system.dispose();
    this.pipeline?.dispose();
    // Invariant 9, checked where it can be: whoever created a GPU resource has disposed it by now.
    const { geometries, textures } = this.renderer.info.memory;
    if (import.meta.env.DEV && geometries + textures > 0) {
      console.warn(`[engine] leaked ${geometries} geometries and ${textures} textures on dispose`);
    }
    this.renderer.dispose();
    // Browsers cap the number of live WebGL contexts; release ours now rather than at GC time.
    // (Unless the browser already took it, which is why we are here after a lost context.)
    if (!this.renderer.getContext().isContextLost()) this.renderer.forceContextLoss();
    this.canvas.remove();
  }

  // --- loop ------------------------------------------------------------------------------------

  private get shouldRun(): boolean {
    return this.started && !this.paused && !this.disposed && !document.hidden;
  }

  private wake(): void {
    if (!this.shouldRun || this.frameId !== 0) return;
    this.lastTime = performance.now();
    this.frameId = requestAnimationFrame(this.tick);
  }

  private sleep(): void {
    cancelAnimationFrame(this.frameId);
    this.frameId = 0;
  }

  private readonly tick = (now: number): void => {
    this.frameId = 0;
    if (!this.shouldRun) return;

    // A capped tier sits out the display frames that come too soon.
    const frameMs = now - this.lastTime;
    if (frameMs < this.minFrameMs) {
      this.frameId = requestAnimationFrame(this.tick);
      return;
    }
    const workStarted = performance.now();

    const slice = this.clock.advance(frameMs / 1000);
    this.lastTime = now;

    const stepSec = 1 / tuning.loop.stepHz;
    for (let step = slice.steps; step > 0; step -= 1) {
      const simTime = (this.clock.steps - step + 1) * stepSec;
      for (const system of this.systems) system.fixedUpdate?.(stepSec, simTime);
    }

    const frame = this.frame;
    frame.elapsed += slice.frameSec;
    frame.dt = slice.frameSec;
    frame.alpha = slice.alpha;
    frame.simTime = this.clock.simTime;
    for (const system of this.systems) system.frameUpdate?.(frame);
    this.draw();

    if (!this.hasRendered) {
      this.hasRendered = true;
      this.options.onFirstFrame();
    }

    const action = this.governor.frame(frameMs, performance.now() - workStarted);
    if (action?.kind === 'scale') {
      this.resize();
    } else if (action?.kind === 'demote') {
      // The owner disposes this engine from inside the callback: do not ask for another frame.
      this.options.onDemote();
      if (this.disposed) return;
    }

    this.frameId = requestAnimationFrame(this.tick);
  };

  private draw(): void {
    this.renderer.info.reset();
    if (this.pipeline) this.pipeline.render(this.scene, this.camera);
    else this.renderer.render(this.scene, this.camera);
  }

  // --- environment -----------------------------------------------------------------------------

  private resize(): void {
    if (this.disposed) return;
    const { clientWidth: width, clientHeight: height } = this.options.mount;
    if (width === 0 || height === 0) return;

    const { quality } = this.options;
    const { minPixelRatio } = tuning.quality;
    const full = computePixelRatio(width, height, window.devicePixelRatio, {
      maxPixelRatio: quality.maxPixelRatio,
      maxMegapixels: quality.maxMegapixels,
      minPixelRatio,
    });
    const pixelRatio = Math.max(minPixelRatio, full * this.governor.scale);

    this.viewport = { width, height, pixelRatio };
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false); // CSS owns the canvas's layout size
    this.pipeline?.resize(this.canvas.width, this.canvas.height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    for (const system of this.systems) system.resize?.(this.viewport);
    // Resizing clears the drawing buffer, and this frame's tick has already run: draw again now,
    // or every resize would flash one empty frame.
    if (this.hasRendered) this.draw();
  }

  private readonly handleVisibility = (): void => {
    if (document.hidden) this.sleep();
    else this.wake();
  };

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.sleep();
    if (!this.disposed) this.options.onContextLost();
  };
}
