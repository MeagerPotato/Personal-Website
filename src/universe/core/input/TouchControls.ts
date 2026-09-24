import { tuning } from '../../design/tuning';
import type { ScreenBox } from '../../sim/declutter';
import type { FlightInput } from '../../sim/types';
import { boxOf } from '../dom';
import { addIntent, type InputSource } from './intents';
import { mapStick, type StickIntent, type StickParams } from './stick';

export interface TouchParams extends StickParams {
  /** How far the knob travels from the centre of the stick, in CSS px. */
  readonly stickRadiusPx: number;
}

/**
 * Flying with thumbs. The FIRST finger on the world becomes a stick that appears right under it
 * (no reaching for a fixed spot, and either hand works); stick.ts says what its deflection
 * means. Boost is any SECOND finger on the world, or the boost pad in the corner, which is there
 * so that boost can be discovered. The pad is only out in free flight: boost multiplies the
 * pilot's own thrust, and docked or on a journey the stick is what takes the controls back.
 *
 * The engine owns these elements because they follow a finger every frame; how they LOOK is CSS
 * (src/styles, `.touch-stick`, `.touch-boost`), which is the design surface. Nothing shows until
 * the first touch, so a mouse-and-keyboard visitor never sees any of it.
 *
 * The world never scrolls or zooms under a finger: the canvas and the pad have `touch-action:
 * none` (in CSS: it has to be there before the first touch, not set from a handler).
 */
export class TouchControls implements InputSource {
  private readonly base = document.createElement('div');
  private readonly knob = document.createElement('div');
  private readonly pad = document.createElement('div');
  private readonly boosting = new Set<number>();
  private readonly intent: StickIntent = { thrust: 0, turn: 0, brake: 0 };
  private stickPointer: number | null = null;
  private originX = 0;
  private originY = 0;
  private deflectX = 0;
  private deflectY = 0;
  private enabled = true;
  /** A finger has touched the world: from then on boost can be found (while flying). */
  private touched = false;
  /** The pilot flies the ship (free flight): the only time boost does anything. */
  private flying = true;
  private readonly padArea: ScreenBox = { left: 0, top: 0, width: 0, height: 0 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly mount: HTMLElement,
    private readonly params: TouchParams = tuning.input,
  ) {
    this.base.className = 'touch-stick';
    // One number for the feel and the look: the CSS sizes the ring from the knob's travel.
    this.base.style.setProperty('--stick-radius', `${params.stickRadiusPx}px`);
    this.knob.className = 'touch-stick__knob';
    this.base.append(this.knob);
    this.base.hidden = true;
    this.pad.className = 'touch-boost';
    this.pad.textContent = 'Boost';
    this.pad.hidden = true;
    mount.append(this.base, this.pad);

    canvas.addEventListener('pointerdown', this.onCanvasDown);
    canvas.addEventListener('pointermove', this.onMove);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      canvas.addEventListener(type, this.onCanvasUp);
      this.pad.addEventListener(type, this.onPadUp);
    }
    this.pad.addEventListener('pointerdown', this.onPadDown);
    window.addEventListener('blur', this.releaseAll);
    document.addEventListener('visibilitychange', this.releaseAll);
  }

  read(out: FlightInput): void {
    const radius = this.params.stickRadiusPx;
    mapStick(this.deflectX / radius, this.deflectY / radius, this.params, this.intent);
    addIntent(out, this.intent.thrust, this.intent.turn, this.intent.brake, this.boosting.size > 0);
  }

  /** Off: fingers on the world are somebody else's (the star map), and stick and pad are put away. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.releaseAll();
    this.showPad();
  }

  /**
   * Is the pilot flying the ship (not docked, not on the way to a dock or on a journey)? Only then
   * does boost do anything, so only then is the pad out: a control that lights up under a thumb
   * and does nothing is worse than none. The stick stays, because it is how the pilot leaves.
   */
  setFlying(flying: boolean): void {
    if (flying === this.flying) return;
    this.flying = flying;
    if (!flying) this.releaseBoosts();
    this.showPad();
  }

  /**
   * Where the boost pad is on the page, or null until a finger has brought it out. A name under
   * a thumb that is boosting would be pressed by accident: names keep off it (ui/Labels.ts).
   */
  padBox(): Readonly<ScreenBox> | null {
    return this.pad.hidden ? null : boxOf(this.pad, this.padArea);
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onCanvasDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      this.canvas.removeEventListener(type, this.onCanvasUp);
    }
    window.removeEventListener('blur', this.releaseAll);
    document.removeEventListener('visibilitychange', this.releaseAll);
    this.releaseAll();
    this.base.remove();
    this.pad.remove();
  }

  private readonly onCanvasDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse') return;
    this.touched = true; // a finger exists: from now on boost can be found
    if (!this.enabled) return;
    this.showPad();
    this.canvas.setPointerCapture?.(event.pointerId);

    if (this.stickPointer === null) {
      this.stickPointer = event.pointerId;
      this.originX = event.clientX;
      this.originY = event.clientY;
      this.deflectX = 0;
      this.deflectY = 0;
      this.base.hidden = false;
      this.draw();
    } else {
      this.boosting.add(event.pointerId);
      this.pad.dataset.active = '';
    }
  };

  private readonly onMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.stickPointer) return;
    let dx = event.clientX - this.originX;
    let dy = event.clientY - this.originY;
    const radius = this.params.stickRadiusPx;
    const length = Math.hypot(dx, dy);
    if (length > radius) {
      // The thumb ran off the edge: drag the whole stick along, so that a change of direction
      // registers at once instead of only after the thumb has travelled all the way back.
      const excess = (length - radius) / length;
      this.originX += dx * excess;
      this.originY += dy * excess;
      dx -= dx * excess;
      dy -= dy * excess;
    }
    this.deflectX = dx;
    this.deflectY = dy;
    this.draw();
  };

  private readonly onCanvasUp = (event: PointerEvent): void => {
    if (event.pointerId === this.stickPointer) this.releaseStick();
    else this.releaseBoost(event.pointerId);
  };

  private readonly onPadDown = (event: PointerEvent): void => {
    event.preventDefault();
    this.pad.setPointerCapture?.(event.pointerId);
    this.boosting.add(event.pointerId);
    this.pad.dataset.active = '';
  };

  private readonly onPadUp = (event: PointerEvent): void => {
    this.releaseBoost(event.pointerId);
  };

  private readonly releaseAll = (): void => {
    this.releaseStick();
    this.releaseBoosts();
  };

  private releaseBoosts(): void {
    this.boosting.clear();
    delete this.pad.dataset.active;
  }

  private showPad(): void {
    this.pad.hidden = !(this.enabled && this.touched && this.flying);
  }

  private releaseStick(): void {
    this.stickPointer = null;
    this.deflectX = 0;
    this.deflectY = 0;
    this.base.hidden = true;
  }

  private releaseBoost(pointerId: number): void {
    this.boosting.delete(pointerId);
    if (this.boosting.size === 0) delete this.pad.dataset.active;
  }

  private draw(): void {
    const host = this.mount.getBoundingClientRect();
    this.base.style.transform = `translate(${this.originX - host.left}px, ${this.originY - host.top}px)`;
    this.knob.style.transform = `translate(${this.deflectX}px, ${this.deflectY}px)`;
  }
}
