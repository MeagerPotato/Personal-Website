// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlightInput } from '../../sim/types';
import { InputSystem } from './InputSystem';
import { KeyboardInput } from './KeyboardInput';
import { addIntent, clearIntent, isSteering, type InputSource } from './intents';
import { KeyState } from './keys';

const blank = (): FlightInput => ({ thrust: 0, turn: 0, brake: 0, boost: false });

describe('merging intents', () => {
  it('takes the strongest thrust and brake, adds turns, and ORs boost', () => {
    const total = blank();
    addIntent(total, 0.4, 0.5, 0, false);
    addIntent(total, 1, 0.75, 0.3, true);
    expect(total).toEqual({ thrust: 1, turn: 1, brake: 0.3, boost: true });

    addIntent(total, 0, -2, 0, false);
    expect(total.turn).toBe(-1);
    expect(clearIntent(total)).toEqual(blank());
  });

  it('knows when the pilot is asking for something', () => {
    expect(isSteering(blank())).toBe(false);
    expect(isSteering({ ...blank(), turn: -0.2 })).toBe(true);
    expect(isSteering({ ...blank(), turn: -0.2 }, 0.25)).toBe(false);
    expect(isSteering({ ...blank(), boost: true }, 0.25)).toBe(true);
  });
});

describe('KeyState', () => {
  const read = (keys: KeyState): FlightInput => {
    const out = blank();
    keys.read(out);
    return out;
  };

  it('maps WASD, arrows and Shift, and ignores every other key', () => {
    const keys = new KeyState();
    expect(keys.press('KeyW')).toBe(true);
    expect(keys.press('ShiftLeft')).toBe(true);
    expect(keys.press('ArrowLeft')).toBe(true);
    expect(keys.press('KeyQ')).toBe(false);
    expect(read(keys)).toEqual({ thrust: 1, turn: 1, brake: 0, boost: true });

    keys.release('KeyW');
    keys.press('ArrowDown');
    expect(read(keys)).toEqual({ thrust: 0, turn: 1, brake: 1, boost: true });
  });

  it('lets the LAST of left and right win, and hands back when it is released', () => {
    const keys = new KeyState();
    keys.press('KeyA');
    keys.press('KeyD');
    expect(read(keys).turn).toBe(-1);
    keys.release('KeyD');
    expect(read(keys).turn).toBe(1);
  });

  it('is not confused by key repeat or by releasing a key it never saw', () => {
    const keys = new KeyState();
    keys.press('KeyA');
    keys.press('KeyD');
    keys.press('KeyA'); // auto-repeat of a key that is already down must not reorder
    expect(read(keys).turn).toBe(-1);
    keys.release('KeyZ');
    keys.releaseAll();
    expect(keys.anyHeld).toBe(false);
    expect(read(keys)).toEqual(blank());
  });
});

describe('KeyboardInput', () => {
  let keyboard: KeyboardInput | undefined;
  afterEach(() => {
    keyboard?.dispose();
    keyboard = undefined;
    document.body.innerHTML = '';
  });

  const press = (
    code: string,
    target: EventTarget = document.body,
    init: KeyboardEventInit = {},
  ) => {
    const event = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };
  const read = (): FlightInput => {
    const out = blank();
    keyboard?.read(out);
    return out;
  };

  it('flies on flight keys and keeps the page from scrolling under the ship', () => {
    keyboard = new KeyboardInput();
    expect(press('ArrowUp').defaultPrevented).toBe(true);
    expect(read().thrust).toBe(1);

    expect(press('KeyQ').defaultPrevented).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowUp' }));
    expect(read().thrust).toBe(0);
  });

  it("leaves the browser's shortcuts alone", () => {
    keyboard = new KeyboardInput();
    expect(press('KeyS', document.body, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press('ArrowLeft', document.body, { altKey: true }).defaultPrevented).toBe(false);
    expect(press('KeyD', document.body, { metaKey: true }).defaultPrevented).toBe(false);
    expect(read()).toEqual(blank());
  });

  it('gives keys to the page inside form fields and the reading panel', () => {
    document.body.innerHTML =
      '<main data-flight-keys="off"><a href="/x/" id="link">x</a></main><input id="field" />';
    keyboard = new KeyboardInput();

    for (const id of ['link', 'field']) {
      const element = document.getElementById(id) as HTMLElement;
      expect(press('ArrowDown', element).defaultPrevented).toBe(false);
      expect(press('KeyW', element).defaultPrevented).toBe(false);
    }
    expect(read()).toEqual(blank());
  });

  it('lets go of everything when the window loses focus', () => {
    keyboard = new KeyboardInput();
    press('KeyW');
    press('ShiftLeft');
    window.dispatchEvent(new Event('blur'));
    expect(read()).toEqual(blank());
  });

  it('still hears a release that happens over the panel', () => {
    document.body.innerHTML = '<main data-flight-keys="off"><p id="text">text</p></main>';
    keyboard = new KeyboardInput();
    press('KeyW');
    document
      .getElementById('text')
      ?.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
    expect(read().thrust).toBe(0);
  });

  it('stops listening once disposed', () => {
    keyboard = new KeyboardInput();
    keyboard.dispose();
    expect(press('KeyW').defaultPrevented).toBe(false);
    expect(read()).toEqual(blank());
  });
});

describe('InputSystem', () => {
  const stick = (input: Partial<FlightInput>): InputSource & { disposed: boolean } => ({
    disposed: false,
    read(out) {
      addIntent(out, input.thrust ?? 0, input.turn ?? 0, input.brake ?? 0, input.boost ?? false);
    },
    dispose() {
      this.disposed = true;
    },
  });

  it('samples every device once per step and reports the first input once', () => {
    const onFirstInput = vi.fn();
    const system = new InputSystem(onFirstInput);
    system.fixedUpdate();
    expect(onFirstInput).not.toHaveBeenCalled();

    const keys = system.add(stick({ thrust: 1, turn: 1 }));
    const touch = system.add(stick({ turn: -0.25, boost: true }));
    system.fixedUpdate();
    system.fixedUpdate();
    expect(system.current).toEqual({ thrust: 1, turn: 0.75, brake: 0, boost: true });
    expect(onFirstInput).toHaveBeenCalledTimes(1);

    system.dispose();
    expect(keys.disposed && touch.disposed).toBe(true);
    expect(system.current).toEqual(blank());
  });
});
