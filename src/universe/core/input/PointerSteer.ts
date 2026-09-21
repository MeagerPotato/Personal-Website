import { tuning } from '../../design/tuning';
import type { FlightInput } from '../../sim/types';
import { addIntent, type InputSource } from './intents';

export interface PointerSteerParams {
  /** Off until the playtest decides (docs/PLAN.md §3). Flip it live in the dev panel. */
  readonly pointerSteer: boolean;
  /** The turn is full when the cursor is this share of the half-width away from the middle. */
  readonly pointerFullTurnShare: number;
}

/**
 * An experiment, behind `tuning.input.pointerSteer`: hold the mouse button on the world and the
 * ship flies toward the cursor. The further the cursor is from the middle of the view, the harder
 * the turn; holding IS the throttle. It is always installed and does nothing while the flag is
 * off, so the flag can be flipped while flying.
 */
export class PointerSteer implements InputSource {
  private held = false;
  private cursorX = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly params: PointerSteerParams = tuning.input,
  ) {
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.release);
    canvas.addEventListener('pointercancel', this.release);
    canvas.addEventListener('lostpointercapture', this.release);
    window.addEventListener('blur', this.release);
  }

  read(out: FlightInput): void {
    if (!this.held || !this.params.pointerSteer) return;
    const box = this.canvas.getBoundingClientRect();
    const half = box.width / 2;
    if (!(half > 0)) return;
    const offCentre = (this.cursorX - box.left - half) / (half * this.params.pointerFullTurnShare);
    // The cursor to the RIGHT of the middle means a clockwise turn, which is negative.
    addIntent(out, 1, Math.max(-1, Math.min(1, -offCentre)), 0, false);
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.release);
    this.canvas.removeEventListener('pointercancel', this.release);
    this.canvas.removeEventListener('lostpointercapture', this.release);
    window.removeEventListener('blur', this.release);
    this.held = false;
  }

  private readonly onDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    this.held = true;
    this.cursorX = event.clientX;
    this.canvas.setPointerCapture?.(event.pointerId);
  };

  private readonly onMove = (event: PointerEvent): void => {
    if (this.held && event.pointerType === 'mouse') this.cursorX = event.clientX;
  };

  private readonly release = (): void => {
    this.held = false;
  };
}
