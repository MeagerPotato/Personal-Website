// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppState } from '../state/appMachine';
import { Prompt, type PromptNavigator } from './Prompt';

function setup(state: AppState, candidate: string | null) {
  document.body.innerHTML = '<div id="overlay"></div><main data-flight-keys="off"><input /></main>';
  const overlay = document.getElementById('overlay') as HTMLElement;
  const navigator = {
    state,
    candidate,
    approach: vi.fn(() => true),
    release: vi.fn(),
    stop: vi.fn(),
  };
  const prompt = new Prompt({
    overlay,
    navigator: navigator as PromptNavigator,
    titleOf: (id) => (id === 'project/fishai' ? 'FishAI' : id),
  });
  prompt.frameUpdate();
  const button = overlay.querySelector('button') as HTMLButtonElement;
  return { overlay, navigator, prompt, button };
}

const press = (code: string, init: KeyboardEventInit = {}, target: EventTarget = window): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, ...init }));
};

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe('dock prompt', () => {
  it('is a real button, hidden until there is something to offer', () => {
    const { button, prompt } = setup({ mode: 'flight', target: null }, null);
    cleanup = () => prompt.dispose();
    expect(button.type).toBe('button');
    expect(button.hidden).toBe(true);
  });

  it('offers to orbit the body within reach, by its name, and says which key does it', () => {
    const { button, navigator, prompt } = setup({ mode: 'flight', target: null }, 'project/fishai');
    cleanup = () => prompt.dispose();
    expect(button.hidden).toBe(false);
    expect(button.textContent).toBe('EOrbit FishAI');
    expect(button.querySelector('kbd')?.textContent).toBe('E');

    button.click();
    expect(navigator.approach).toHaveBeenCalledWith('project/fishai');
  });

  it('takes E from the keyboard, but not from a form field, the panel, or a shortcut', () => {
    const { navigator, prompt } = setup({ mode: 'flight', target: null }, 'project/fishai');
    cleanup = () => prompt.dispose();

    press('KeyE', { ctrlKey: true });
    press('KeyE', { repeat: true });
    press('KeyE', {}, document.querySelector('input') as HTMLElement);
    press('KeyQ');
    expect(navigator.approach).not.toHaveBeenCalled();

    press('KeyE');
    expect(navigator.approach).toHaveBeenCalledTimes(1);
  });

  it('on the way somewhere, says where to and offers to stop, which brakes the ship to rest', () => {
    for (const mode of ['autopilot', 'approach'] as const) {
      const { button, navigator, prompt } = setup({ mode, target: 'project/fishai' }, null);
      expect(button.hidden).toBe(false);
      expect(button.textContent).toBe('Flying to FishAIStop');
      expect(button.querySelector('kbd')?.hidden).toBe(true);
      expect(button.querySelector('.dock-prompt__action')?.textContent).toBe('Stop');
      button.click();
      expect(navigator.stop).toHaveBeenCalledWith('pilot');
      expect(navigator.release).not.toHaveBeenCalled();
      expect(navigator.approach).not.toHaveBeenCalled();
      prompt.dispose();
    }
  });

  it('offers the way out once docked', () => {
    const { button, navigator, prompt } = setup({ mode: 'docked', target: 'project/fishai' }, null);
    cleanup = () => prompt.dispose();
    expect(button.hidden).toBe(false);
    expect(button.textContent).toBe('Leave orbit');
    expect(button.querySelector('kbd')?.hidden).toBe(true);
    expect(button.querySelector<HTMLElement>('.dock-prompt__action')?.hidden).toBe(true);
    button.click();
    expect(navigator.release).toHaveBeenCalledWith('pilot');
    // Leaving orbit is no stop: the ship leaves at its orbit's pace, and the assist may hold it.
    expect(navigator.stop).not.toHaveBeenCalled();
    // E never undocks: it is the key for arriving.
    press('KeyE');
    expect(navigator.approach).not.toHaveBeenCalled();
  });

  it('follows the navigator from frame to frame, and cleans up after itself', () => {
    const { button, navigator, prompt, overlay } = setup({ mode: 'flight', target: null }, null);
    navigator.candidate = 'page/about';
    prompt.frameUpdate();
    expect(button.textContent).toBe('EOrbit page/about');
    navigator.candidate = null;
    prompt.frameUpdate();
    expect(button.hidden).toBe(true);

    prompt.dispose();
    expect(overlay.children).toHaveLength(0);
    navigator.candidate = 'page/about';
    press('KeyE');
    expect(navigator.approach).not.toHaveBeenCalled();
  });
});
