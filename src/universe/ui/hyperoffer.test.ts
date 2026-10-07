// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HyperState } from '../state/Navigator';
import { HyperOffer } from './HyperOffer';

/** A navigator that does what the real one does with the two requests (sim/hyper.ts). */
function setup(hyper: HyperState = 'off') {
  // Stop first, as in the world: the prompt is built before the offer.
  document.body.innerHTML =
    '<div id="overlay"><button class="dock-prompt">Stop</button></div>' +
    '<main data-flight-keys="off"><input /></main>';
  const overlay = document.getElementById('overlay') as HTMLElement;
  const world = { room: true };
  const navigator = {
    hyper,
    engageHyper: vi.fn((): boolean => {
      if (navigator.hyper !== 'offered') return false;
      navigator.hyper = 'windup';
      return true;
    }),
    cancelHyper: vi.fn((): boolean => {
      if (navigator.hyper !== 'windup') return false;
      navigator.hyper = 'offered';
      return true;
    }),
  };
  const offer = new HyperOffer({ overlay, navigator, room: () => world.room });
  offer.frameUpdate();
  const button = overlay.querySelector('.hyper-offer') as HTMLButtonElement;
  const become = (state: HyperState): void => {
    navigator.hyper = state;
    offer.frameUpdate();
  };
  return { overlay, navigator, offer, button, world, become };
}

const press = (code: string, init: KeyboardEventInit = {}, target: EventTarget = window): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, ...init }));
};

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe('the offer of hyperspace', () => {
  it('is a real button after the prompt, named by what it says, hidden until there is a jump', () => {
    const { button, overlay, offer } = setup();
    cleanup = () => offer.dispose();
    expect(button.type).toBe('button');
    expect(button.hidden).toBe(true);
    expect(offer.box()).toBeNull();
    // Tab goes Stop, then Hyperspace.
    expect([...overlay.children].map((child) => child.className)).toEqual([
      'dock-prompt',
      'hyper-offer',
    ]);
    // Never the prompt's class: there is one prompt, and tests and styles count on it.
    expect(button.classList.contains('dock-prompt')).toBe(false);
    // The key it names, and the word in two parts: a round pad has room for the first.
    expect(button.querySelector('kbd')?.textContent).toBe('Shift');
    expect(button.querySelector('.hyper-offer__rest')?.textContent).toBe('space');
    expect(button.textContent).toBe('ShiftHyperspace');
    expect(button.hasAttribute('aria-keyshortcuts')).toBe(false);
  });

  it('shows while a jump is offered or winding up, lit through the wind-up, and goes with the punch', () => {
    const { button, offer, become } = setup();
    cleanup = () => offer.dispose();
    const seen = (): [shown: boolean, on: boolean] => [
      !button.hidden,
      button.hasAttribute('data-on'),
    ];
    become('offered');
    expect(seen()).toEqual([true, false]);
    become('windup');
    expect(seen()).toEqual([true, true]);
    // A wind-up taken back is an offer again.
    become('offered');
    expect(seen()).toEqual([true, false]);
    become('windup');
    become('tunnel');
    expect(seen()).toEqual([false, false]);
    expect(offer.box()).toBeNull();
    become('off');
    expect(seen()).toEqual([false, false]);
  });

  it('shows only while the world has the whole screen, and comes back when it has', () => {
    const { button, offer, world, become } = setup();
    cleanup = () => offer.dispose();
    world.room = false;
    become('offered');
    expect(button.hidden).toBe(true);
    world.room = true;
    offer.frameUpdate();
    expect(button.hidden).toBe(false);
    // A page opens, or the map: gone, lit or not.
    become('windup');
    world.room = false;
    offer.frameUpdate();
    expect(button.hidden).toBe(true);
    expect(button.hasAttribute('data-on')).toBe(false);
  });

  it('takes a fresh Shift, either one, while it shows', () => {
    for (const code of ['ShiftLeft', 'ShiftRight']) {
      const { navigator, offer, become } = setup();
      become('offered');
      press(code, { shiftKey: true });
      expect(navigator.engageHyper, code).toHaveBeenCalledTimes(1);
      expect(navigator.hyper, code).toBe('windup');
      // Winding up already: a second press asks for nothing.
      press(code, { shiftKey: true });
      expect(navigator.engageHyper, code).toHaveBeenCalledTimes(1);
      offer.dispose();
    }
  });

  it('takes no Shift that is held, a shortcut, typed into the page, or pressed with nothing to take', () => {
    const { navigator, offer, world, become } = setup();
    cleanup = () => offer.dispose();
    become('offered');
    // Held since before the journey; the browser's own; a form field's, and the page's.
    press('ShiftLeft', { shiftKey: true, repeat: true });
    press('ShiftLeft', { shiftKey: true, ctrlKey: true });
    press('ShiftLeft', { shiftKey: true, altKey: true });
    press('ShiftLeft', { shiftKey: true, metaKey: true });
    press('ShiftLeft', { shiftKey: true }, document.querySelector('input') as HTMLElement);
    press('ShiftLeft', { shiftKey: true }, document.querySelector('main') as HTMLElement);
    // Another key is no Shift.
    press('KeyE');
    expect(navigator.engageHyper).not.toHaveBeenCalled();

    // No room: nothing shows, and the key does nothing (Shift is still the boost key elsewhere).
    world.room = false;
    offer.frameUpdate();
    press('ShiftLeft', { shiftKey: true });
    expect(navigator.engageHyper).not.toHaveBeenCalled();
    // And with no jump on offer at all.
    world.room = true;
    for (const state of ['off', 'tunnel'] as const) {
      become(state);
      press('ShiftLeft', { shiftKey: true });
    }
    expect(navigator.engageHyper).not.toHaveBeenCalled();
    expect(navigator.cancelHyper).not.toHaveBeenCalled();
  });

  it('asks as of now, not of the last frame: a press between two frames is not lost', () => {
    const { navigator, offer, button } = setup();
    cleanup = () => offer.dispose();
    // The simulation has offered; no frame has drawn the button yet.
    navigator.hyper = 'offered';
    expect(button.hidden).toBe(true);
    press('ShiftRight', { shiftKey: true });
    expect(navigator.hyper).toBe('windup');
  });

  it('takes a chord in the wind-up back: Shift+Tab is no jump', () => {
    const { navigator, offer, button, become } = setup();
    cleanup = () => offer.dispose();
    become('offered');
    press('ShiftLeft', { shiftKey: true });
    expect(navigator.hyper).toBe('windup');
    press('Tab', { shiftKey: true });
    expect(navigator.cancelHyper).toHaveBeenCalledTimes(1);
    expect(navigator.hyper).toBe('offered');
    offer.frameUpdate();
    expect(button.hidden).toBe(false);
    expect(button.hasAttribute('data-on')).toBe(false);

    // Any key with Shift down, wherever it is typed, and whoever else it belongs to.
    press('ShiftLeft', { shiftKey: true });
    press('KeyA', { shiftKey: true }, document.querySelector('input') as HTMLElement);
    expect(navigator.hyper).toBe('offered');
    press('ShiftLeft', { shiftKey: true });
    press('Tab', { shiftKey: true, ctrlKey: true });
    expect(navigator.hyper).toBe('offered');
    expect(navigator.cancelHyper).toHaveBeenCalledTimes(3);

    // A key with no Shift is no chord; and after the punch a chord changes nothing.
    press('ShiftLeft', { shiftKey: true });
    press('Tab');
    expect(navigator.hyper).toBe('windup');
    become('tunnel');
    press('Tab', { shiftKey: true });
    expect(navigator.hyper).toBe('tunnel');
    expect(navigator.cancelHyper).toHaveBeenCalledTimes(3);
  });

  it('takes a thumb as it lands and the click that follows as one press, and a click alone', () => {
    const { navigator, offer, button, become } = setup();
    cleanup = () => offer.dispose();
    become('offered');
    button.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    expect(navigator.hyper).toBe('windup');
    button.click();
    expect(navigator.engageHyper).toHaveBeenCalledTimes(1);

    // Enter or Space on the focused button: a click with no pointer before it.
    become('offered');
    button.click();
    expect(navigator.engageHyper).toHaveBeenCalledTimes(2);
    expect(navigator.hyper).toBe('windup');

    // The other mouse buttons are not presses.
    become('offered');
    button.dispatchEvent(new PointerEvent('pointerdown', { button: 2, bubbles: true }));
    expect(navigator.engageHyper).toHaveBeenCalledTimes(2);
  });

  it('lets go of the focus when it goes, and never hands it to Stop', () => {
    const { offer, button, overlay, become } = setup();
    cleanup = () => offer.dispose();
    become('offered');
    button.focus();
    expect(document.activeElement).toBe(button);
    become('windup');
    // Still there through the wind-up: so is the focus.
    expect(document.activeElement).toBe(button);
    become('tunnel');
    expect(button.hidden).toBe(true);
    expect(document.activeElement).not.toBe(button);
    expect(document.activeElement).not.toBe(overlay.querySelector('.dock-prompt'));
  });

  it('says where it is while it shows, for the names to keep off', () => {
    const { offer, button, become } = setup();
    cleanup = () => offer.dispose();
    button.getBoundingClientRect = () => new DOMRect(1000, 600, 174, 44);
    expect(offer.box()).toBeNull();
    become('offered');
    expect(offer.box()).toEqual({ left: 1000, top: 600, width: 174, height: 44 });
    become('tunnel');
    expect(offer.box()).toBeNull();
  });

  it('cleans up after itself', () => {
    const { navigator, offer, overlay, become } = setup();
    become('offered');
    offer.dispose();
    expect(overlay.querySelector('.hyper-offer')).toBeNull();
    press('ShiftLeft', { shiftKey: true });
    expect(navigator.engageHyper).not.toHaveBeenCalled();
  });
});
