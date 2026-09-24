// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  const state = {
    target: -1,
    docked: false,
    prompt: null as ScreenBox | null,
    ship: null as ScreenBox | null,
    eitherSide: false,
  };
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
    ship: () => state.ship,
    eitherSide: () => state.eitherSide,
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
  vi.restoreAllMocks();
});

/**
 * Names as the stylesheet draws them (happy-dom lays nothing out): a 26 px tag at the top of the
 * 44 px box, and the target's tag 12 px longer to the left, to hold its dot.
 */
function drawnTags(): void {
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    if (pseudo !== '::after') return real(element, pseudo);
    const target = element instanceof HTMLElement && element.dataset.state === 'target';
    return { height: '26px', left: target ? '-12px' : '0px' } as CSSStyleDeclaration;
  });
}

/**
 * Where a name's tag is drawn: at the top of its 44 px button below its body, at the bottom above
 * it (`data-side`), and a target's reaching `lead` further left.
 */
function tagOf(button: HTMLButtonElement, tag: number, lead: number) {
  const [x = Number.NaN, y = Number.NaN] = (button.style.transform.match(/-?[\d.]+/g) ?? []).map(
    Number,
  );
  const width = (button.textContent?.length ?? 0) * 7 + 24;
  const top = button.dataset.side === 'above' ? y + 44 - tag : y;
  return { left: x - lead, top, width: width + lead, height: tag };
}

/** How far apart two boxes are, up/down or sideways (whichever is more); negative if they overlap. */
function apart(a: ScreenBox, b: ScreenBox): number {
  return Math.max(
    a.left - (b.left + b.width),
    b.left - (a.left + a.width),
    a.top - (b.top + b.height),
    b.top - (a.top + a.height),
  );
}

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

  it('measures the names again when told their size may have changed (the star map)', () => {
    const { labels, button } = setup(SPREAD);
    cleanup = () => labels.dispose();
    const name = button('FishAI');
    Object.defineProperty(name, 'offsetWidth', { value: 100, configurable: true });
    labels.frameUpdate();
    // Measured once: the new size is not read on every frame...
    expect(name.style.transform).toBe('translate(367px, 442px)');
    // ...but on request, and the name is centred under its body again.
    labels.remeasure();
    labels.frameUpdate();
    expect(name.style.transform).toBe('translate(350px, 442px)');
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

  it('keeps other names off the face of the body the ship is docked at', () => {
    const { labels, screen, state, shown } = setup(SPREAD);
    cleanup = () => labels.dispose();
    state.target = 1;
    state.docked = true;
    // Framed large, and its moon passing in front of it.
    put(screen, [
      [900, 300, 12, 1000],
      [400, 400, 150, 60],
      [420, 330, 6, 50],
      [200, 300, 30, 300],
    ]);
    labels.frameUpdate();
    expect(shown()).toEqual(['Code', 'About']);

    // Past its edge, the moon has its name again.
    screen.x[2] = 620;
    labels.frameUpdate();
    expect(shown()).toEqual(['Code', 'Canadian Fish', 'About']);
  });

  it('on the map, moves a name the ship would be under to above its body, and back', () => {
    const { labels, state, shown, button } = setup(SPREAD);
    cleanup = () => labels.dispose();
    state.eitherSide = true;
    state.target = 1;
    // The ship's marker, parked in the middle of FishAI's usual place (367..433 x 442..486).
    state.ship = { left: 390, top: 450, width: 18, height: 18 };
    labels.frameUpdate();
    expect(shown()).toEqual(['Code', 'FishAI', 'Canadian Fish', 'About']);
    // Above: 400 - 40 - 2 - 44, and CSS is told, to draw the tag at the bottom of the button.
    expect(button('FishAI').style.transform).toBe('translate(367px, 314px)');
    expect(button('FishAI').dataset.side).toBe('above');

    // The ship has gone: under its body again.
    state.ship = { left: 700, top: 650, width: 18, height: 18 };
    labels.frameUpdate();
    expect(button('FishAI').style.transform).toBe('translate(367px, 442px)');
    expect(button('FishAI').dataset.side).toBeUndefined();
  });

  it('glides any other name a little past the ship, and beyond that it makes way', () => {
    // The moon is near the top bar: its name has no room above it (120 - 6 - 2 - 44 < 80).
    const { labels, screen, state, shown, button } = setup(SPREAD);
    cleanup = () => labels.dispose();
    state.eitherSide = true;
    screen.y[2] = 120;
    labels.frameUpdate();
    expect(button('Canadian Fish').style.transform).toBe('translate(542.5px, 128px)');

    // The ship just over the top of the name (to 131): the name glides down to 135, a gap clear.
    state.ship = { left: 591, top: 113, width: 18, height: 18 };
    labels.frameUpdate();
    expect(shown()).toContain('Canadian Fish');
    expect(button('Canadian Fish').style.transform).toBe('translate(542.5px, 135px)');

    // Right over the name: it would have to go 34 px from its body. It makes way instead...
    state.ship = { left: 591, top: 140, width: 18, height: 18 };
    labels.frameUpdate();
    expect(shown()).toEqual(['Code', 'FishAI', 'About']);

    // ...unless it is where the ship is going, or the keyboard is on it: those glide on.
    state.target = 2;
    labels.frameUpdate();
    expect(shown()).toContain('Canadian Fish');
    expect(button('Canadian Fish').style.transform).toBe('translate(542.5px, 162px)');
    state.target = -1;
    labels.frameUpdate();
    expect(shown()).not.toContain('Canadian Fish');
    button('Canadian Fish').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    labels.frameUpdate();
    expect(shown()).toContain('Canadian Fish');
  });

  it('never lays a name over the ship as it circles a body, and does not flicker', () => {
    const { labels, screen, state, button } = setup(SPREAD);
    cleanup = () => labels.dispose();
    state.eitherSide = true;
    state.target = 3; // About, at (200, 300), radius 30: the name is 59 x 44
    const [x, y] = [screen.x[3] ?? 0, screen.y[3] ?? 0];
    let hops = 0;
    let hidden = 0;
    let side = 0;
    for (let lap = 0; lap < 2; lap += 1) {
      for (let step = 0; step < 360; step += 1) {
        const angle = (step * Math.PI) / 180;
        const cx = x + 55 * Math.cos(angle);
        const cy = y + 55 * Math.sin(angle);
        state.ship = { left: cx - 9, top: cy - 9, width: 18, height: 18 };
        labels.frameUpdate();
        const name = button('About');
        if (!('shown' in name.dataset)) {
          hidden += 1;
          continue;
        }
        const tag = tagOf(name, 44, 0);
        expect(tag.left).toBeCloseTo(170.5, 5);
        expect(apart(tag, state.ship), `lap ${lap}, ${step} degrees`).toBeGreaterThan(0);
        const now = tag.top < y ? 1 : 0;
        if (now !== side) hops += 1;
        side = now;
      }
    }
    expect(hidden).toBe(0);
    // Up, then down again, once a lap: never back and forth.
    expect(hops).toBeLessThanOrEqual(4);
  });

  // The station, the satellite and a moon are drawn 3.5 to 4 px in radius on the map, and the
  // ship circles them 4 to 15 px out: its 18 px marker covers both of the places a name has.
  for (const radius of [3.5, 4, 8]) {
    for (const ring of [2, 4.6, 15, 30]) {
      it(`names the body the ship circles, never under it and never gone (r ${radius}, ring ${ring})`, () => {
        drawnTags();
        const { labels, screen, state, button } = setup(SPREAD);
        cleanup = () => labels.dispose();
        state.eitherSide = true;
        state.target = 2; // Canadian Fish, at (600, 380)
        screen.radius[2] = radius;
        labels.frameUpdate(); // marks the target; the next frame measures its longer tag
        const name = button('Canadian Fish');
        let hidden = 0;
        let hops = 0;
        let side = 0;
        let glide = 0;
        for (let step = 0; step < 3 * 720; step += 1) {
          const angle = (step * Math.PI) / 360;
          const cx = 600 + ring * Math.cos(angle);
          const cy = 380 + ring * Math.sin(angle);
          state.ship = { left: cx - 9, top: cy - 9, width: 18, height: 18 };
          labels.frameUpdate();
          if (!('shown' in name.dataset)) {
            hidden += 1;
            continue;
          }
          const tag = tagOf(name, 26, 12);
          // A gap clear of the ship, to the tenth of a pixel the transform is written in.
          expect(apart(tag, state.ship), `step ${step}`).toBeGreaterThanOrEqual(4 - 0.05);
          const now = tag.top < 380 ? 1 : 0;
          if (now !== side) hops += 1;
          side = now;
          const home = now ? 380 - radius - 2 - 26 : 380 + radius + 2;
          glide = Math.max(glide, Math.abs(tag.top - home));
        }
        expect(hidden).toBe(0);
        // At most over and back once a lap, and never far from the body.
        expect(hops).toBeLessThanOrEqual(6);
        expect(glide).toBeLessThanOrEqual(12);
      });
    }
  }

  it('puts a name that has no room below its body above it, on the map only', () => {
    // A phone's map over a bottom sheet: About just above the sheet, the ship circling it close.
    drawnTags();
    const { labels, screen, state, view, button, shown } = setup(SPREAD);
    cleanup = () => labels.dispose();
    view.freeHeight = 0.4; // 320 px free: names end by 312
    screen.x[3] = 118;
    screen.y[3] = 292;
    screen.radius[3] = 8;
    state.target = 3;
    labels.frameUpdate();
    labels.frameUpdate();
    // In flight a name does not hop round its body: no room below, no name.
    expect(shown()).not.toContain('About');

    state.eitherSide = true;
    const name = button('About');
    for (let step = 0; step < 720; step += 1) {
      const angle = (step * Math.PI) / 360;
      const cx = 118 + 3.8 * Math.cos(angle);
      const cy = 292 + 3.8 * Math.sin(angle);
      state.ship = { left: cx - 9, top: cy - 9, width: 18, height: 18 };
      labels.frameUpdate();
      expect('shown' in name.dataset, `step ${step}`).toBe(true);
      const tag = tagOf(name, 26, 12);
      expect(tag.top + tag.height).toBeLessThanOrEqual(292 - 8);
      expect(apart(tag, state.ship)).toBeGreaterThanOrEqual(4 - 0.05);
    }
    // With the ship away, it sits just over the body, as a name below sits just under it.
    state.ship = null;
    labels.frameUpdate();
    expect(tagOf(name, 26, 12).top).toBeCloseTo(292 - 8 - 2 - 26, 5);
  });

  it("keeps names off the page's footer chip in the corner, once told where it is", () => {
    // About's name is 170.5..229.5 x 332..376.
    const { labels, shown } = setup(SPREAD);
    cleanup = () => labels.dispose();
    labels.setFoot({ right: 180, top: 360 });
    labels.frameUpdate();
    expect(shown()).toEqual(['Code', 'FishAI', 'Canadian Fish']);
    labels.setFoot(null);
    labels.frameUpdate();
    expect(shown()).toEqual(['Code', 'FishAI', 'Canadian Fish', 'About']);
  });

  it('on the map, puts a name whose place below is taken above its body instead', () => {
    const { labels, state, shown, button } = setup(SPREAD);
    cleanup = () => labels.dispose();
    state.eitherSide = true;
    // The footer chip over About's usual place (170.5..229.5 x 332..376)...
    labels.setFoot({ right: 180, top: 360 });
    labels.frameUpdate();
    expect(shown()).toEqual(['Code', 'FishAI', 'Canadian Fish', 'About']);
    // ...so it sits above: 300 - 30 - 2 - 44 (no layout here, so the tag is the whole box).
    expect(button('About').style.transform).toBe('translate(170.5px, 224px)');
    // And back below once the chip is gone.
    labels.setFoot(null);
    labels.frameUpdate();
    expect(button('About').style.transform).toBe('translate(170.5px, 332px)');
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
