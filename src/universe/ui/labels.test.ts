// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Frame } from '../core/Engine';
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
  dwellSec: 1,
};

/**
 * The engine's frames, one after another: `tick()` is the next, a 60th of a second on, and
 * `tick(seconds)` one that long after the last.
 */
let elapsed = 0;
function tick(seconds = 1 / 60): Frame {
  elapsed += seconds;
  return { elapsed, dt: Math.min(seconds, 0.1), alpha: 1, simTime: elapsed };
}

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
    onMap: false,
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
    onMap: () => state.onMap,
  });
  labels.resize({ width: 1200, height: 800, pixelRatio: 1 });
  labels.frameUpdate(tick());
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
 * Where a name's box is drawn (CSS px, to the tenth), and where its body is: the transform moves
 * it to its body, then from there to its place, `translate(body) translate(place)`.
 */
function drawn(name: HTMLElement): { x: number; y: number; body: { x: number; y: number } } {
  const [bodyX = Number.NaN, bodyY = Number.NaN, dx = Number.NaN, dy = Number.NaN] = (
    name.style.transform.match(/-?[\d.]+/g) ?? []
  ).map(Number);
  return {
    x: Math.round((bodyX + dx) * 10) / 10,
    y: Math.round((bodyY + dy) * 10) / 10,
    body: { x: bodyX, y: bodyY },
  };
}

/**
 * Where a name's tag is drawn: at the top of its 44 px button below its body, at the bottom above
 * it (`data-side`), and a target's reaching `lead` further left.
 */
function tagOf(button: HTMLButtonElement, tag: number, lead: number) {
  const { x, y } = drawn(button);
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

  it('says after the name of planned work that it is planned, seen and heard', () => {
    document.body.innerHTML = '<div id="overlay"></div>';
    const overlay = document.getElementById('overlay') as HTMLElement;
    const screen = createScreenMap(3);
    put(screen, SPREAD.slice(0, 3));
    const picked: number[] = [];
    const labels = new Labels({
      overlay,
      screen,
      bodies: [
        { title: 'Research', kind: 'sun' },
        { title: 'Sports Analysis', kind: 'planet', planned: true },
        { title: 'Kalshi', kind: 'moon', planned: true },
      ],
      params: PARAMS,
      view: { freeWidth: 1, freeHeight: 1 },
      target: () => -1,
      docked: () => false,
      onPick: (row) => picked.push(row),
    });
    cleanup = () => labels.dispose();
    labels.resize({ width: 1200, height: 800, pixelRatio: 1 });
    labels.frameUpdate(tick());
    const [sun, planet, moon] = [...overlay.querySelectorAll('button')];
    if (!sun || !planet || !moon) throw new Error('no names');
    // The name it is known by, read out: "Sports Analysis, Planned".
    expect(planet.textContent).toBe('Sports Analysis, Planned');
    expect(moon.textContent).toBe('Kalshi, Planned');
    expect([sun, planet, moon].map((button) => button.dataset.planned)).toEqual([
      undefined,
      '',
      '',
    ]);
    // Seen: the name, then the note; the comma is only heard.
    const note = planet.querySelector('.body-label__note');
    expect(note?.textContent).toBe(', Planned');
    expect(note?.querySelector('.body-label__sep')?.textContent).toBe(', ');
    expect(sun.querySelector('.body-label__note')).toBeNull();
    // The button is a flex box, whose children a browser reads as blocks, with spaces round
    // them ("Sports Analysis , Planned"): the name and its note are ONE child, inline together.
    expect([...planet.childNodes]).toEqual([planet.querySelector('.body-label__name')]);
    expect(note?.parentElement?.className).toBe('body-label__name');
    expect(sun.textContent).toBe('Research');
    // Pressing the note is pressing the name.
    note?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(picked).toEqual([1]);
  });

  it('puts each name under its body, centred', () => {
    const { labels, button } = setup(SPREAD);
    cleanup = () => labels.dispose();
    // No layout here, so a name is taken to be 7 px a letter plus 24: "FishAI" is 66 px wide.
    expect(drawn(button('FishAI'))).toMatchObject({ x: 367, y: 442 });
    expect(drawn(button('Code'))).toMatchObject({ x: 900 - 26, y: 314 });
  });

  it('measures the names again when told their size may have changed (the star map)', () => {
    const { labels, button } = setup(SPREAD);
    cleanup = () => labels.dispose();
    const name = button('FishAI');
    Object.defineProperty(name, 'offsetWidth', { value: 100, configurable: true });
    labels.frameUpdate(tick());
    // Measured once: the new size is not read on every frame...
    expect(drawn(name)).toMatchObject({ x: 367, y: 442 });
    // ...but on request, and the name is centred under its body again.
    labels.remeasure();
    labels.frameUpdate(tick());
    expect(drawn(name)).toMatchObject({ x: 350, y: 442 });
  });

  it('follows the bodies from frame to frame', () => {
    const { labels, screen, button } = setup(SPREAD);
    cleanup = () => labels.dispose();
    screen.x[1] = 410.04;
    screen.y[1] = 395.5;
    labels.frameUpdate(tick());
    expect(drawn(button('FishAI'))).toMatchObject({ x: 377, y: 437.5 });
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
    labels.frameUpdate(tick());
    expect(shown()).toEqual(['FishAI', 'Canadian Fish', 'About']);
    view.freeWidth = 1;
    view.freeHeight = 0.5; // a bottom sheet: 400 px are free
    labels.frameUpdate(tick());
    expect(shown()).toEqual(['Code', 'About']);
  });

  it('keeps names off a top bar that is taller than usual, once told how tall', () => {
    // Just under the usual bar: 70 + 10 + 2 = 82 is below topPx (80), so the name shows...
    const { labels, shown } = setup([[200, 70, 10, 300]]);
    cleanup = () => labels.dispose();
    expect(shown()).toEqual(['Code']);
    // ...but a phone's bar is two rows: 104 px, and names keep their distance from its edge too.
    labels.setTop(104);
    labels.frameUpdate(tick());
    expect(shown()).toEqual([]);
    labels.setTop(70);
    labels.frameUpdate(tick());
    expect(shown()).toEqual(['Code']);
  });

  it('keeps names off the other things that can be pressed, even the name of where it is going', () => {
    const { labels, state, shown } = setup(SPREAD);
    cleanup = () => labels.dispose();
    state.target = 1;
    // The dock prompt, right where FishAI's name is (367..433 x 442..486).
    state.prompt = { left: 300, top: 460, width: 220, height: 44 };
    labels.frameUpdate(tick());
    expect(shown()).toEqual(['Code', 'Canadian Fish', 'About']);
    state.prompt = null;
    labels.frameUpdate(tick());
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
    labels.frameUpdate(tick());
    expect(shown()).toEqual(['Canadian Fish', 'About']);
    expect(button('Canadian Fish').dataset.state).toBe('target');

    state.target = -1;
    labels.frameUpdate(tick());
    expect(button('Canadian Fish').dataset.state).toBeUndefined();
    expect(shown()).toEqual(['Code', 'About']);
  });

  it('does not name the body the ship is docked at: its page is open', () => {
    const { labels, state, shown } = setup(SPREAD);
    cleanup = () => labels.dispose();
    state.target = 1;
    state.docked = true;
    labels.frameUpdate(tick());
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
    labels.frameUpdate(tick());
    expect(shown()).toEqual(['Code', 'About']);

    // Past its edge, the moon has its name again.
    screen.x[2] = 620;
    labels.frameUpdate(tick());
    expect(shown()).toEqual(['Code', 'Canadian Fish', 'About']);
  });

  it('on the map, moves a name the ship would be under to above its body, and back', () => {
    const { labels, state, shown, button } = setup(SPREAD);
    cleanup = () => labels.dispose();
    state.onMap = true;
    state.target = 1;
    // The ship's marker, parked in the middle of FishAI's usual place (367..433 x 442..486).
    state.ship = { left: 390, top: 450, width: 18, height: 18 };
    labels.frameUpdate(tick());
    expect(shown()).toEqual(['Code', 'FishAI', 'Canadian Fish', 'About']);
    // Above: 400 - 40 - 2 - 44, and CSS is told, to draw the tag at the bottom of the button.
    expect(drawn(button('FishAI'))).toMatchObject({ x: 367, y: 314 });
    expect(button('FishAI').dataset.side).toBe('above');

    // The ship has gone: under its body again.
    state.ship = { left: 700, top: 650, width: 18, height: 18 };
    labels.frameUpdate(tick());
    expect(drawn(button('FishAI'))).toMatchObject({ x: 367, y: 442 });
    expect(button('FishAI').dataset.side).toBeUndefined();
  });

  it('as the map closes, keeps a name that showed there as patiently as one that showed in flight', () => {
    const { labels, state, shown, button } = setup(SPREAD);
    cleanup = () => labels.dispose();
    // The prompt right over FishAI's place below its body (367..433 x 442..486): in flight it has
    // no name; on the map it goes above.
    state.prompt = { left: 360, top: 450, width: 80, height: 30 };
    labels.frameUpdate(tick());
    expect(shown()).not.toContain('FishAI');
    state.onMap = true;
    labels.frameUpdate(tick());
    expect(button('FishAI').dataset.side).toBe('above');
    // The map closes as the prompt moves to 2 px under that place: inside the gap, which a name
    // that waits needs, but not a keep inside it, which one that shows may come. FishAI showed:
    // under its body again, and named.
    state.prompt = { left: 360, top: 488, width: 80, height: 30 };
    state.onMap = false;
    labels.frameUpdate(tick());
    expect(shown()).toContain('FishAI');
    expect(drawn(button('FishAI'))).toMatchObject({ x: 367, y: 442 });
    expect(button('FishAI').dataset.side).toBeUndefined();
  });

  it('glides any other name a little past the ship, and beyond that it makes way', () => {
    // The moon is near the top bar: its name has no room above it (120 - 6 - 2 - 44 < 80).
    const { labels, screen, state, shown, button } = setup(SPREAD);
    cleanup = () => labels.dispose();
    state.onMap = true;
    screen.y[2] = 120;
    labels.frameUpdate(tick());
    expect(drawn(button('Canadian Fish'))).toMatchObject({ x: 542.5, y: 128 });

    // The ship just over the top of the name (to 131): the name glides down to 135, a gap clear.
    state.ship = { left: 591, top: 113, width: 18, height: 18 };
    labels.frameUpdate(tick());
    expect(shown()).toContain('Canadian Fish');
    expect(drawn(button('Canadian Fish'))).toMatchObject({ x: 542.5, y: 135 });

    // Right over the name: it would have to go 34 px from its body. It makes way instead...
    state.ship = { left: 591, top: 140, width: 18, height: 18 };
    labels.frameUpdate(tick());
    expect(shown()).toEqual(['Code', 'FishAI', 'About']);

    // ...unless it is where the ship is going, or the keyboard is on it: those glide on.
    state.target = 2;
    labels.frameUpdate(tick());
    expect(shown()).toContain('Canadian Fish');
    expect(drawn(button('Canadian Fish'))).toMatchObject({ x: 542.5, y: 162 });
    state.target = -1;
    labels.frameUpdate(tick());
    expect(shown()).not.toContain('Canadian Fish');
    button('Canadian Fish').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    labels.frameUpdate(tick());
    expect(shown()).toContain('Canadian Fish');
  });

  it('never lays a name over the ship as it circles a body, and does not flicker', () => {
    const { labels, screen, state, button } = setup(SPREAD);
    cleanup = () => labels.dispose();
    state.onMap = true;
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
        labels.frameUpdate(tick());
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
        state.onMap = true;
        state.target = 2; // Canadian Fish, at (600, 380)
        screen.radius[2] = radius;
        labels.frameUpdate(tick()); // marks the target; the next frame measures its longer tag
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
          labels.frameUpdate(tick());
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
    labels.frameUpdate(tick());
    labels.frameUpdate(tick());
    // In flight a name does not hop round its body: no room below, no name.
    expect(shown()).not.toContain('About');

    state.onMap = true;
    const name = button('About');
    for (let step = 0; step < 720; step += 1) {
      const angle = (step * Math.PI) / 360;
      const cx = 118 + 3.8 * Math.cos(angle);
      const cy = 292 + 3.8 * Math.sin(angle);
      state.ship = { left: cx - 9, top: cy - 9, width: 18, height: 18 };
      labels.frameUpdate(tick());
      expect('shown' in name.dataset, `step ${step}`).toBe(true);
      const tag = tagOf(name, 26, 12);
      expect(tag.top + tag.height).toBeLessThanOrEqual(292 - 8);
      expect(apart(tag, state.ship)).toBeGreaterThanOrEqual(4 - 0.05);
    }
    // With the ship away, it sits just over the body, as a name below sits just under it.
    state.ship = null;
    labels.frameUpdate(tick());
    expect(tagOf(name, 26, 12).top).toBeCloseTo(292 - 8 - 2 - 26, 5);
  });

  it("keeps names off the page's footer chip in the corner, once told where it is", () => {
    // About's name is 170.5..229.5 x 332..376.
    const { labels, shown } = setup(SPREAD);
    cleanup = () => labels.dispose();
    labels.setFoot({ right: 180, top: 360 });
    labels.frameUpdate(tick());
    expect(shown()).toEqual(['Code', 'FishAI', 'Canadian Fish']);
    labels.setFoot(null);
    labels.frameUpdate(tick());
    expect(shown()).toEqual(['Code', 'FishAI', 'Canadian Fish', 'About']);
  });

  it('on the map, puts a name whose place below is taken above its body instead', () => {
    const { labels, state, shown, button } = setup(SPREAD);
    cleanup = () => labels.dispose();
    state.onMap = true;
    // The footer chip over About's usual place (170.5..229.5 x 332..376)...
    labels.setFoot({ right: 180, top: 360 });
    labels.frameUpdate(tick());
    expect(shown()).toEqual(['Code', 'FishAI', 'Canadian Fish', 'About']);
    // ...so it sits above: 300 - 30 - 2 - 44 (no layout here, so the tag is the whole box).
    expect(drawn(button('About'))).toMatchObject({ x: 170.5, y: 224 });
    // And back below once the chip is gone: not at once (it has only just moved, and makes no
    // other move of its own for a while, `dwellSec`), but a second later.
    labels.setFoot(null);
    labels.frameUpdate(tick());
    expect(drawn(button('About'))).toMatchObject({ x: 170.5, y: 224 });
    labels.frameUpdate(tick(1));
    expect(drawn(button('About'))).toMatchObject({ x: 170.5, y: 332 });
  });

  it('moves each name to its body, then to its place: the page itself says where the body is', () => {
    const { labels, screen, state, button } = setup(SPREAD);
    cleanup = () => labels.dispose();
    expect(drawn(button('FishAI'))).toEqual({ x: 367, y: 442, body: { x: 400, y: 400 } });
    // Wherever the name goes (here above, on the map, with the footer chip below it).
    state.onMap = true;
    labels.setFoot({ right: 180, top: 360 });
    screen.x[3] = 200.04;
    labels.frameUpdate(tick());
    expect(drawn(button('About'))).toEqual({ x: 170.5, y: 224, body: { x: 200, y: 300 } });
  });

  it('on the map, slides a name at the edge of the view along its body, where in flight it hides', () => {
    drawnTags();
    const { labels, screen, state, button, shown } = setup(SPREAD);
    cleanup = () => labels.dispose();
    // Code's name is 52 px wide; centred under a sun 30 px from the right edge (1200), it would
    // cross the 8 px the names keep from it.
    screen.x[0] = 1170;
    labels.frameUpdate(tick());
    expect(shown()).not.toContain('Code');

    state.onMap = true;
    labels.frameUpdate(tick());
    expect(shown()).toContain('Code');
    // As far right as it may go, and still under its sun: the sun is over its tag, past the tag's
    // round end (13 px, half the tag's height).
    const at = drawn(button('Code'));
    expect(at).toMatchObject({ x: 1200 - 8 - 52, y: 314 });
    expect(at.body.x).toBeGreaterThanOrEqual(at.x + 13);
    expect(at.body.x).toBeLessThanOrEqual(at.x + 52 - 13);
    expect(button('Code').dataset.side).toBeUndefined();

    // It stays there as long as the sun is over its tag, past that round end (to 1179)...
    screen.x[0] = 1178;
    labels.frameUpdate(tick());
    expect(drawn(button('Code'))).toMatchObject({ x: 1140, y: 314 });
    expect(button('Code').dataset.side).toBeUndefined();

    // ...and too close to the edge for that, it goes beside its sun instead: to the left, where
    // there is room, in line with the sun, 2 px off its disc.
    screen.x[0] = 1186;
    labels.frameUpdate(tick());
    expect(shown()).toContain('Code');
    expect(button('Code').dataset.side).toBe('left');
    expect(drawn(button('Code'))).toMatchObject({ x: 1186 - 12 - 2 - 52, y: 300 - 22 });

    // A name that is not slid there already takes that place only with room to spare (the sun a
    // keep, 8 px, further in than the round end): so none comes and goes as its body drifts by
    // a pixel at the edge. At 1178 it goes beside its sun...
    // (Both hidden in flight first: there a name at the edge does not slide.)
    const fresh = setup(SPREAD);
    labels.dispose();
    cleanup = () => fresh.labels.dispose();
    fresh.screen.x[0] = 1178;
    fresh.labels.frameUpdate(tick());
    fresh.state.onMap = true;
    fresh.labels.frameUpdate(tick());
    expect(fresh.button('Code').dataset.side).toBe('left');
    // ...and at 1171 it slides.
    const again = setup(SPREAD);
    fresh.labels.dispose();
    cleanup = () => again.labels.dispose();
    again.screen.x[0] = 1171;
    again.labels.frameUpdate(tick());
    again.state.onMap = true;
    again.labels.frameUpdate(tick());
    expect(again.button('Code').dataset.side).toBeUndefined();
    expect(drawn(again.button('Code'))).toMatchObject({ x: 1140, y: 314 });

    // The name of where the ship is going is placed first and never moved for another: it needs
    // no room to spare, and at 1178 slides at once.
    const going = setup(SPREAD);
    again.labels.dispose();
    cleanup = () => going.labels.dispose();
    going.state.target = 0;
    going.screen.x[0] = 1178;
    going.labels.frameUpdate(tick());
    going.state.onMap = true;
    going.labels.frameUpdate(tick());
    expect(going.shown()).toContain('Code');
    expect(going.button('Code').dataset.side).toBeUndefined();
  });

  it('on the map, goes back from reaching along its body to under its middle only with room to spare', () => {
    drawnTags();
    // Code's sun 22 px from the right edge, the dock prompt beside it on the left: its name cannot
    // slide under it (not with room to spare: the test above) nor go beside it. It reaches left
    // along it, the sun over the right end of its tag.
    // (Hidden in flight first: there a name at the edge does not slide.)
    const { labels, screen, state, button } = setup(SPREAD);
    cleanup = () => labels.dispose();
    state.prompt = { left: 1100, top: 260, width: 60, height: 36 };
    screen.x[0] = 1178;
    labels.frameUpdate(tick());
    state.onMap = true;
    labels.frameUpdate(tick());
    expect(button('Code').dataset.side).toBeUndefined();
    expect(drawn(button('Code'))).toMatchObject({ x: 1178 + 13 - 52, y: 314 });
    // A pixel further in, it could slide under its middle as one there already may (to 1179),
    // but not with a keep to spare: it stays where it is, a while on...
    labels.frameUpdate(tick(1));
    screen.x[0] = 1177;
    labels.frameUpdate(tick());
    expect(drawn(button('Code'))).toMatchObject({ x: 1177 + 13 - 52, y: 314 });
    // ...and goes back once it has that room (to 1171).
    screen.x[0] = 1171;
    labels.frameUpdate(tick());
    expect(drawn(button('Code'))).toMatchObject({ x: 1140, y: 314 });
  });

  it('on the map, puts a name with no room below its body or above it beside it, the way in first', () => {
    const { labels, screen, state, button, shown } = setup(SPREAD);
    cleanup = () => labels.dispose();
    // Something that can be pressed, over FishAI and above and below it (its name is 66 px wide,
    // under a planet of 40 px radius), and not beside it.
    state.prompt = { left: 360, top: 300, width: 76, height: 200 };
    labels.frameUpdate(tick());
    expect(shown()).not.toContain('FishAI');

    state.onMap = true;
    labels.frameUpdate(tick());
    expect(shown()).toContain('FishAI');
    // To the right: towards the middle of the view, the planet being left of it.
    expect(button('FishAI').dataset.side).toBe('right');
    expect(drawn(button('FishAI'))).toMatchObject({ x: 400 + 40 + 2, y: 400 - 22 });

    // Where it is, it stays, as long as it may: the planet moves right of the middle, and its name
    // stays on the right, though the way in is now the left.
    screen.x[1] = 800;
    state.prompt = { left: 764, top: 300, width: 76, height: 200 };
    labels.frameUpdate(tick());
    expect(button('FishAI').dataset.side).toBe('right');
    // And under it again once there is room there (and to spare: it does not hop back and forth),
    // and it has shown a while where it is (`dwellSec`: it appeared only a moment ago).
    state.prompt = null;
    labels.frameUpdate(tick());
    expect(button('FishAI').dataset.side).toBe('right');
    labels.frameUpdate(tick(1));
    expect(button('FishAI').dataset.side).toBeUndefined();
    expect(drawn(button('FishAI'))).toMatchObject({ x: 800 - 33, y: 442 });

    // A name that appears right of the middle of the view goes to the left first.
    const fresh = setup(SPREAD);
    labels.dispose();
    cleanup = () => fresh.labels.dispose();
    fresh.state.onMap = true;
    fresh.screen.x[1] = 800;
    fresh.state.prompt = { left: 764, top: 300, width: 76, height: 200 };
    fresh.labels.frameUpdate(tick());
    expect(fresh.button('FishAI').dataset.side).toBe('left');
    expect(drawn(fresh.button('FishAI'))).toMatchObject({ x: 800 - 40 - 2 - 66, y: 400 - 22 });
  });

  it('on the map, with room on both sides of a body and nowhere else, names it on the side towards the middle', () => {
    const { labels, state, button, shown } = setup(SPREAD);
    cleanup = () => labels.dispose();
    state.onMap = true;
    // FishAI, left of the middle of the view (600): the footer chip under it, the dock prompt over
    // it, and room on either side of it.
    state.prompt = { left: 366, top: 300, width: 68, height: 70 };
    labels.setFoot({ right: 500, top: 440 });
    labels.frameUpdate(tick());
    expect(shown()).toContain('FishAI');
    expect(button('FishAI').dataset.side).toBe('right');

    // Right of the middle, the other way.
    const fresh = setup(SPREAD);
    labels.dispose();
    cleanup = () => fresh.labels.dispose();
    fresh.state.onMap = true;
    fresh.screen.x[1] = 800;
    fresh.state.prompt = { left: 766, top: 300, width: 68, height: 70 };
    fresh.labels.setFoot({ right: 900, top: 440 });
    fresh.labels.frameUpdate(tick());
    expect(fresh.shown()).toContain('FishAI');
    expect(fresh.button('FishAI').dataset.side).toBe('left');
  });

  it('on the map, reaches along its body where only that has room, however the pixels round', () => {
    drawnTags();
    const { labels, screen, state, button, shown } = setup(SPREAD);
    cleanup = () => labels.dispose();
    state.onMap = true;
    // A sun just right of FishAI (66 px wide): its name is over FishAI's place below and the one
    // beside it on the right; the dock prompt is over its places above and on the left. Below it,
    // reaching left along it (the planet over the right end of its tag), there is room. At
    // 501.07 px the tag's left edge plus its width, less the round end, comes to a hair short of
    // the planet.
    put(screen, [
      [551.07, 300, 12, 1000],
      [501.07, 300, 12, 120],
      [600, 380, 6, 140],
      [200, 300, 30, 300],
    ]);
    state.prompt = { left: 380, top: 200, width: 150, height: 100 };
    labels.frameUpdate(tick());
    expect(shown()).toContain('FishAI');
    expect(button('FishAI').dataset.side).toBeUndefined();
    const at = drawn(button('FishAI'));
    expect(at).toMatchObject({ x: 448.1, y: 314 });
    expect(at.body.x).toBeCloseTo(at.x + 66 - 13, 5);
  });

  it('on the map, leaves the room with the name that shows, and between two that wait gives it to the one nearer the middle', () => {
    // The sun's name and home's (both systems' names) want the same room. Out of view in flight.
    const away: Row[] = [
      [900, 300, 12, -1],
      [400, 400, 40, 120],
      [600, 380, 6, -1],
      [200, 300, 30, -1],
    ];
    const { labels, screen, state, button } = setup(away);
    cleanup = () => labels.dispose();
    state.onMap = true;
    // Both come into view at once, About's sun at the bottom edge, where its name has room only
    // above it, in the way of Code's under its own: Code 204 px from the middle of the view
    // (600, 436), About 314. About is nearer the camera, which is what decides in flight; on the
    // map, where the visitor is looking does. Code's name goes under its sun, About's elsewhere.
    put(screen, [
      [600, 640, 12, 1000],
      [400, 400, 40, 120],
      [600, 380, 6, -1],
      [610, 750, 12, 300],
    ]);
    labels.frameUpdate(tick());
    expect(drawn(button('Code'))).toMatchObject({ x: 574, y: 654 });
    expect(button('About').dataset.shown).toBeDefined();

    // Code's name has shown above its sun at the bottom edge for a while when About comes into
    // view, nearer the middle, where its name would want that room. Code's stays: a name that
    // waits takes only the room that is left.
    const fresh = setup(away);
    labels.dispose();
    cleanup = () => fresh.labels.dispose();
    fresh.state.onMap = true;
    put(fresh.screen, [
      [610, 750, 12, 1000],
      [400, 400, 40, 120],
      [600, 380, 6, -1],
      [200, 300, 30, -1],
    ]);
    fresh.labels.frameUpdate(tick());
    expect(drawn(fresh.button('Code'))).toMatchObject({ x: 584, y: 692 });
    fresh.labels.frameUpdate(tick(1));
    fresh.screen.x[3] = 600;
    fresh.screen.y[3] = 640;
    fresh.screen.radius[3] = 12;
    fresh.screen.depth[3] = 300;
    fresh.labels.frameUpdate(tick());
    expect(drawn(fresh.button('Code'))).toMatchObject({ x: 584, y: 692 });
    expect(fresh.button('About').dataset.shown).toBeDefined();
    expect(fresh.button('About').dataset.side).toBe('above');
  });

  it('on the map, puts a new name where its tag lies on no other body, where it has such a place', () => {
    // FishAI is out of view in flight...
    const { labels, screen, state, button } = setup([
      [900, 300, 12, 1000],
      [400, 400, 40, -1],
      [600, 380, 6, 140],
      [200, 300, 30, 300],
    ]);
    cleanup = () => labels.dispose();
    state.onMap = true;
    // ...and comes into view on the map with Canadian Fish's disc just under the bottom of where
    // its name would go below it (to 486; the moon's own name hangs below the moon, clear of it).
    // It goes above instead, where it covers nothing.
    put(screen, [
      [900, 300, 12, 1000],
      [400, 400, 40, 120],
      [400, 490, 6, 140],
      [200, 300, 30, 300],
    ]);
    labels.frameUpdate(tick());
    expect(button('FishAI').dataset.side).toBe('above');
    expect(drawn(button('FishAI'))).toMatchObject({ x: 367, y: 400 - 40 - 2 - 44 });
  });

  it("on the map, puts a new name where it does not read as a neighbour's: level with it, off its end", () => {
    // FishAI comes into view on the map with Canadian Fish level with where its name would go
    // below it (367..433 x 442..486), 11 px off the right end of the tag: "FishAI ( )" would read
    // as the moon's name. Clear of the moon's disc, but it goes above instead.
    const { labels, screen, state, button } = setup([
      [900, 300, 12, 1000],
      [400, 400, 40, -1],
      [600, 380, 6, 140],
      [200, 300, 30, 300],
    ]);
    cleanup = () => labels.dispose();
    state.onMap = true;
    put(screen, [
      [900, 300, 12, 1000],
      [400, 400, 40, 120],
      [450, 464, 6, 140],
      [200, 300, 30, 300],
    ]);
    labels.frameUpdate(tick());
    expect(button('FishAI').dataset.side).toBe('above');
  });

  it("on the map, lays no planet's or moon's name on a sun or the home planet, a system's only as a last resort", () => {
    // A narrow free view (the panel has the rest: no name goes further right than 112 px), and
    // FishAI between Code's sun above it and About's planet below: every place its name has
    // (below, above, slid along) lies on one of them, and beside it there is no room. No name.
    const { labels, screen, state, view, shown } = setup(SPREAD);
    cleanup = () => labels.dispose();
    view.freeWidth = 0.1;
    state.onMap = true;
    put(screen, [
      [60, 262, 15, 1000],
      [60, 300, 10, 120],
      [600, 380, 6, -1],
      [60, 338, 20, 300],
    ]);
    labels.frameUpdate(tick());
    expect(shown()).toEqual(['Code', 'About']);
    // Code's sun just under the top bar, where its name has no room above it, with About's
    // planet under it: every place Code's name has lies on About's. A system's name lies there
    // all the same, rather than go...
    put(screen, [
      [60, 110, 10, 1000],
      [600, 400, 10, -1],
      [600, 380, 6, -1],
      [60, 150, 20, 300],
    ]);
    labels.frameUpdate(tick());
    expect(shown()).toEqual(['Code', 'About']);
    // ...and a planet's in its place does not.
    put(screen, [
      [600, 300, 10, -1],
      [60, 110, 10, 120],
      [600, 380, 6, -1],
      [60, 150, 20, 300],
    ]);
    labels.frameUpdate(tick());
    expect(shown()).toEqual(['About']);
  });

  it('on the map, asks more room of a place a name is not at yet: past the ship, and from the edges', () => {
    // Canadian Fish and FishAI are out of view in flight.
    const { labels, screen, state, shown, button } = setup([
      [900, 300, 12, 1000],
      [400, 400, 40, -1],
      [600, 380, 6, -1],
      [200, 300, 30, 300],
    ]);
    cleanup = () => labels.dispose();
    state.onMap = true;
    // The moon comes into view under the top bar (no room above it), the ship's marker just over
    // where its name would go (128..172): the name would have to glide 7 px down past it, more
    // than the gap. One that showed there could (a keep more: the test above); a new one does
    // not come.
    screen.y[2] = 120;
    screen.depth[2] = 140;
    state.ship = { left: 591, top: 113, width: 18, height: 18 };
    labels.frameUpdate(tick());
    expect(shown()).not.toContain('Canadian Fish');
    // 3 px, within the gap: it comes, glided.
    state.ship = { left: 591, top: 109, width: 18, height: 18 };
    labels.frameUpdate(tick());
    expect(shown()).toContain('Canadian Fish');
    expect(drawn(button('Canadian Fish'))).toMatchObject({ x: 542.5, y: 131 });

    // FishAI comes into view near the bottom of the view: below it its name would end 4 px above
    // the edge (at 788, the view ending at 792), which is room enough for a name there already
    // but not for a new one (a keep, 8 px, to spare). It goes above.
    screen.y[1] = 702;
    screen.depth[1] = 120;
    labels.frameUpdate(tick());
    expect(button('FishAI').dataset.side).toBe('above');

    // Showing below already, it stays there as its body drifts down to the same spot.
    const fresh = setup([
      [900, 300, 12, 1000],
      [400, 690, 40, 120],
      [600, 380, 6, 140],
      [200, 300, 30, 300],
    ]);
    labels.dispose();
    cleanup = () => fresh.labels.dispose();
    fresh.state.onMap = true;
    fresh.labels.frameUpdate(tick());
    expect(fresh.button('FishAI').dataset.side).toBeUndefined();
    fresh.screen.y[1] = 702;
    fresh.labels.frameUpdate(tick());
    expect(fresh.button('FishAI').dataset.side).toBeUndefined();
    expect(drawn(fresh.button('FishAI'))).toMatchObject({ x: 367, y: 744 });
  });

  it('on the map, names a body whose only room is nearer an edge than that, unless it is leaving', () => {
    // Code's sun is out of view in flight (behind the camera, half over the bottom edge)...
    const { labels, screen, state, shown, button } = setup([
      [600, 800, 12, -1],
      [400, 400, 40, 120],
      [600, 380, 6, -1],
      [200, 300, 30, 300],
    ]);
    cleanup = () => labels.dispose();
    state.onMap = true;
    // ...and comes into view there on the map, where its name has room only above it, ending
    // 6 px short of where names may go (at 786, the view ending at 792): not the room to spare a
    // new name asks for, but it has no place that has. It takes that one.
    screen.depth[0] = 1000;
    labels.frameUpdate(tick());
    expect(shown()).toContain('Code');
    expect(button('Code').dataset.side).toBe('above');
    expect(drawn(button('Code'))).toMatchObject({ x: 574, y: 742 });
    // It keeps it as long as it fits there, as any name keeps its place...
    screen.y[0] = 806;
    labels.frameUpdate(tick());
    expect(drawn(button('Code'))).toMatchObject({ x: 574, y: 748 });
    // ...goes once it does not, and does not come and go as its sun drifts a pixel back and forth
    // at the edge: it comes back once it has been gone a while (`dwellSec`).
    screen.y[0] = 807;
    labels.frameUpdate(tick());
    expect(shown()).not.toContain('Code');
    screen.y[0] = 806;
    labels.frameUpdate(tick());
    expect(shown()).not.toContain('Code');
    labels.frameUpdate(tick(1));
    expect(shown()).toContain('Code');

    // A name that has no room until its body is on its way out of the view, through that edge,
    // does not come for the moment it has left: the dock prompt over its only place as the sun
    // drifts down, gone as the sun gets there. It comes once its sun holds still there.
    const leaving = setup([
      [600, 790, 12, 1000],
      [400, 400, 40, 120],
      [600, 380, 6, -1],
      [200, 300, 30, 300],
    ]);
    labels.dispose();
    cleanup = () => leaving.labels.dispose();
    leaving.state.onMap = true;
    leaving.state.prompt = { left: 560, top: 700, width: 80, height: 90 };
    leaving.labels.frameUpdate(tick());
    expect(leaving.shown()).not.toContain('Code');
    leaving.screen.y[0] = 805;
    leaving.state.prompt = null;
    leaving.labels.frameUpdate(tick());
    expect(leaving.shown()).not.toContain('Code');
    leaving.labels.frameUpdate(tick());
    expect(leaving.shown()).toContain('Code');
  });

  it('never takes a name away from under the keyboard', () => {
    const { labels, screen, shown, button } = setup(SPREAD);
    cleanup = () => labels.dispose();
    // Someone has tabbed to the moon's name...
    button('Canadian Fish').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    // ...and the sun drifts right behind it, with a name that would normally win.
    screen.x[0] = 605;
    screen.y[0] = 375;
    labels.frameUpdate(tick());
    expect(shown()).toEqual(['FishAI', 'Canadian Fish', 'About']);

    button('Canadian Fish').dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    labels.frameUpdate(tick());
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

describe('Labels of links (profiles elsewhere, which nothing docks at)', () => {
  /** Home, the satellite, and two relays beside it: GitHub and LinkedIn. */
  function linked() {
    document.body.innerHTML = '<div id="overlay"></div>';
    const overlay = document.getElementById('overlay') as HTMLElement;
    const screen = createScreenMap(4);
    put(screen, [
      [200, 300, 30, 300],
      [500, 300, 6, 300],
      [700, 300, 6, 300],
      [900, 300, 6, 300],
    ]);
    const picked: number[] = [];
    const labels = new Labels({
      overlay,
      screen,
      bodies: [
        { title: 'About', kind: 'home' },
        { title: 'Contact', kind: 'satellite' },
        { title: 'GitHub', kind: 'link', href: 'https://github.com/someone' },
        { title: 'LinkedIn', kind: 'link', href: 'https://www.linkedin.com/in/someone' },
      ],
      params: PARAMS,
      view: { freeWidth: 1, freeHeight: 1 },
      target: () => -1,
      docked: () => false,
      onPick: (row) => picked.push(row),
    });
    cleanup = () => labels.dispose();
    labels.resize({ width: 1200, height: 800, pixelRatio: 1 });
    labels.frameUpdate(tick());
    const link = (title: string): HTMLAnchorElement =>
      [...overlay.querySelectorAll('a')].find(
        (candidate) => candidate.textContent === title,
      ) as HTMLAnchorElement;
    return { overlay, screen, labels, picked, link };
  }

  it('are real links, heard with where they go, in a group of their own: not a way to fly', () => {
    const { overlay, link } = linked();
    const groups = [...overlay.querySelectorAll('[role="group"]')];
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
      'Fly to',
      'Elsewhere',
    ]);
    const [flyTo, elsewhere] = groups;
    expect([...(flyTo?.children ?? [])].map((name) => name.textContent)).toEqual([
      'About',
      'Contact',
    ]);
    expect([...(flyTo?.querySelectorAll('a') ?? [])]).toHaveLength(0);
    expect([...(elsewhere?.children ?? [])]).toEqual([link('GitHub'), link('LinkedIn')]);

    const github = link('GitHub');
    expect(github.getAttribute('href')).toBe('https://github.com/someone');
    expect(github.rel).toBe('me noopener');
    expect(github.target).toBe('');
    expect(github.getAttribute('aria-label')).toBe('GitHub, on github.com');
    expect(link('LinkedIn').getAttribute('aria-label')).toBe('LinkedIn, on linkedin.com');
    expect(github.draggable).toBe(false);
    expect(github.className).toBe('body-label');
    expect(github.dataset.kind).toBe('link');
    expect(github.dataset.row).toBe('2');
    // Placed and shown like any name.
    expect(github.dataset.shown).toBe('');
    expect(github.style.transform).toMatch(/^translate\(/);
  });

  it('are followed as links: pressing one tells nobody to fly', () => {
    const { link, picked } = linked();
    // (The browser follows it; a test DOM does nothing.)
    link('GitHub').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(picked).toEqual([]);
  });

  it('beckons: the body pointed at brings its name forward, focused and lit, with the next frame', () => {
    const { labels, link, overlay } = linked();
    const github = link('GitHub');
    labels.beckon(2);
    // Not yet: a name is only focused once it shows.
    expect(document.activeElement).not.toBe(github);
    labels.frameUpdate(tick());
    expect(document.activeElement).toBe(github);
    expect(github.dataset.beckon).toBe('');
    // Nothing but a link is ever beckoned.
    labels.beckon(1);
    labels.frameUpdate(tick());
    expect(document.activeElement).toBe(github);
    expect(overlay.querySelector('button')?.dataset.beckon).toBeUndefined();
    // Lit only while it has the focus.
    github.blur();
    expect(github.dataset.beckon).toBeUndefined();
  });

  it('keeps a beckoned name in view, as it keeps whatever the keyboard is on', () => {
    const { labels, link, screen } = linked();
    // LinkedIn's body drifts right under GitHub's: one of the two names must go...
    screen.x[3] = 705;
    screen.y[3] = 302;
    labels.frameUpdate(tick());
    const shows = (title: string): boolean => link(title).dataset.shown === '';
    expect(shows('GitHub') !== shows('LinkedIn')).toBe(true);
    const hidden = shows('GitHub') ? 'LinkedIn' : 'GitHub';
    // ...and the one pointed at is the one that stays, with the focus.
    labels.beckon(hidden === 'GitHub' ? 2 : 3);
    labels.frameUpdate(tick());
    expect(shows(hidden)).toBe(true);
    expect(document.activeElement).toBe(link(hidden));
    // It stays on the frames after, once the beckon is spent, because the keyboard is on it: even
    // with the other body now right on top of it, and nearer, which would otherwise win the room.
    const [mine, theirs] = hidden === 'GitHub' ? [2, 3] : [3, 2];
    screen.x[theirs] = screen.x[mine] ?? 0;
    screen.y[theirs] = screen.y[mine] ?? 0;
    screen.depth[theirs] = 100;
    for (let frame = 0; frame < 3; frame += 1) {
      labels.frameUpdate(tick());
      expect(shows(hidden)).toBe(true);
    }
    expect(document.activeElement).toBe(link(hidden));
    // Once the focus moves on, the nearer name has the room.
    link(hidden).blur();
    labels.frameUpdate(tick());
    expect(shows(hidden)).toBe(false);
  });

  it('beckons nothing whose body cannot be seen, and leaves the focus where it was', () => {
    const { labels, screen, link } = linked();
    screen.depth[2] = -1;
    labels.beckon(2);
    labels.frameUpdate(tick());
    expect(document.activeElement).not.toBe(link('GitHub'));
    expect(link('GitHub').dataset.beckon).toBeUndefined();
    // Nor later, once it is in view again: a beckon is for the moment it was asked.
    screen.depth[2] = 300;
    labels.frameUpdate(tick());
    expect(document.activeElement).not.toBe(link('GitHub'));
  });

  it('cleans up both groups', () => {
    const { overlay, labels } = linked();
    labels.dispose();
    cleanup = null;
    expect(overlay.children).toHaveLength(0);
  });
});
