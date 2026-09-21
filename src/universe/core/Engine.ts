import { Color, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { tokens } from '../design/tokens';
import { tuning } from '../design/tuning';
import { computePixelRatio } from './viewport';

export interface Viewport {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

/**
 * Anything that lives in the frame loop. Whoever creates a GPU resource disposes it, so
 * `dispose` is mandatory. (`fixedUpdate` and `setQuality` join this interface in Phase 1.)
 */
export interface System {
  frameUpdate?(elapsed: number, dt: number): void;
  resize?(viewport: Viewport): void;
  dispose(): void;
}

export interface EngineOptions {
  mount: HTMLElement;
  /** Static scene: render on demand instead of running a loop. */
  reducedMotion: boolean;
  onFirstFrame(): void;
  onContextLost(): void;
}

/** Longest step we will simulate after a stall (tab switch, GC pause), in seconds. */
const MAX_FRAME_DT = 0.1;

/**
 * Owns the canvas, the renderer, and the frame loop; knows nothing about what is being drawn.
 * The engine creates its own <canvas> (and will replace it on context loss from Phase 1), so
 * nothing outside src/universe ever holds a reference to it.
 *
 * Phase 0 loop: variable dt, clamped. Phase 1 swaps in the fixed 60 Hz simulation with render
 * interpolation (docs/PLAN.md §5.5) without changing this class's public surface.
 */
export class Engine {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;

  private readonly systems: System[] = [];
  private readonly resizeObserver: ResizeObserver;
  private viewport: Viewport = { width: 1, height: 1, pixelRatio: 1 };
  private frameId = 0;
  private lastTime = 0;
  private elapsed = 0;
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

    const dt = Math.min(Math.max((now - this.lastTime) / 1000, 0), MAX_FRAME_DT);
    this.lastTime = now;
    this.elapsed += dt;

    for (const system of this.systems) system.frameUpdate?.(this.elapsed, dt);
    this.renderer.render(this.scene, this.camera);

    if (!this.hasRendered) {
      this.hasRendered = true;
      this.options.onFirstFrame();
    }

    // Under reduced motion nothing moves, so one frame per change is all we need.
    if (!this.options.reducedMotion) this.frameId = requestAnimationFrame(this.tick);
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
    this.wake(); // no-op while looping; repaints the static frame under reduced motion
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
