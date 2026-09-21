import type { FlightInput } from '../../sim/types';
import { addIntent } from './intents';

/**
 * Which keys fly the ship, and what holding several of them means. Pure (no DOM), so the rules
 * are tested without a browser; KeyboardInput.ts is the thin adapter that feeds it real events.
 *
 * Keys are PHYSICAL positions (`KeyboardEvent.code`), so WASD sits under the left hand on AZERTY
 * and Dvorak keyboards too.
 */

type Action = 'thrust' | 'brake' | 'left' | 'right' | 'boost';

const BINDINGS: Readonly<Record<string, Action>> = {
  KeyW: 'thrust',
  ArrowUp: 'thrust',
  KeyS: 'brake',
  ArrowDown: 'brake',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'boost',
  ShiftRight: 'boost',
};

export function isFlightKey(code: string): boolean {
  return code in BINDINGS;
}

export class KeyState {
  /** Held keys in the order they went down: the LAST of left/right wins. */
  private readonly held: string[] = [];

  /** Returns true when the key is one of ours (the caller then keeps the page from scrolling). */
  press(code: string): boolean {
    if (!isFlightKey(code)) return false;
    if (!this.held.includes(code)) this.held.push(code);
    return true;
  }

  release(code: string): void {
    const index = this.held.indexOf(code);
    if (index !== -1) this.held.splice(index, 1);
  }

  /** The window lost focus: we will never see those keys come up, so let go of all of them. */
  releaseAll(): void {
    this.held.length = 0;
  }

  get anyHeld(): boolean {
    return this.held.length > 0;
  }

  read(out: FlightInput): void {
    let thrust = 0;
    let brake = 0;
    let turn = 0;
    let boost = false;
    for (const code of this.held) {
      const action = BINDINGS[code];
      if (action === 'thrust') thrust = 1;
      else if (action === 'brake') brake = 1;
      else if (action === 'boost') boost = true;
      // Holding left and tapping right should steer right at once, not cancel to nothing: the
      // key pressed LAST decides, and releasing it hands control back to the one still held.
      else if (action === 'left') turn = 1;
      else if (action === 'right') turn = -1;
    }
    addIntent(out, thrust, turn, brake, boost);
  }
}
