// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { barReach, mirrorInset, panelInset, watchPanelInset, type PanelInset } from './panel-inset';

const desktop = { width: 1280, height: 800 };
const phone = { width: 390, height: 844 };
/** The column on the right of a desktop window, and the sheet at the bottom of a phone. */
const column = { offsetLeft: 784, offsetTop: 76, offsetWidth: 480, offsetHeight: 708 };
const sheet = { offsetLeft: 0, offsetTop: 354, offsetWidth: 390, offsetHeight: 490 };

describe('panel inset', () => {
  it('covers the right of a wide window, from the left edge of the panel', () => {
    expect(panelInset(column, true, false, desktop)).toEqual({
      top: 0,
      right: 496,
      bottom: 0,
      frameTop: 0,
    });
  });

  it('covers the bottom of a narrow window, from the top edge of the sheet', () => {
    expect(panelInset(sheet, true, true, phone)).toEqual({
      top: 0,
      right: 0,
      bottom: 490,
      frameTop: 0,
    });
  });

  it('covers nothing when the panel is closed, or is not laid out at all (plain mode)', () => {
    expect(panelInset(column, false, false, desktop)).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      frameTop: 0,
    });
    expect(
      panelInset(
        { offsetLeft: 0, offsetTop: 0, offsetWidth: 0, offsetHeight: 0 },
        true,
        false,
        desktop,
      ),
    ).toEqual({ top: 0, right: 0, bottom: 0, frameTop: 0 });
  });

  it('passes on how far down the top bar reaches, panel or no panel', () => {
    expect(panelInset(sheet, true, true, phone, 105)).toEqual({
      top: 105,
      right: 0,
      bottom: 490,
      frameTop: 0,
    });
    expect(panelInset(sheet, false, true, phone, 105)).toEqual({
      top: 105,
      right: 0,
      bottom: 0,
      frameTop: 0,
    });
  });

  it('leaves the solid top of a phone out of the frame, only while the sheet is up', () => {
    // The bar reaches 105 px down, and the row of the Map button ends 56 px below that.
    expect(panelInset(sheet, true, true, phone, 105, 161)).toEqual({
      top: 105,
      right: 0,
      bottom: 490,
      frameTop: 161,
    });
    expect(panelInset(sheet, false, true, phone, 105, 161).frameTop).toBe(0);
    // A side panel: the bar is a few chips over the sky, which the camera may use.
    expect(panelInset(column, true, false, desktop, 64, 120).frameTop).toBe(0);
  });

  it('measures the top bar by what can be pressed in it, not by its padding', () => {
    const control = (width: number, bottom: number) => ({
      getBoundingClientRect: () => ({ width, bottom }),
    });
    // The wordmark, a button that is not displayed on this page, and the links on a second row.
    expect(barReach([control(80, 57), control(0, 0), control(60, 104.6), control(70, 104.6)])).toBe(
      105,
    );
    expect(barReach([])).toBe(0);
  });

  it('never goes negative for a panel that is off the screen', () => {
    const away = { offsetLeft: 2000, offsetTop: 2000, offsetWidth: 480, offsetHeight: 700 };
    expect(panelInset(away, true, false, desktop)).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      frameTop: 0,
    });
    expect(panelInset(away, true, true, phone)).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      frameTop: 0,
    });
  });
});

describe('the inset, for the stylesheet', () => {
  it('goes on the root as custom properties, and comes off again', () => {
    const root = document.createElement('div');
    mirrorInset(root, { top: 64, right: 496, bottom: 0, frameTop: 0 });
    expect(root.style.getPropertyValue('--panel-inset-top')).toBe('64px');
    expect(root.style.getPropertyValue('--panel-inset-right')).toBe('496px');
    expect(root.style.getPropertyValue('--panel-inset-bottom')).toBe('0px');
    mirrorInset(root, null);
    expect(root.style.getPropertyValue('--panel-inset-top')).toBe('');
    expect(root.style.getPropertyValue('--panel-inset-right')).toBe('');
    expect(root.style.getPropertyValue('--panel-inset-bottom')).toBe('');
  });
});

describe('watching the panel', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    delete document.documentElement.dataset.panel;
  });

  /** Let the observers deliver. */
  const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

  function layOut(): void {
    document.body.innerHTML = '<main class="panel"></main>';
    const panel = document.querySelector('.panel');
    for (const [key, value] of Object.entries(column)) {
      Object.defineProperty(panel, key, { value, configurable: true });
    }
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  }

  it('reports at once, then only what changed, and stops when told to', async () => {
    layOut();
    document.documentElement.dataset.panel = 'open';
    const seen: [PanelInset, boolean][] = [];
    const stop = watchPanelInset((inset, first) => seen.push([inset, first]));
    expect(seen).toEqual([[{ top: 0, right: 496, bottom: 0, frameTop: 0 }, true]]);

    document.documentElement.dataset.panel = 'closed';
    await settle();
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual([{ top: 0, right: 0, bottom: 0, frameTop: 0 }, false]);

    // A resize that changes nothing is not news.
    window.dispatchEvent(new Event('resize'));
    await settle();
    expect(seen).toHaveLength(2);

    stop();
    document.documentElement.dataset.panel = 'open';
    await settle();
    expect(seen).toHaveLength(2);
  });

  it('has nothing to watch on a page without a panel', () => {
    const onChange = vi.fn();
    watchPanelInset(onChange)();
    expect(onChange).not.toHaveBeenCalled();
  });
});
