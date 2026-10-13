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

  /**
   * Returns true when the key is one of ours (the caller then keeps the page from scrolling).
   *
   * BOOST IS A FRESH PRESS IN THE PILOT'S OWN FLIGHT. On a journey Shift is not the boost key
   * (`boost` false): there it takes the jump (ui/HyperOffer.ts), and the Shift that took it may
   * still be down when the pilot takes the controls back, at the autopilot's speed, where the
   * guard believes a boost it is shown (sim/docking.ts, guardInput). So a Shift that goes down
   * on a journey is not held, and neither is one that is only repeating (`repeat`: it went down
   * some time ago): it is boost again once it is pressed afresh. The keyboard's counterpart of
   * the boost pad being put away (TouchControls.setFlying).
   */
  press(code: string, boost = true, repeat = false): boolean {
    const action = BINDINGS[code];
    if (action === undefined) return false;
    if (action === 'boost' && (!boost || repeat)) return true;
    if (!this.held.includes(code)) this.held.push(code);
    return true;
  }

  release(code: string): void {
    const index = this.held.indexOf(code);
    if (index !== -1) this.held.splice(index, 1);
  }

  /** A journey is being flown: a Shift held into it is let go of (see `press`). */
  releaseBoost(): void {
    for (let k = this.held.length - 1; k >= 0; k -= 1) {
      if (BINDINGS[this.held[k] ?? ''] === 'boost') this.held.splice(k, 1);
    }
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
