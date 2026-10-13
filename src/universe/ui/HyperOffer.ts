import type { System } from '../core/Engine';
import { boxOf, flag } from '../core/dom';
import { belongsToPage } from '../core/input/KeyboardInput';
import type { ScreenBox } from '../sim/declutter';
import type { HyperState } from '../state/Navigator';

/** What the offer needs of state/Navigator.ts. */
export interface OfferNavigator {
  readonly hyper: HyperState;
  engageHyper(): boolean;
  cancelHyper(): boolean;
}

export interface HyperOfferOptions {
  /** Where interactive DOM goes: outside the engine's mount, which is hidden from assistive tech. */
  overlay: HTMLElement;
  navigator: OfferNavigator;
  /**
   * Does the world have the whole screen: no page open beside or under it, the star map closed?
   * Only then is a jump offered (main.ts). One already taken carries on whatever opens.
   */
  room(): boolean;
}

/**
 * THE OFFER OF HYPERSPACE: while a journey has a jump to give (sim/hyper.ts) and the world has
 * the whole screen, one real <button> says so, and Shift is its key: "on a journey, boost is
 * hyperspace", for a key and for a thumb alike (under a finger the stylesheet stands it in the
 * boost pad's own box, which is empty for the whole of every journey). It shows through the
 * wind-up, lit (`data-on`), and goes with the punch.
 *
 * It only ever ASKS the navigator, and both of its questions may be asked at any time: a press
 * that comes too late, or twice, does nothing. Looks are CSS (`.hyper-offer` in
 * src/styles/global.css). It is not announced: "Hyperspace." is said when the tunnel opens
 * (shell/announcer.ts).
 */
export class HyperOffer implements System {
  private readonly button: HTMLButtonElement;
  private readonly area: ScreenBox = { left: 0, top: 0, width: 0, height: 0 };

  constructor(private readonly options: HyperOfferOptions) {
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'hyper-offer';
    this.button.hidden = true;
    const key = document.createElement('kbd');
    key.textContent = 'Shift';
    // "Hyper" is all a round pad has room for: the rest is its own element, for the stylesheet to
    // set aside there. A screen reader hears the whole word.
    const word = document.createElement('span');
    const rest = document.createElement('span');
    rest.className = 'hyper-offer__rest';
    rest.textContent = 'space';
    word.append('Hyper', rest);
    this.button.append(key, word);
    options.overlay.append(this.button);

    // A thumb on the pad acts as it lands, as on the boost pad; the click that follows finds the
    // jump taken already. A keyboard's Enter or Space is a click alone.
    this.button.addEventListener('pointerdown', this.onPointerDown);
    this.button.addEventListener('click', this.engage);
    window.addEventListener('keydown', this.onKeyDown);
  }

  frameUpdate(): void {
    const { button } = this;
    const shown = this.offered();
    if (shown === button.hidden) {
      // It goes with the punch (or with the journey): the keyboard's focus does not stay on a
      // button that is not there, and is not handed to Stop, where a second Enter would end the
      // journey that has just jumped.
      if (!shown && document.activeElement === button) button.blur();
      button.hidden = !shown;
    }
    // Lit through the wind-up: the press was heard.
    flag(button, 'data-on', shown && this.options.navigator.hyper === 'windup');
  }

  /** Where the offer is on the page, or null while it does not show: names keep off it. */
  box(): Readonly<ScreenBox> | null {
    return this.button.hidden ? null : boxOf(this.button, this.area);
  }

  dispose(): void {
    this.button.removeEventListener('pointerdown', this.onPointerDown);
    this.button.removeEventListener('click', this.engage);
    window.removeEventListener('keydown', this.onKeyDown);
    this.button.remove();
  }

  /** Is there a jump to take or one being wound up, and room to show it? Asked as of now. */
  private offered(): boolean {
    const { hyper } = this.options.navigator;
    return (hyper === 'offered' || hyper === 'windup') && this.options.room();
  }

  /** Take the jump, if it is there to take: as of now, not of the last frame. */
  private readonly engage = (): void => {
    const { navigator, room } = this.options;
    if (navigator.hyper === 'offered' && room()) navigator.engageHyper();
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button === 0) this.engage();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const { navigator } = this.options;
    if (event.code !== 'ShiftLeft' && event.code !== 'ShiftRight') {
      // A chord is not a jump: Shift+Tab, above all, takes the wind-up back and the offer returns.
      // After the punch a chord changes nothing.
      if (event.shiftKey && navigator.hyper === 'windup') navigator.cancelHyper();
      return;
    }
    // A fresh press, and the ship's own: a Shift held since before the journey says nothing, nor
    // does one with Ctrl, Alt or Meta, or one typed into the page.
    if (event.repeat || belongsToPage(event)) return;
    this.engage();
  };
}
