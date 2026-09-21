import type { WebGLRenderer } from 'three';
import { tuning } from '../../design/tuning';
import type { Frame, System, Viewport } from '../Engine';

const REFRESH_SEC = 0.5;

/**
 * A few numbers in a corner: is it smooth, and what does a frame cost? It ships in EVERY build,
 * behind `?perf`, because the device that matters is a phone on a preview URL, where there are no
 * developer tools. About 1 KiB; when it is off it does not exist.
 *
 *   fps    frames per second, over the last half second
 *   ms     average frame time, and the worst single frame
 *   steps  simulation steps per frame (1.0 on a 60 Hz display, 0.4 at 144 Hz, 2.0 at 30 fps)
 *   draws  draw calls and triangles of the last frame
 *   px     size of the drawing buffer, and the pixel ratio that produced it
 */
export class PerfHud implements System {
  private readonly element: HTMLElement;
  private frames = 0;
  private seconds = 0;
  private worst = 0;
  private steps = 0;
  private lastSimTime = 0;
  private viewport: Viewport = { width: 0, height: 0, pixelRatio: 1 };

  constructor(
    mount: HTMLElement,
    private readonly renderer: WebGLRenderer,
  ) {
    this.element = document.createElement('pre');
    this.element.setAttribute('aria-hidden', 'true');
    // Colours and type come from the tokens, through the custom properties the page already has.
    this.element.style.cssText = [
      'position:fixed',
      'z-index:5',
      'top:7.5rem', // below the HUD's top bar, which has two rows on a phone
      'left:var(--space-4)',
      'margin:0',
      'padding:var(--space-2) var(--space-3)',
      'border-radius:var(--radius-sm)',
      'background:var(--color-surface-panel)',
      'color:var(--color-ink-mid)',
      'font:var(--text-xs)/1.5 var(--font-mono)',
      'pointer-events:none',
      'opacity:0.9',
    ].join(';');
    mount.append(this.element);
  }

  frameUpdate(frame: Frame): void {
    this.frames += 1;
    this.seconds += frame.dt;
    this.worst = Math.max(this.worst, frame.dt);
    this.steps += Math.round((frame.simTime - this.lastSimTime) * tuning.loop.stepHz);
    this.lastSimTime = frame.simTime;
    if (this.seconds < REFRESH_SEC) return;

    // The numbers of the frame BEFORE this one: this frame has not been drawn yet.
    const { calls, triangles } = this.renderer.info.render;
    const { width, height, pixelRatio } = this.viewport;
    this.element.textContent = [
      `fps   ${(this.frames / this.seconds).toFixed(0)}`,
      `ms    ${((this.seconds / this.frames) * 1000).toFixed(1)}  worst ${(this.worst * 1000).toFixed(0)}`,
      `steps ${(this.steps / this.frames).toFixed(2)}`,
      `draws ${calls}  tris ${triangles}`,
      `px    ${Math.round(width * pixelRatio)} x ${Math.round(height * pixelRatio)} @${pixelRatio.toFixed(2)}`,
    ].join('\n');

    this.frames = 0;
    this.seconds = 0;
    this.worst = 0;
    this.steps = 0;
  }

  resize(viewport: Viewport): void {
    this.viewport = viewport;
  }

  dispose(): void {
    this.element.remove();
  }
}
