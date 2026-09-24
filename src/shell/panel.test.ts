// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ABOUT, HOME, showPage } from './page-fixtures';
import { panelStateFor, startPanel, type Panel } from './panel';

const root = document.documentElement;
const button = (name: 'toggle' | 'close' | 'resize'): HTMLElement =>
  document.querySelector<HTMLElement>(`[data-panel-${name}]`) as HTMLElement;

let panel: Panel | undefined;
let onLeave: ReturnType<typeof vi.fn<() => void>>;

/** What the router's swap does: only the children of <main> change, the skeleton stays. */
function swapMainTo(html: string): void {
  (document.getElementById('main') as HTMLElement).innerHTML = html;
}

function start(pathname: string): Panel {
  // happy-dom keeps location where the vitest config put it; tell the panel where we "are".
  panel = startPanel({ homePath: '/', onLeave });
  panel.sync(pathname);
  return panel;
}

beforeEach(() => {
  onLeave = vi.fn<() => void>();
  showPage(HOME);
});

afterEach(() => {
  panel?.dispose();
  panel = undefined;
  sessionStorage.clear();
});

describe('the rule: the URL decides', () => {
  it('is closed on the home page and open everywhere else', () => {
    expect(panelStateFor('/', '/', false)).toBe('closed');
    expect(panelStateFor('/', '/', true)).toBe('open');
    expect(panelStateFor('/projects/fishai/', '/', false)).toBe('open');
    expect(panelStateFor('/projects/fishai/', '/', true)).toBe('open');
  });

  it('writes its state on <html>, where the stylesheet reads it', () => {
    start('/');
    expect(root.dataset.panel).toBe('closed');
    expect(root.dataset.panelHome).toBe('');
    expect(button('toggle').getAttribute('aria-expanded')).toBe('false');

    swapMainTo(ABOUT.main);
    panel?.sync('/about/');
    expect(root.dataset.panel).toBe('open');
    expect(root.dataset.panelHome).toBeUndefined();
  });
});

describe('on the home page', () => {
  it('opens and closes the welcome text from the HUD button, and moves focus with it', () => {
    start('/');
    button('toggle').click();
    expect(root.dataset.panel).toBe('open');
    expect(button('toggle').getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(document.querySelector('main h1'));

    button('close').click();
    expect(root.dataset.panel).toBe('closed');
    expect(document.activeElement).toBe(button('toggle'));
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('opens before "Skip to content" jumps into it', () => {
    start('/');
    document.querySelector<HTMLElement>('.skip-link')?.click();
    expect(root.dataset.panel).toBe('open');
  });

  it('forgets the welcome toggle when the visitor comes back', () => {
    start('/');
    button('toggle').click();
    panel?.sync('/about/');
    panel?.sync('/');
    expect(root.dataset.panel).toBe('closed');
  });

  it('hands focus to the HUD button when arriving home hides what had focus', () => {
    showPage(ABOUT);
    start('/about/');
    button('close').focus();
    swapMainTo(HOME.main);
    panel?.sync('/');
    expect(root.dataset.panel).toBe('closed');
    expect(document.activeElement).toBe(button('toggle'));
  });
});

describe('on any other page', () => {
  beforeEach(() => showPage(ABOUT));

  it('closing means leaving: the router decides where to', () => {
    start('/about/');
    button('close').click();
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(root.dataset.panel).toBe('open');
  });

  it('leaves on Escape, but not from inside a field, and not with a modifier', () => {
    start('/about/');
    document.querySelector('main')?.insertAdjacentHTML('beforeend', '<input id="field" />');
    const press = (target: EventTarget, init: KeyboardEventInit = {}): void => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, ...init }));
    };

    press(document.getElementById('field') as HTMLElement);
    press(document.body, { shiftKey: true });
    expect(onLeave).not.toHaveBeenCalled();

    press(document.body);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('does nothing on Escape when there is no panel to close', () => {
    showPage(HOME);
    start('/');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onLeave).not.toHaveBeenCalled();
    expect(root.dataset.panel).toBe('closed');
  });
});

describe('the bottom sheet', () => {
  it('expands and shrinks, says so, and remembers for the session', () => {
    start('/about/');
    expect(root.dataset.panelSize).toBe('half');

    button('resize').click();
    expect(root.dataset.panelSize).toBe('full');
    expect(button('resize').textContent).toBe('Shrink');
    // Its name says what it does; a pressed state as well would contradict it ("Shrink, pressed").
    expect(button('resize').hasAttribute('aria-pressed')).toBe(false);

    panel?.dispose();
    expect(root.dataset.panelSize).toBeUndefined();
    start('/about/');
    expect(root.dataset.panelSize).toBe('full');
  });
});

describe('dispose', () => {
  it('lets go of the page: no attributes, no listeners', () => {
    showPage(ABOUT);
    start('/about/');
    panel?.dispose();
    expect(root.dataset.panel).toBeUndefined();
    button('close').click();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onLeave).not.toHaveBeenCalled();
  });
});
