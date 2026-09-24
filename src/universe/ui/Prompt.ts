import type { System } from '../core/Engine';
import { belongsToPage } from '../core/input/KeyboardInput';
import { boxOf } from '../core/dom';
import type { ScreenBox } from '../sim/declutter';
import type { AppState } from '../state/appMachine';

/** What the prompt needs of state/Navigator.ts. */
export interface PromptNavigator {
  readonly state: AppState;
  readonly candidate: string | null;
  approach(id: string): boolean;
  release(by: 'pilot' | 'asked'): void;
  stop(by: 'pilot' | 'asked'): void;
}

export interface PromptOptions {
  /** Where interactive DOM goes: outside the engine's mount, which is hidden from assistive tech. */
  overlay: HTMLElement;
  navigator: PromptNavigator;
  /** The name a visitor knows a body by. */
  titleOf(id: string): string;
  /**
   * While this says so, the prompt keeps out of sight, and comes back as it was when it stops
   * saying so: the star map on a narrow screen, squeezed into the strip above an open page, where
   * the prompt would sit on the galaxy itself (main.ts). `E` still works.
   */
  quiet?: () => boolean;
}

const DOCK_KEY = 'KeyE';

/**
 * THE QUIET PROMPT (docs/PLAN.md §3): within reach of a body it offers to orbit it, on the way
 * to one it says where the ship is going and offers to stop, and in orbit it offers the way out.
 * One real <button>, so it works with a finger, a mouse, a keyboard and a screen reader alike;
 * `E` is the shortcut for a pilot with both hands on the keys.
 *
 * It only ever ASKS the navigator. Looks are CSS (`.dock-prompt` in src/styles/global.css).
 */
export class Prompt implements System {
  private readonly button: HTMLButtonElement;
  private readonly label: HTMLSpanElement;
  private readonly key: HTMLElement;
  /** What pressing the button does, when the label is news rather than an offer ("Stop"). */
  private readonly action: HTMLSpanElement;
  private shown = '';
  private hushed = false;
  private readonly area: ScreenBox = { left: 0, top: 0, width: 0, height: 0 };

  constructor(private readonly options: PromptOptions) {
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'dock-prompt';
    this.button.hidden = true;
    this.key = document.createElement('kbd');
    this.label = document.createElement('span');
    this.action = document.createElement('span');
    this.action.className = 'dock-prompt__action';
    this.button.append(this.key, this.label, this.action);
    options.overlay.append(this.button);

    this.button.addEventListener('click', this.act);
    window.addEventListener('keydown', this.onKeyDown);
  }

  frameUpdate(): void {
    const { navigator, titleOf } = this.options;
    const { mode, target } = navigator.state;
    const candidate = navigator.candidate;

    let text = '';
    let key = '';
    let action = '';
    if (mode === 'flight' && candidate !== null) {
      text = `Orbit ${titleOf(candidate)}`;
      key = 'E';
    } else if (mode === 'docked' && target !== null) {
      text = 'Leave orbit';
    } else if (target !== null) {
      // On its way, flown by the autopilot or by the ring's own pilot. Steering takes the ship
      // back too, but nobody can know that, least of all someone who got here by a tap.
      text = `Flying to ${titleOf(target)}`;
      action = 'Stop';
    }
    const hushed = this.options.quiet?.() ?? false;
    if (text === this.shown && hushed === this.hushed) return;
    this.shown = text;
    this.hushed = hushed;
    this.label.textContent = text;
    this.key.textContent = key;
    this.key.hidden = key === '';
    this.action.textContent = action;
    this.action.hidden = action === '';
    this.button.hidden = text === '' || hushed;
  }

  /** Where the prompt is on the page, or null while it does not show: names keep off it. */
  box(): Readonly<ScreenBox> | null {
    return this.button.hidden ? null : boxOf(this.button, this.area);
  }

  dispose(): void {
    this.button.removeEventListener('click', this.act);
    window.removeEventListener('keydown', this.onKeyDown);
    this.button.remove();
  }

  private readonly act = (): void => {
    const { navigator } = this.options;
    const { mode, target } = navigator.state;
    // "Leave orbit" lets go; "Stop", on the way somewhere, also brakes the ship to rest.
    if (mode === 'docked') navigator.release('pilot');
    else if (target !== null) navigator.stop('pilot');
    else if (navigator.candidate !== null) navigator.approach(navigator.candidate);
    // The button is about to change or go: do not leave the keyboard focus on it.
    this.button.blur();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== DOCK_KEY || event.repeat || belongsToPage(event)) return;
    const { navigator } = this.options;
    if (navigator.state.mode === 'flight' && navigator.candidate !== null) {
      navigator.approach(navigator.candidate);
      event.preventDefault();
    }
  };
}
