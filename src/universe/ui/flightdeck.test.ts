// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { Frame } from '../core/Engine';
import type { ThemeKey } from '../design/tokens';
import { tuning } from '../design/tuning';
import { createShipState } from '../sim/flight';
import type { DeckMode } from '../sim/instruments';
import { FlightDeck } from './FlightDeck';

const P = tuning.instruments;
const STEP = 1 / 60;
const RAD = Math.PI / 180;

/** A laptop, a phone, and the side panel of a wide screen (30rem and its margin). */
const LAPTOP = { width: 1280, height: 800, pixelRatio: 1 };
const PHONE = { width: 360, height: 740, pixelRatio: 3 };
const SIDEWAYS = { width: 740, height: 360, pixelRatio: 3 };
const SIDE_PANEL = 480 + 24;

/** Two bodies: home 100 u north of the origin, and FishAI 500 u along +X (to the pilot's left). */
const ROWS = ['page/about', 'project/fishai'];

function setup(reducedMotion = false) {
  document.body.innerHTML = '<div id="overlay"><button class="dock-prompt"></button></div>';
  const overlay = document.getElementById('overlay') as HTMLElement;
  const ship = {
    position: { x: 0, z: 0 },
    velocity: { x: 0, z: 0 },
    heading: 0,
    speed: 0,
    bank: 0,
    pitch: 0,
    flown: { thrust: 0, turn: 0, brake: 0, boost: false },
    state: createShipState(0, 0, 0),
  };
  const navigator = {
    state: { mode: 'flight' as DeckMode, target: null as string | null },
    candidate: null as string | null,
    halting: false,
    guarding: false,
  };
  const world = { assist: 0, map: false, theme: null as ThemeKey | null };
  const deck = new FlightDeck({
    overlay,
    ship,
    navigator,
    assistWeight: () => world.assist,
    positions: new Float64Array([0, 100, 500, 0]),
    rowOf: (id) => ROWS.indexOf(id),
    home: 0,
    theme: () => world.theme,
    mapOpen: () => world.map,
    params: P,
    reducedMotion,
  });
  const root = overlay.querySelector('.flight-deck') as HTMLElement;
  let elapsed = 0;
  /** One frame, a second after the last unless told: the digits are never held back by the clock. */
  const draw = (after = 1, dt = STEP): void => {
    elapsed += after;
    deck.frameUpdate({ elapsed, dt, alpha: 1, simTime: elapsed } satisfies Frame);
  };
  /** Fly a step: the ship's velocity becomes this. */
  const step = (vx: number, vz: number): void => {
    ship.state.vx = vx;
    ship.state.vz = vz;
    deck.fixedUpdate(STEP);
  };
  const one = (selector: string): Element => {
    const found = root.querySelector(selector);
    if (!found) throw new Error(`no ${selector} in the deck`);
    return found;
  };
  const mark = (name: string): Element => one(`[data-mark="${name}"]`);
  const lamp = (name: string): Element => one(`[data-lamp="${name}"]`);
  const fill = (name: string): number =>
    Number.parseFloat(
      one(`[data-arc="${name}"] .flight-deck__fill`).getAttribute('stroke-dasharray') ?? '',
    );
  return { overlay, ship, navigator, world, deck, root, draw, step, one, mark, lamp, fill };
}

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function deckOn(viewport = LAPTOP, reducedMotion = false) {
  const made = setup(reducedMotion);
  cleanup = () => made.deck.dispose();
  made.deck.resize(viewport);
  return made;
}

describe('the flight deck, as a thing on the page', () => {
  it('is a picture: hidden from assistive technology, with nothing to focus, last in the overlay', () => {
    const { overlay, root } = deckOn();
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(
      root.querySelectorAll('a, button, input, select, textarea, [tabindex], [contenteditable]'),
    ).toHaveLength(0);
    expect(overlay.lastElementChild).toBe(root);
    // A mouse gets the name of each instrument as a tooltip, and nothing else names them.
    expect([...root.querySelectorAll('title')].map((title) => title.textContent)).toEqual([
      'Compass',
      'Throttle',
      'G-force',
    ]);
  });

  it('says its speed in m/s and its heading in three digits', () => {
    const { ship, draw, one } = deckOn();
    ship.speed = 41.6;
    ship.heading = -67 * RAD;
    draw();
    expect(one('.flight-deck__speed').textContent).toBe('42m/s');
    expect(one('.flight-deck__hdg').textContent).toBe('HDG067°');
    // North is +Z, heading 0; a turn to the left (counter-clockwise) is west of it.
    ship.heading = 0;
    draw();
    expect(one('.flight-deck__hdg b').textContent).toBe('000°');
    ship.heading = 90 * RAD;
    draw();
    expect(one('.flight-deck__hdg b').textContent).toBe('270°');
  });

  it('leaves no node behind', () => {
    const { overlay, deck } = setup();
    deck.resize(LAPTOP);
    deck.dispose();
    expect(overlay.querySelector('.flight-deck')).toBeNull();
    expect(overlay.children).toHaveLength(1);
  });
});

describe('how big the deck is', () => {
  it('is the whole cluster where the free view has room, the strip where it has less, or nothing', () => {
    const { deck, root } = deckOn();
    expect(root.dataset.layout).toBe('full');
    expect(root.hidden).toBe(false);
    // A side panel takes its width from the view: at 1280 there is room beside it still...
    deck.setRoom(SIDE_PANEL, 0);
    expect(root.dataset.layout).toBe('full');
    // ...and in a window a little narrower there is room for the strip alone.
    deck.resize({ ...LAPTOP, width: 1271 });
    expect(root.dataset.layout).toBe('strip');
    expect(root.hidden).toBe(false);
    deck.setRoom(0, 0);
    expect(root.dataset.layout).toBe('full');
    expect(root.hidden).toBe(false);
    // A phone, either way up.
    deck.resize(PHONE);
    expect(root.dataset.layout).toBe('strip');
    expect(root.hidden).toBe(false);
    deck.resize(SIDEWAYS);
    expect(root.dataset.layout).toBe('strip');
    // Under a bottom sheet, and in a window zoomed to 400 %, there is no deck at all.
    deck.resize(PHONE);
    deck.setRoom(0, 400);
    expect(root.dataset.layout).toBe('off');
    expect(root.hidden).toBe(true);
    deck.setRoom(0, 0);
    deck.resize({ width: 320, height: 256, pixelRatio: 1 });
    expect(root.dataset.layout).toBe('off');
  });

  it('is out of the way until the engine knows its viewport', () => {
    const { root, deck, draw } = setup();
    cleanup = () => deck.dispose();
    draw();
    expect(root.hidden).toBe(true);
    expect(root.dataset.layout).toBe('off');
    expect(deck.box()).toBeNull();
  });

  it('draws to the size of its plate: one unit of the drawing is one px', () => {
    const { deck, root, one } = setup();
    cleanup = () => deck.dispose();
    const plate = one('.flight-deck__plate') as HTMLElement;
    const sized = (width: number): void => {
      plate.getBoundingClientRect = () => ({ width, height: width }) as DOMRect;
    };
    // (Nothing can be measured here until it is told: then it draws to 7rem.)
    deck.resize(LAPTOP);
    expect(one('.flight-deck__dial').getAttribute('viewBox')).toBe('-56 -56 112 112');
    expect(one('.flight-deck__rim').getAttribute('r')).toBe('42');
    // A window 576 px tall: the plate is 80 px, and the ball 26.
    sized(80);
    deck.resize({ ...LAPTOP, height: 576 });
    expect(one('.flight-deck__dial').getAttribute('viewBox')).toBe('-40 -40 80 80');
    expect(one('.flight-deck__rim').getAttribute('r')).toBe('26');
    expect(root.querySelector('clipPath circle')?.getAttribute('r')).toBe('26');
  });

  it('tells the names where it is, while it shows', () => {
    const { deck, root, navigator, draw } = deckOn();
    root.getBoundingClientRect = () =>
      ({ left: 520, top: 652, width: 240, height: 136 }) as DOMRect;
    // (Asked before the frame writes anything: it answers for the frame before.)
    expect(deck.box()).toBeNull();
    draw();
    expect(deck.box()).toEqual({ left: 520, top: 652, width: 240, height: 136 });
    navigator.state = { mode: 'docked', target: 'project/fishai' };
    draw();
    expect(deck.box()).toBeNull();
  });
});

describe('when the deck shows', () => {
  it('shows while the ship is under way and the sky is in view', () => {
    const { root, navigator, world, draw } = deckOn();
    draw();
    expect(root.hasAttribute('data-shown')).toBe(true);
    expect(root.hasAttribute('data-seated')).toBe(true);
    // A journey is under way too, whoever started it; and so is an approach.
    for (const mode of ['autopilot', 'approach'] as const) {
      navigator.state = { mode, target: 'project/fishai' };
      draw();
      expect(root.hasAttribute('data-seated'), mode).toBe(true);
    }
    // In orbit somebody is reading the page.
    navigator.state = { mode: 'docked', target: 'project/fishai' };
    draw();
    expect(root.hasAttribute('data-shown')).toBe(false);
    expect(root.hasAttribute('data-seated')).toBe(false);
    // On the star map the flight controls are off.
    navigator.state = { mode: 'flight', target: null };
    world.map = true;
    draw();
    expect(root.hasAttribute('data-shown')).toBe(false);
    world.map = false;
    draw();
    expect(root.hasAttribute('data-shown')).toBe(true);
  });

  it('is only seated at full size: the prompt keeps its place beside anything less', () => {
    const { root, draw } = deckOn(PHONE);
    draw();
    expect(root.hasAttribute('data-shown')).toBe(true);
    expect(root.hasAttribute('data-seated')).toBe(false);
  });
});

describe('the lamps', () => {
  it('lights AUTO while the ship flies itself, ASSIST while the pilot is helped, never both', () => {
    const { navigator, world, draw, lamp } = deckOn();
    const lit = (): string =>
      ['assist', 'auto'].filter((name) => lamp(name).hasAttribute('data-on')).join(' ');
    draw();
    expect(lit()).toBe('');
    world.assist = 0.5;
    draw();
    expect(lit()).toBe('assist');
    navigator.state = { mode: 'autopilot', target: 'project/fishai' };
    world.assist = 1;
    draw();
    expect(lit()).toBe('auto');
    navigator.state = { mode: 'approach', target: 'project/fishai' };
    draw();
    expect(lit()).toBe('auto');
    // Stop: the ship brakes itself to rest, with nowhere to go.
    navigator.state = { mode: 'flight', target: null };
    navigator.halting = true;
    world.assist = 0;
    draw();
    expect(lit()).toBe('auto');
    // A journey handed back at speed: the reflex guards the ship while its pilot flies.
    navigator.halting = false;
    navigator.guarding = true;
    draw();
    expect(lit()).toBe('assist');
    expect(lamp('assist').textContent).toBe('Assist');
    expect(lamp('auto').textContent).toBe('Auto');
  });
});

describe('the digits', () => {
  it('are written when the whole number changes, and no faster than digitsHz', () => {
    const { ship, draw, one } = deckOn();
    const speed = (): string | null => one('.flight-deck__speed b').textContent;
    ship.speed = 10;
    draw();
    expect(speed()).toBe('10');
    // A sixtieth of a second later the speed is another number: not yet.
    const tick = 1 / P.digitsHz;
    ship.speed = 11;
    draw(STEP);
    expect(speed()).toBe('10');
    draw(tick - 3 * STEP);
    expect(speed()).toBe('10');
    draw(3 * STEP);
    expect(speed()).toBe('11');
    // A change within the same whole number writes nothing, and does not start the clock.
    ship.speed = 11.4;
    draw(tick);
    ship.speed = 12;
    draw(STEP);
    expect(speed()).toBe('12');
  });

  it('change at most four times a second for a visitor who asked for less motion', () => {
    const { ship, draw, one } = deckOn(LAPTOP, true);
    const speed = (): string | null => one('.flight-deck__speed b').textContent;
    ship.speed = 10;
    draw();
    ship.speed = 20;
    draw(1 / P.digitsHz);
    expect(speed()).toBe('10');
    draw(1 / P.digitsHzReduced);
    expect(speed()).toBe('20');
  });

  it('wear a chevron for each of the speeds only the autopilot reaches', () => {
    const { ship, root, draw } = deckOn();
    const tiers = [
      [0, '0'],
      [81, '0'],
      [82, '1'],
      [300, '2'],
      [700, '3'],
      [40, '0'],
    ] as const;
    for (const [speed, warp] of tiers) {
      ship.speed = speed;
      draw();
      expect(root.dataset.warp, `${speed} u/s`).toBe(warp);
    }
    expect(root.querySelectorAll('.flight-deck__warp path')).toHaveLength(3);
  });
});

describe('the ball', () => {
  it('turns with the heading: meridians slide across, and N E S W ride them', () => {
    const { ship, root, draw } = deckOn();
    const lines = [...root.querySelectorAll('.flight-deck__line')];
    const letters = [...root.querySelectorAll('.flight-deck__letter')];
    expect(lines).toHaveLength(12);
    expect(letters.map((letter) => letter.textContent).join('')).toBe('NESW');
    draw();
    // Due north: the north meridian is a straight line down the middle, and N is on it, upright.
    expect(lines[0]?.getAttribute('d')).toBe('M0 -42A0 42 0 0 1 0 42');
    expect(letters[0]?.getAttribute('transform')).toBe('translate(0 -25.2)scale(1 1)');
    expect(letters[0]?.hasAttribute('data-off')).toBe(false);
    // East and west are at the rim, out of view, and south is behind.
    expect(lines[3]?.getAttribute('d')).toBe('');
    expect(lines[6]?.getAttribute('d')).toBe('');
    expect(lines[9]?.getAttribute('d')).toBe('');
    expect(letters.slice(1).every((letter) => letter.hasAttribute('data-off'))).toBe(true);
    // 30 degrees east of north is to the right, 30 west to the left.
    expect(lines[1]?.getAttribute('d')).toBe('M0 -42A21 42 0 0 1 0 42');
    expect(lines[11]?.getAttribute('d')).toBe('M0 -42A21 42 0 0 0 0 42');

    // Turned to face east (clockwise from above, so the heading falls): E is dead ahead, N has
    // gone off to the left, S comes in from the right.
    ship.heading = -90 * RAD;
    draw();
    expect(lines[3]?.getAttribute('d')).toBe('M0 -42A0 42 0 0 1 0 42');
    expect(letters[1]?.getAttribute('transform')).toBe('translate(0 -25.2)scale(1 1)');
    expect(letters[1]?.hasAttribute('data-off')).toBe(false);
    expect(letters[0]?.hasAttribute('data-off')).toBe(true);
    // A letter is painted on the globe: 60 degrees off, N is half turned away; E, 30 off, hardly.
    ship.heading = -60 * RAD;
    draw();
    expect(letters[0]?.getAttribute('transform')).toBe('translate(-29.1 -25.2)scale(0.5 1)');
    expect(letters[1]?.getAttribute('transform')).toBe('translate(16.8 -25.2)scale(0.87 1)');
  });

  it('leans and nods as the ship on screen does, and not for less motion', () => {
    const { ship, root, draw } = deckOn();
    const world = root.querySelector('.flight-deck__globe > g');
    // (The marks ride the globe without being cut to the ball: a group of their own beside it.)
    const marks = root.querySelector('[data-mark]')?.parentElement;
    draw();
    expect(world?.getAttribute('transform')).toBe('rotate(0)translate(0 0)');
    // A left turn drops the left wing (bank < 0): the globe turns clockwise, and the left end of
    // the horizon rises. A boost lifts the nose (pitch < 0): the horizon sinks.
    ship.bank = -0.3;
    ship.pitch = -5 * RAD;
    draw();
    expect(world?.getAttribute('transform')).toBe('rotate(17.2)translate(0 3.7)');
    expect(marks?.getAttribute('transform')).toBe('rotate(17.2)translate(0 3.7)');
    expect(marks?.closest('.flight-deck__globe')).toBeNull();

    const calm = deckOn(LAPTOP, true);
    calm.ship.bank = -0.3;
    calm.draw();
    expect(calm.root.querySelector('.flight-deck__globe > g')?.hasAttribute('transform')).toBe(
      false,
    );
  });

  it('marks the body within reach with a dashed ring, and the one it is locked on with a whole one', () => {
    const { navigator, draw, mark } = deckOn();
    draw();
    expect(mark('target').hasAttribute('data-off')).toBe(true);
    // FishAI is due +X: a quarter turn to the pilot's left, so at the left end of its lane.
    navigator.candidate = 'project/fishai';
    draw();
    expect(mark('target').hasAttribute('data-off')).toBe(false);
    expect(mark('target').hasAttribute('data-lock')).toBe(false);
    expect(mark('target').getAttribute('transform')).toBe('translate(-35.2 -14.3)scale(1)');
    navigator.candidate = null;
    navigator.state = { mode: 'autopilot', target: 'project/fishai' };
    draw();
    expect(mark('target').hasAttribute('data-lock')).toBe(true);
    navigator.state = { mode: 'approach', target: 'project/fishai' };
    draw();
    expect(mark('target').hasAttribute('data-lock')).toBe(true);
    // A body the galaxy does not know (a manifest from another deploy) is no mark at all.
    navigator.state = { mode: 'autopilot', target: 'project/gone' };
    draw();
    expect(mark('target').hasAttribute('data-off')).toBe(true);
  });

  it('pins a mark at the rim, hollow, when it is behind the ship', () => {
    const { ship, navigator, draw, mark } = deckOn();
    navigator.candidate = 'project/fishai';
    // The ship has passed FishAI and flies on along +X, a little to the left of straight away
    // from it: FishAI is behind, over its left shoulder.
    ship.position.x = 600;
    ship.heading = 90 * RAD + 0.3;
    draw();
    expect(mark('target').hasAttribute('data-behind')).toBe(true);
    expect(mark('target').getAttribute('transform')).toBe('translate(-35.2 -14.3)scale(1)');
    // Turned round to face it (-X), it is back on the ball, dead ahead.
    ship.heading = -90 * RAD;
    draw();
    expect(mark('target').hasAttribute('data-behind')).toBe(false);
    expect(mark('target').getAttribute('transform')).toBe('translate(0 -14.3)scale(1)');
  });

  it('shows the way home, except while home is where the ship is going', () => {
    const { navigator, draw, mark } = deckOn();
    draw();
    // Home is 100 u due north: dead ahead, on the lower lane.
    expect(mark('home').hasAttribute('data-off')).toBe(false);
    expect(mark('home').getAttribute('transform')).toBe('translate(0 14.3)scale(1)');
    navigator.candidate = 'page/about';
    draw();
    expect(mark('home').hasAttribute('data-off')).toBe(true);
    expect(mark('target').getAttribute('transform')).toBe('translate(0 -14.3)scale(1)');
  });

  it('shows where the ship is really going once it is going anywhere', () => {
    const { ship, draw, mark } = deckOn();
    draw();
    expect(mark('prograde').hasAttribute('data-off')).toBe(true);
    // Nose north, sliding a little to the left (+X) in a turn: the mark leaves the nose that way.
    ship.speed = 40;
    ship.velocity.x = 40 * Math.sin(20 * RAD);
    ship.velocity.z = 40 * Math.cos(20 * RAD);
    draw();
    expect(mark('prograde').hasAttribute('data-off')).toBe(false);
    const x = Number(
      /translate\((-?[\d.]+) 0\)/.exec(mark('prograde').getAttribute('transform') ?? '')?.[1],
    );
    // (Its lane is the horizon, which ends 4 px inside the rim: a mark pinned there is whole.)
    expect(x).toBeCloseTo(-38 * Math.sin(20 * RAD), 1);
    ship.speed = P.progradeMinSpeed / 2;
    draw();
    expect(mark('prograde').hasAttribute('data-off')).toBe(true);
  });

  it('draws its marks smaller on a small ball, and keeps one at the rim whole', () => {
    const { deck, navigator, draw, one, mark } = setup();
    cleanup = () => deck.dispose();
    const plate = one('.flight-deck__plate') as HTMLElement;
    plate.getBoundingClientRect = () => ({ width: 80, height: 80 }) as DOMRect;
    // A window 576 px tall: the ball is 26 px in radius.
    deck.resize({ ...LAPTOP, height: 576 });
    navigator.candidate = 'project/fishai';
    draw();
    expect(one('.flight-deck__nose').getAttribute('transform')).toBe('scale(0.7)');
    const [, x = '', y = ''] =
      /translate\((-?[\d.]+) (-?[\d.]+)\)scale\(0\.7\)/.exec(
        mark('target').getAttribute('transform') ?? '',
      ) ?? [];
    // Its middle is 4 px inside the rim (to the tenth of a pixel it is written in).
    expect(Math.hypot(Number(x), Number(y))).toBeCloseTo(26 - 4, 0);
  });

  it('wears the family of the system the ship is in on its horizon', () => {
    const { root, world, draw } = deckOn();
    draw();
    expect(root.hasAttribute('data-theme')).toBe(false);
    world.theme = 'sky';
    draw();
    expect(root.dataset.theme).toBe('sky');
    world.theme = null;
    draw();
    expect(root.hasAttribute('data-theme')).toBe(false);
  });
});

describe('the arcs', () => {
  it('fill with the throttle that was flown, and turn to the flame while boosting', () => {
    const { ship, root, draw, fill } = deckOn();
    draw();
    expect(fill('throttle')).toBe(0);
    ship.flown.thrust = 1;
    for (let i = 0; i < 60; i += 1) draw(STEP);
    // A quarter of a circle of radius 48 (the plate's 56 less 8).
    expect(fill('throttle')).toBeCloseTo((48 * Math.PI) / 2, 1);
    expect(root.hasAttribute('data-boost')).toBe(false);
    ship.flown.boost = true;
    draw(STEP);
    expect(root.hasAttribute('data-boost')).toBe(true);
    // Boost held with the throttle shut burns nothing.
    ship.flown.thrust = 0;
    draw(STEP);
    expect(root.hasAttribute('data-boost')).toBe(false);
  });

  it('fill with the g of the last step, eased, and peg past a full arc', () => {
    const { root, draw, step, fill } = deckOn();
    draw();
    // Full thrust from rest: 34 u/s2, about 3.5 g, a quarter of an arc that is full at 15.
    let v = 0;
    for (let i = 0; i < 60; i += 1) {
      v += tuning.flight.thrustAccel * STEP;
      step(0, v);
      draw(STEP);
    }
    const length = (48 * Math.PI) / 2;
    expect(fill('g') / length).toBeCloseTo(tuning.flight.thrustAccel / P.gUnit / P.gFull, 1);
    expect(root.hasAttribute('data-peg')).toBe(false);
    // The autopilot's 60 g and more: the arc is full, and the peg lights.
    for (let i = 0; i < 60; i += 1) {
      v += 600 * STEP;
      step(0, v);
      draw(STEP);
    }
    expect(fill('g')).toBeCloseTo(length, 0);
    expect(root.hasAttribute('data-peg')).toBe(true);
    // Coasting: nothing pulls, and the arc empties.
    for (let i = 0; i < 120; i += 1) {
      step(0, v);
      draw(STEP);
    }
    expect(fill('g')).toBe(0);
    expect(root.hasAttribute('data-peg')).toBe(false);
  });

  it('say what is true the moment the deck comes back, without easing in from before', () => {
    const { ship, navigator, draw, fill } = deckOn();
    draw();
    navigator.state = { mode: 'docked', target: 'project/fishai' };
    draw();
    ship.flown.thrust = 1;
    navigator.state = { mode: 'flight', target: null };
    draw(STEP);
    expect(fill('throttle')).toBeCloseTo((48 * Math.PI) / 2, 1);
  });
});

describe('the strip', () => {
  it('draws a ball that fills its 2.25rem plate, with north for its one meridian', () => {
    const { root, draw, one } = deckOn(PHONE);
    draw();
    expect(one('.flight-deck__dial').getAttribute('viewBox')).toBe('-18 -18 36 36');
    expect(one('.flight-deck__rim').getAttribute('r')).toBe('17');
    const lines = [...root.querySelectorAll('.flight-deck__line')];
    // Due north: a straight line down the middle. It is the one the stylesheet keeps.
    expect(lines[0]?.hasAttribute('data-north')).toBe(true);
    expect(lines[0]?.getAttribute('d')).toBe('M0 -17A0 17 0 0 1 0 17');
    expect(lines.filter((line) => line.hasAttribute('data-north'))).toHaveLength(1);
    expect(one('.flight-deck__nose').getAttribute('transform')).toBe('scale(0.7)');
  });

  it('writes nothing of what it does not show: other meridians, letters, home, prograde, arcs', () => {
    const { ship, navigator, root, draw, mark } = deckOn(SIDEWAYS);
    navigator.candidate = 'project/fishai';
    ship.speed = 40;
    ship.velocity.z = 40;
    ship.flown.thrust = 1;
    ship.flown.boost = true;
    for (let i = 0; i < 30; i += 1) draw(STEP);
    const lines = [...root.querySelectorAll('.flight-deck__line')];
    expect(lines.slice(1).some((line) => line.hasAttribute('d'))).toBe(false);
    expect(
      [...root.querySelectorAll('.flight-deck__letter')].some((letter) =>
        letter.hasAttribute('transform'),
      ),
    ).toBe(false);
    expect(mark('home').hasAttribute('data-off')).toBe(true);
    expect(mark('prograde').hasAttribute('data-off')).toBe(true);
    expect(root.querySelector('.flight-deck__fill[stroke-dasharray]')).toBeNull();
    expect(root.hasAttribute('data-boost')).toBe(false);
    // What it does show: the target (FishAI, a quarter turn to the left), the speed, the heading.
    expect(mark('target').getAttribute('transform')).toBe('translate(-11.6 -5.8)scale(0.7)');
    expect(root.querySelector('.flight-deck__speed b')?.textContent).toBe('40');
    expect(root.querySelector('.flight-deck__hdg b')?.textContent).toBe('000°');
  });

  it('names the lamp that is lit, and nothing while none is', () => {
    const { navigator, world, root, draw } = deckOn(PHONE);
    const lit = root.querySelector('.flight-deck__lit');
    draw();
    expect(lit?.childNodes).toHaveLength(0);
    world.assist = 0.5;
    draw();
    expect(lit?.textContent).toBe('Assist');
    navigator.state = { mode: 'autopilot', target: 'project/fishai' };
    draw();
    expect(lit?.textContent).toBe('Auto');
    navigator.state = { mode: 'flight', target: null };
    world.assist = 0;
    draw();
    expect(lit?.childNodes).toHaveLength(0);
    // The cluster's own two lamps say it there: the name is kept all the same, for the stylesheet.
    const wide = deckOn();
    wide.world.assist = 0.5;
    wide.draw();
    expect(wide.root.querySelector('.flight-deck__lit')?.textContent).toBe('Assist');
  });

  it('takes the cluster’s place, and gives it back, as the free view changes', () => {
    const { deck, ship, root, draw, one, fill } = deckOn();
    ship.flown.thrust = 1;
    draw();
    expect(one('.flight-deck__rim').getAttribute('r')).toBe('42');
    // A page opens beside a window 1100 px wide: the strip, drawn to its own ball.
    deck.resize({ ...LAPTOP, width: 1100 });
    deck.setRoom(SIDE_PANEL, 0);
    draw(STEP);
    expect(root.dataset.layout).toBe('strip');
    expect(root.hasAttribute('data-seated')).toBe(false);
    expect(one('.flight-deck__rim').getAttribute('r')).toBe('17');
    for (let i = 0; i < 30; i += 1) draw(STEP);
    // It closes: the cluster again, and its arcs say what is true at once.
    deck.setRoom(0, 0);
    draw(STEP);
    expect(root.dataset.layout).toBe('full');
    expect(root.hasAttribute('data-seated')).toBe(true);
    expect(one('.flight-deck__rim').getAttribute('r')).toBe('42');
    expect(fill('throttle')).toBeCloseTo((48 * Math.PI) / 2, 1);
  });

  it('tells the names where it is too', () => {
    const { deck, root, draw } = deckOn(PHONE);
    root.getBoundingClientRect = () => ({ left: 16, top: 112, width: 124, height: 44 }) as DOMRect;
    draw();
    expect(deck.box()).toEqual({ left: 16, top: 112, width: 124, height: 44 });
  });
});

describe('at rest', () => {
  it('writes nothing', () => {
    const { ship, navigator, root, draw, step } = deckOn();
    ship.heading = 0.4;
    navigator.candidate = 'project/fishai';
    draw();
    const watch = new MutationObserver(() => undefined);
    watch.observe(root, { subtree: true, attributes: true, childList: true, characterData: true });
    for (let i = 0; i < 30; i += 1) {
      step(0, 0);
      draw(STEP);
    }
    expect(watch.takeRecords()).toEqual([]);
    // ...and it is the turn that writes, when there is one.
    ship.heading = 0.5;
    draw(STEP);
    expect(watch.takeRecords().length).toBeGreaterThan(0);
    watch.disconnect();
  });

  it('writes nothing while it is out of sight either', () => {
    const { ship, navigator, root, draw } = deckOn();
    draw();
    navigator.state = { mode: 'docked', target: 'project/fishai' };
    draw();
    const watch = new MutationObserver(() => undefined);
    watch.observe(root, { subtree: true, attributes: true, childList: true, characterData: true });
    ship.heading = 2;
    ship.speed = 30;
    draw();
    expect(watch.takeRecords()).toEqual([]);
    watch.disconnect();
  });
});
