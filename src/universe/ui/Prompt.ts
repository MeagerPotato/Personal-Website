import type { System } from '../core/Engine';
import { belongsToPage } from '../core/input/KeyboardInput';
import type { AppState } from '../state/appMachine';

/** What the prompt needs of state/Navigator.ts. */
export interface PromptNavigator {
  readonly state: AppState;
  readonly candidate: string | null;
  approach(id: string): boolean;
  release(by: 'pilot' | 'asked'): void;
}

export interface PromptOptions {
  /** Where interactive DOM goes: outside the engine's mount, which is hidden from assistive tech. */
  overlay: HTMLElement;
  navigator: PromptNavigator;
  /** The name a visitor knows a body by. */
  titleOf(id: string): string;
}

const DOCK_KEY = 'KeyE';

/**
 * THE QUIET PROMPT (docs/PLAN.md §3): within reach of a body it offers to orbit it, and in orbit
 * it offers the way out. One real <button>, so it works with a finger, a mouse, a keyboard and a
 * screen reader alike; `E` is the shortcut for a pilot with both hands on the keys.
 *
 * It only ever ASKS the navigator. Looks are CSS (`.dock-prompt` in src/styles/global.css).
 */
export class Prompt implements System {
  private readonly button: HTMLButtonElement;
  private readonly label: HTMLSpanElement;
  private readonly key: HTMLElement;
  private shown = '';

  constructor(private readonly options: PromptOptions) {
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'dock-prompt';
    this.button.hidden = true;
    this.key = document.createElement('kbd');
    this.label = document.createElement('span');
    this.button.append(this.key, this.label);
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
    if (mode === 'flight' && candidate !== null) {
      text = `Orbit ${titleOf(candidate)}`;
      key = 'E';
    } else if (mode === 'docked' && target !== null) {
      text = 'Leave orbit';
    }
    if (text === this.shown) return;
    this.shown = text;
    this.label.textContent = text;
    this.key.textContent = key;
    this.key.hidden = key === '';
    this.button.hidden = text === '';
  }

  dispose(): void {
    this.button.removeEventListener('click', this.act);
    window.removeEventListener('keydown', this.onKeyDown);
    this.button.remove();
  }

  private readonly act = (): void => {
    const { navigator } = this.options;
    if (navigator.state.mode === 'docked') navigator.release('pilot');
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
