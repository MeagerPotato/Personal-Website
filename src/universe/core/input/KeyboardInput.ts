import type { FlightInput } from '../../sim/types';
import type { InputSource } from './intents';
import { KeyState, isFlightKey } from './keys';

/**
 * Places where a key press belongs to the page, not to the ship: form fields, and anything the
 * web layer marks with data-flight-keys="off" (the reading panel, so arrows scroll it and a
 * screen-reader user's navigation keys are never swallowed). docs/PLAN.md §5.3.
 */
const PAGE_OWNS_KEYS = 'input, textarea, select, [contenteditable], [data-flight-keys="off"]';

/** Is this key press the page's or the browser's business rather than the ship's? */
export function belongsToPage(event: KeyboardEvent): boolean {
  // Ctrl+S, Cmd+Left, Alt+D... are the browser's. Shift is ours: it is the boost key.
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return true;
  const element = event.target instanceof Element ? event.target : null;
  return element?.closest(PAGE_OWNS_KEYS) != null;
}

/** WASD / arrows to fly, Shift to boost. */
export class KeyboardInput implements InputSource {
  private readonly keys = new KeyState();

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
    target.document.addEventListener('visibilitychange', this.onBlur);
  }

  read(out: FlightInput): void {
    this.keys.read(out);
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.target.document.removeEventListener('visibilitychange', this.onBlur);
    this.keys.releaseAll();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!isFlightKey(event.code) || belongsToPage(event)) return;

    this.keys.press(event.code);
    // Arrow keys would scroll the page under the ship.
    event.preventDefault();
  };

  // Releases are never filtered: a key that went down over the canvas may come up over the panel.
  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.release(event.code);
  };

  private readonly onBlur = (): void => {
    this.keys.releaseAll();
  };
}
