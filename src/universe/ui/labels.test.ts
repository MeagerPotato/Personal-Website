// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { ScreenBox } from '../sim/declutter';
import { createScreenMap, type ScreenMap } from '../sim/screen';
import { Labels } from './Labels';

const PARAMS = {
  offsetPx: 2,
  minVisiblePx: 1.5,
  edgePx: 8,
  topPx: 80,
  gapPx: 4,
  keepPx: 8,
  max: 14,
};

const BODIES = [
  { title: 'Code', kind: 'sun' },
  { title: 'FishAI', kind: 'planet' },
  { title: 'Canadian Fish', kind: 'moon' },
  { title: 'About', kind: 'home' },
] as const;

type Row = readonly [x: number, y: number, radius: number, depth: number];

function put(screen: ScreenMap, rows: readonly Row[]): void {
  screen.count = rows.length;
  rows.forEach(([x, y, radius, depth], i) => {
    screen.x[i] = x;
    screen.y[i] = y;
    screen.radius[i] = radius;
    screen.depth[i] = depth;
  });
}

function setup(rows: readonly Row[]) {
  document.body.innerHTML = '<div id="overlay"></div>';
  const overlay = document.getElementById('overlay') as HTMLElement;
  const screen = createScreenMap(BODIES.length);
  put(screen, rows);
  const state = { target: -1, docked: false, prompt: null as ScreenBox | null };
  const view = { freeWidth: 1, freeHeight: 1 };
  const picked: number[] = [];
  const labels = new Labels({
    overlay,
    screen,
    bodies: BODIES,
    params: PARAMS,
    view,
    target: () => state.target,
    docked: () => state.docked,
    onPick: (row) => picked.push(row),
    obstacles: [() => state.prompt],
  });
  labels.resize({ width: 1200, height: 800, pixelRatio: 1 });
  labels.frameUpdate();
  const button = (title: string): HTMLButtonElement =>
    [...overlay.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === title,
    ) as HTMLButtonElement;
  const shown = (): string[] =>
    [...overlay.querySelectorAll<HTMLElement>('button[data-shown]')].map(
      (candidate) => candidate.textContent ?? '',
    );
  return { overlay, screen, state, view, picked, labels, button, shown };
}

/** Apart from each other, all in view: the sun far off, a planet with its moon, the home planet. */
const SPREAD: readonly Row[] = [
  [900, 300, 12, 1000],
  [400, 400, 40, 120],
  [600, 380, 6, 140],
  [200, 300, 30, 300],
];

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe('Labels', () => {
  it('is one real button per body, in a group that says what pressing them does', () => {
    const { overlay, labels, shown } = setup(SPREAD);
    cleanup = () => labels.dispose();
    const group = overlay.querySelector('[role="group"]');
    expect(group?.getAttribute('aria-label')).toBe('Fly to');
    const buttons = [...overlay.querySelectorAll('button')];
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Code',
      'FishAI',
      'Canadian Fish',
      'About',
    ]);
    expect(buttons.every((button) => button.type === 'button')).toBe(true);
    expect(buttons.map((button) => button.dataset.kind)).toEqual(['sun', 'planet', 'moon', 'home']);
    expect(shown()).toEqual(['Code', 'FishAI', 'Canadian Fish', 'About']);
  });

  it('puts each name under its body, centred', () => {
    const { labels, button } = setup(SPREAD);
    cleanup = () => labels.dispose();
    // No layout here, so a name is taken to be 7 px a letter plus 24: "FishAI" is 66 px wide.
    expect(button('FishAI').style.transform).toBe('translate(367px, 442px)');
    expect(button('Code').style.transform).toBe(`translate(${900 - 26}px, 314px)`);
  });

  it('follows the bodies from frame to frame', () => {
    const { labels, screen, button } = setup(SPREAD);
    cleanup = () => labels.dispose();
    screen.x[1] = 410.04;
    screen.y[1] = 395.5;
    labels.frameUpdate();
    expect(button('FishAI').style.transform).toBe('translate(377px, 437.5px)');
  });

  it('names nothing that is behind the camera, too small to see, or not wholly in view', () => {
    const { labels, shown } = setup([
      [900, 300, 12, -50],
      [400, 400, 1, 4000],
      [1190, 380, 6, 140],
      [200, 60, 10, 300],
    ]);
    cleanup = () => labels.dispose();
    // Row 3 would sit under the top bar: 60 + 10 + 2 is above topPx.
    expect(shown()).toEqual([]);
  });

  it('keeps names out from under the info panel', () => {
    const { labels, view, shown } = setup(SPREAD);
    cleanup = () => labels.dispose();
    view.freeWidth = 0.6; // a side panel over the right 40%: 720 px are free
    labels.frameUpdate();
    expect(shown()).toEqual(['FishAI', 'Canadian Fish', 'About']);
    view.freeWidth = 1;
    view.freeHeight = 0.5; // a bottom sheet: 400 px are free
    labels.frameUpdate();
    expect(shown()).toEqual(['Code', 'About']);
  });

  it('keeps names off a top bar that is taller than usual, once told how tall', () => {
    // Just under the usual bar: 70 + 10 + 2 = 82 is below topPx (80), so the name shows...
    const { labels, shown } = setup([[200, 70, 10, 300]]);
    cleanup = () => labels.dispose();
    expect(shown()).toEqual(['Code']);
    // ...but a phone's bar is two rows: 104 px, and names keep their distance from its edge too.
    labels.setTop(104);
    labels.frameUpdate();
    expect(shown()).toEqual([]);
    labels.setTop(70);
    labels.frameUpdate();
    expect(shown()).toEqual(['Code']);
  });

  it('keeps names off the other things that can be pressed, even the name of where it is going', () => {
    const { labels, state, shown } = setup(SPREAD);
    cleanup = () => labels.dispose();
    state.target = 1;
    // The dock prompt, right where FishAI's name is (367..433 x 442..486).
    state.prompt = { left: 300, top: 460, width: 220, height: 44 };
    labels.frameUpdate();
    expect(shown()).toEqual(['Code', 'Canadian Fish', 'About']);
    state.prompt = null;
    labels.frameUpdate();
    expect(shown()).toEqual(['Code', 'FishAI', 'Canadian Fish', 'About']);
  });

  it('where names would touch, shows the system before the planet before the moon', () => {
    const { labels, shown } = setup([
      [500, 300, 12, 1000],
      [510, 302, 8, 990],
      [505, 301, 3, 985],
      [200, 300, 30, 300],
    ]);
    cleanup = () => labels.dispose();
    expect(shown()).toEqual(['Code', 'About']);
  });

  it('shows where the ship is going before anything else, and marks it', () => {
    const { labels, state, shown, button } = setup([
      [500, 300, 12, 1000],
      [510, 302, 8, 990],
      [505, 301, 3, 985],
      [200, 300, 30, 300],
    ]);
    cleanup = () => labels.dispose();
    state.target = 2;
    labels.frameUpdate();
    expect(shown()).toEqual(['Canadian Fish', 'About']);
    expect(button('Canadian Fish').dataset.state).toBe('target');

    state.target = -1;
    labels.frameUpdate();
    expect(button('Canadian Fish').dataset.state).toBeUndefined();
    expect(shown()).toEqual(['Code', 'About']);
  });

  it('does not name the body the ship is docked at: its page is open', () => {
    const { labels, state, shown } = setup(SPREAD);
    cleanup = () => labels.dispose();
    state.target = 1;
    state.docked = true;
    labels.frameUpdate();
    expect(shown()).toEqual(['Code', 'Canadian Fish', 'About']);
  });

  it('never takes a name away from under the keyboard', () => {
    const { labels, screen, shown, button } = setup(SPREAD);
    cleanup = () => labels.dispose();
    // Someone has tabbed to the moon's name...
    button('Canadian Fish').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    // ...and the sun drifts right behind it, with a name that would normally win.
    screen.x[0] = 605;
    screen.y[0] = 375;
    labels.frameUpdate();
    expect(shown()).toEqual(['FishAI', 'Canadian Fish', 'About']);

    button('Canadian Fish').dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    labels.frameUpdate();
    expect(shown()).toEqual(['Code', 'FishAI', 'About']);
  });

  it('tells whoever listens which body was pressed, and cleans up after itself', () => {
    const { overlay, labels, picked, button } = setup(SPREAD);
    button('FishAI').click();
    button('About').click();
    expect(picked).toEqual([1, 3]);

    labels.dispose();
    expect(overlay.children).toHaveLength(0);
  });
});
