import { Color, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { tokens } from '../design/tokens';
import { tuning } from '../design/tuning';
import { FixedClock } from './loop';
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
 * disposes it, so `dispose` is mandatory. (`setQuality` joins with the quality tiers.)
 */
export interface System {
  fixedUpdate?(dt: number, simTime: number): void;
  frameUpdate?(frame: Frame): void;
  resize?(viewport: Viewport): void;
  dispose(): void;
}

export interface EngineOptions {
  mount: HTMLElement;
  onFirstFrame(): void;
  onContextLost(): void;
}

/**
 * Owns the canvas, the renderer, and the frame loop; knows nothing about what is being drawn.
 * The engine creates its own <canvas> (and will replace it on context loss from Phase 1), so
 * nothing outside src/universe ever holds a reference to it.
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
  private viewport: Viewport = { width: 1, height: 1, pixelRatio: 1 };
  private frameId = 0;
  private lastTime = 0;
  private started = false;
  private paused = false;
  private disposed = false;
  private hasRendered = false;

  constructor(private readonly options: EngineOptions) {
    this.canvas = document.createElement('canvas');
    options.mount.append(this.canvas);

    try {
      this.renderer = new WebGLRenderer({
        canvas: this.canvas,
        antialias: false,
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
    // a colour in the scene is exactly the token hex and the 3D world matches the CSS.
    this.renderer.setClearColor(new Color(tokens.color.space[900]), 1);

    const { fovDegrees, near, far } = tuning.camera;
    this.camera = new PerspectiveCamera(fovDegrees, 1, near, far);

    this.canvas.addEventListener('webglcontextlost', this.handleContextLost);
    document.addEventListener('visibilitychange', this.handleVisibility);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(options.mount);
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
    this.renderer.dispose();
    // Browsers cap the number of live WebGL contexts; release ours now rather than at GC time.
    this.renderer.forceContextLoss();
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

    const slice = this.clock.advance((now - this.lastTime) / 1000);
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
    this.renderer.render(this.scene, this.camera);

    if (!this.hasRendered) {
      this.hasRendered = true;
      this.options.onFirstFrame();
    }

    this.frameId = requestAnimationFrame(this.tick);
  };

  // --- environment -----------------------------------------------------------------------------

  private resize(): void {
    if (this.disposed) return;
    const { clientWidth: width, clientHeight: height } = this.options.mount;
    if (width === 0 || height === 0) return;

    const limits = tuning.viewport;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const pixelRatio = computePixelRatio(width, height, window.devicePixelRatio, {
      maxPixelRatio: coarse ? limits.maxPixelRatioCoarse : limits.maxPixelRatio,
      maxMegapixels: limits.maxMegapixels,
      minPixelRatio: limits.minPixelRatio,
    });

    this.viewport = { width, height, pixelRatio };
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false); // CSS owns the canvas's layout size
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    for (const system of this.systems) system.resize?.(this.viewport);
    // Resizing clears the drawing buffer, and this frame's tick has already run: draw again now,
    // or every resize would flash one empty frame.
    if (this.hasRendered) this.renderer.render(this.scene, this.camera);
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
