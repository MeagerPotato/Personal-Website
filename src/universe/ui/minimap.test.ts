// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { Frame } from '../core/Engine';
import { tuning } from '../design/tuning';
import { boundsOf } from '../sim/mapView';
import { createPath } from '../sim/path';
import { MiniMap, type MiniJourney, type MiniMapBody, type MiniMapSystem } from './MiniMap';

const P = tuning.minimap;
const STEP = 1 / 60;
/** The marks are put in place this often: a frame this long after the last has them in place. */
const TICK = 1 / P.bodiesHz;

/**
 * A galaxy of two systems. Home at the origin, with its station; and Projects far out to the
 * north and to -X (which is to the RIGHT on a map), with a sun, a planet, a moon that is only
 * planned, and a relay nothing docks at.
 */
const SYSTEMS: MiniMapSystem[] = [
  { id: 'home', name: 'Home', theme: 'butter', position: [0, 0], radius: 66, center: 'page/about' },
  {
    id: 'projects',
    name: 'Projects',
    theme: 'sky',
    position: [-900, 900],
    radius: 300,
    center: 'system/software',
  },
];
const HOME = 0;
const STATION = 1;
const SUN = 2;
const PLANET = 3;
const MOON = 4;
const RELAY = 5;
const BODIES: MiniMapBody[] = [
  { id: 'page/about', title: 'About Me', kind: 'home', planned: false, theme: 'butter', system: 0 },
  {
    id: 'page/resume',
    title: 'Resume',
    kind: 'station',
    planned: false,
    theme: 'butter',
    system: 0,
  },
  {
    id: 'system/software',
    title: 'Software',
    kind: 'sun',
    planned: false,
    theme: 'sky',
    system: 1,
  },
  {
    id: 'project/days',
    title: 'Days2Meet',
    kind: 'planet',
    planned: false,
    theme: 'sky',
    system: 1,
  },
  {
    id: 'project/moon',
    title: 'Fish Online',
    kind: 'moon',
    planned: true,
    theme: 'sky',
    system: 1,
  },
  { id: 'link/github', title: 'GitHub', kind: 'link', planned: false, theme: 'butter', system: 0 },
];

function setup(reducedMotion = false) {
  document.body.innerHTML = '<div id="overlay"><button class="dock-prompt"></button></div>';
  const overlay = document.getElementById('overlay') as HTMLElement;
  // [x0, z0, x1, z1, ...]: the station 40 u from home, the planet 200 u from its sun, its moon 60.
  const positions = new Float64Array([0, 0, 40, 0, -900, 900, -700, 900, -700, 960, 0, 59]);
  const ship = { position: { x: 0, z: -100 }, heading: 0 };
  const world = {
    at: -1,
    target: -1,
    room: true,
    map: false,
    journey: null as MiniJourney | null,
  };
  const picked: number[] = [];
  let opened = 0;
  const minimap = new MiniMap({
    overlay,
    systems: SYSTEMS,
    bodies: BODIES,
    orbits: {
      parent: [-1, HOME, -1, SUN, PLANET, HOME],
      radius: [0, 40, 0, 200, 60, 59],
      centerX: [0, 0, -900, -900, -900, 0],
      centerZ: [0, 0, 900, 900, 900, 0],
    },
    radii: [22, 2.5, 34, 10, 4.5, 2],
    docks: [1, 1, 1, 1, 1, 0],
    positions,
    bounds: boundsOf(SYSTEMS),
    ship,
    at: () => world.at,
    target: () => world.target,
    journey: () => world.journey,
    room: () => world.room,
    mapOpen: () => world.map,
    onPick: (row) => picked.push(row),
    onMap: () => (opened += 1),
    params: P,
    picking: tuning.picking,
    reducedMotion,
  });
  const root = overlay.querySelector('.minimap') as HTMLElement;
  let elapsed = 0;
  /** One frame, long enough after the last for the marks to be put in place, unless told. */
  const draw = (after = TICK, dt = STEP): void => {
    elapsed += after;
    minimap.frameUpdate({ elapsed, dt, alpha: 1, simTime: elapsed } satisfies Frame);
  };
  /** Frames until the view has eased to where it is wanted. */
  const settle = (): void => {
    for (let frame = 0; frame < 240; frame += 1) draw(STEP);
  };
  /** Put the ship inside a system (a little south of its heart), or out between them (-1). */
  const enter = (system: number): void => {
    const [x, z] = SYSTEMS[system]?.position ?? [0, 0];
    ship.position.x = x;
    ship.position.z = system < 0 ? -100 : z - 40;
    world.at = system;
  };
  const mark = (row: number): Element => {
    const found = root.querySelector(`[data-id="${BODIES[row]?.id}"]`);
    if (!found) throw new Error(`no mark for row ${row}`);
    return found;
  };
  const shows = (row: number): boolean => !mark(row).hasAttribute('data-off');
  /** Where something is on the map, in px from its top left corner. */
  const placeOf = (node: Element): [number, number] => {
    const [x = Number.NaN, y = Number.NaN] = (
      node.getAttribute('transform')?.match(/-?[\d.]+/g) ?? []
    ).map(Number);
    return [x, y];
  };
  const at = (row: number): [number, number] => placeOf(mark(row));
  const pill = (): string => root.querySelector('.minimap__name')?.textContent ?? '';
  /** What the chip says: its word, its figures and their unit. */
  const chip = (): string =>
    [...root.querySelectorAll('.minimap__range > *')].map((node) => node.textContent).join(' ');
  let stamp = 1000;
  const fire = (
    type: string,
    [x, y]: readonly [number, number],
    pointerType = 'mouse',
    afterMs = 0,
  ): void => {
    stamp += afterMs;
    const event = new PointerEvent(type, {
      pointerId: pointerType === 'mouse' ? 1 : 7,
      clientX: x,
      clientY: y,
      pointerType,
      button: 0,
      bubbles: true,
    });
    Object.defineProperty(event, 'timeStamp', { value: stamp });
    root.dispatchEvent(event);
  };
  /** A press and its release at one point, 90 ms apart. */
  const tap = (point: readonly [number, number], pointerType = 'mouse'): void => {
    fire('pointerdown', point, pointerType);
    fire('pointerup', point, pointerType, 90);
  };
  return {
    overlay,
    minimap,
    root,
    positions,
    ship,
    world,
    picked,
    opened: () => opened,
    draw,
    settle,
    enter,
    mark,
    shows,
    placeOf,
    at,
    pill,
    chip,
    fire,
    tap,
  };
}

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function mapOn(reducedMotion = false) {
  const made = setup(reducedMotion);
  cleanup = () => made.minimap.dispose();
  made.minimap.resize();
  made.draw();
  return made;
}

/** A point of the face where nothing is: up and to the left, far from every mark of the test. */
const NOWHERE = [25, 25] as const;

describe('the minimap, as a thing on the page', () => {
  it('is a picture: hidden from assistive technology, with nothing to focus, last in the overlay', () => {
    const { overlay, root } = mapOn();
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(
      root.querySelectorAll('a, button, input, select, textarea, [tabindex], [contenteditable]'),
    ).toHaveLength(0);
    expect(overlay.lastElementChild).toBe(root);
  });

  it('has one mark for every body a ship can dock at, and none for a relay', () => {
    const { root, mark } = mapOn();
    expect(root.querySelectorAll('.minimap__mark')).toHaveLength(5);
    expect(root.querySelector(`[data-id="${BODIES[RELAY]?.id}"]`)).toBeNull();
    // A sun and the home planet are their family's glyph; the rest are discs.
    expect(mark(HOME).tagName).toBe('path');
    expect(mark(SUN).tagName).toBe('path');
    expect(mark(STATION).tagName).toBe('circle');
    expect(mark(SUN).getAttribute('data-kind')).toBe('sun');
    expect(mark(SUN).getAttribute('data-theme')).toBe('sky');
    expect(mark(MOON).hasAttribute('data-planned')).toBe(true);
    expect(mark(PLANET).hasAttribute('data-planned')).toBe(false);
    // The smaller kinds are drawn last, on top: a moon after its planet, a planet after its sun.
    const order = [...root.querySelectorAll('.minimap__mark')].map((node) =>
      node.getAttribute('data-kind'),
    );
    expect(order).toEqual(['home', 'sun', 'station', 'planet', 'moon']);
  });

  it('draws to the size of its map: one unit of the drawing is one px', () => {
    const { minimap, root, world, draw } = setup();
    cleanup = () => minimap.dispose();
    const map = root.querySelector('.minimap__map') as SVGElement;
    // (Nothing can be measured here until it is told: then it draws to its smallest size.)
    draw();
    expect(map.getAttribute('viewBox')).toBe('0 0 120 120');
    map.getBoundingClientRect = () => ({ left: 0, top: 0, width: 166, height: 166 }) as DOMRect;
    minimap.resize();
    expect(map.getAttribute('viewBox')).toBe('0 0 166 166');
    // Hidden, it has no size to measure, and keeps the one it had.
    world.room = false;
    draw();
    map.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 }) as DOMRect;
    minimap.resize();
    expect(map.getAttribute('viewBox')).toBe('0 0 166 166');
  });

  it('leaves no node behind', () => {
    const { overlay, minimap } = setup();
    minimap.resize();
    minimap.dispose();
    expect(overlay.querySelector('.minimap')).toBeNull();
    expect(overlay.children).toHaveLength(1);
  });
});

describe('when the minimap shows', () => {
  it('is there beside the deck at full size, flying or docked, and not on the star map', () => {
    const { root, world, minimap, draw, enter } = mapOn();
    expect(root.hidden).toBe(false);
    expect(root.hasAttribute('data-shown')).toBe(true);
    expect(minimap.box()).toBeNull(); // (nothing is laid out here: there is no box to give)
    // Docked: somebody is reading a page, and may want the next planet.
    enter(1);
    world.target = PLANET;
    draw();
    expect(root.hidden).toBe(false);
    expect(root.hasAttribute('data-shown')).toBe(true);
    // The star map is the same thing, larger.
    world.map = true;
    draw();
    expect(root.hasAttribute('data-shown')).toBe(false);
    world.map = false;
    draw();
    expect(root.hasAttribute('data-shown')).toBe(true);
    // Where the deck is the strip, or there is none: no minimap.
    world.room = false;
    draw();
    expect(root.hidden).toBe(true);
    world.room = true;
    draw();
    expect(root.hidden).toBe(false);
  });

  it('is out of the way until the engine has drawn a frame', () => {
    const { root, minimap } = setup();
    cleanup = () => minimap.dispose();
    expect(root.hidden).toBe(true);
    expect(minimap.box()).toBeNull();
  });

  it('tells the names where it is, while it shows', () => {
    const { root, minimap, world, draw } = mapOn();
    root.getBoundingClientRect = () =>
      ({ left: 1096, top: 604, width: 160, height: 184 }) as DOMRect;
    expect(minimap.box()).toEqual({ left: 1096, top: 604, width: 160, height: 184 });
    world.map = true;
    draw();
    expect(minimap.box()).toBeNull();
  });

  it('writes nothing while it does not show', () => {
    const { world, positions, draw, at } = mapOn();
    const before = at(SUN);
    world.map = true;
    positions[4] = -600;
    draw();
    draw();
    expect(at(SUN)).toEqual(before);
    world.map = false;
    draw();
    expect(at(SUN)).not.toEqual(before);
  });
});

describe('what the minimap looks at', () => {
  it('is the galaxy from between systems: north up and +X to the left, suns and home only', () => {
    const { root, shows, at, pill, chip } = mapOn();
    expect(root.dataset.scope).toBe('galaxy');
    expect(pill()).toBe('Galaxy');
    expect(root.querySelector('.minimap__name')?.hasAttribute('data-theme')).toBe(false);
    expect(chip()).toMatch(/^RANGE \d+(\.\d)? k?m$/);
    expect(shows(HOME)).toBe(true);
    expect(shows(SUN)).toBe(true);
    expect(shows(STATION)).toBe(false);
    expect(shows(PLANET)).toBe(false);
    // Projects lies to the north of home (up) and toward -X (right).
    const [homeX, homeY] = at(HOME);
    const [sunX, sunY] = at(SUN);
    expect(sunY).toBeLessThan(homeY);
    expect(sunX).toBeGreaterThan(homeX);
    // Nothing is pinned: all of it is on the map.
    expect(root.querySelectorAll('[data-pin]')).toHaveLength(0);
    for (const row of [HOME, SUN]) {
      for (const px of at(row)) {
        expect(px).toBeGreaterThan(0);
        expect(px).toBeLessThan(120);
      }
    }
  });

  it('is the system the ship is in: its bodies in place, every other system a pin at the rim', () => {
    const { root, enter, settle, shows, at, mark, pill, chip } = mapOn();
    enter(0);
    settle();
    expect(root.dataset.scope).toBe('home');
    expect(pill()).toBe('Home');
    expect(root.querySelector('.minimap__name')?.getAttribute('data-theme')).toBe('butter');
    // Home in the middle, its station to the LEFT of it (+X), at the size its kind is given.
    expect(at(HOME)).toEqual([60, 60]);
    expect(shows(STATION)).toBe(true);
    expect(at(STATION)[0]).toBeLessThan(60);
    expect(at(STATION)[1]).toBe(60);
    expect(Number(mark(STATION).getAttribute('r'))).toBeGreaterThanOrEqual(
      P.minRadiusPx.system.station,
    );
    // Projects is off the map: its sun is pinned inside the rim, up and to the right, in outline.
    expect(mark(SUN).hasAttribute('data-pin')).toBe(true);
    const [pinX, pinY] = at(SUN);
    // (On the circle of the pins: 45 degrees up and to the right of the middle of the face.)
    const reach = (60 - P.rimInsetPx) / Math.SQRT2;
    expect(pinX).toBeCloseTo(60 + reach, 1);
    expect(pinY).toBeCloseTo(60 - reach, 1);
    expect(chip()).toMatch(/^RANGE \d+ m$/);
    expect(shows(PLANET)).toBe(false);
    expect(mark(HOME).hasAttribute('data-pin')).toBe(false);
  });

  it('goes back to the galaxy when the ship is headed for another system, and stays for a body of its own', () => {
    const { root, world, enter, settle, shows } = mapOn();
    enter(0);
    settle();
    expect(root.dataset.scope).toBe('home');
    world.target = STATION;
    settle();
    expect(root.dataset.scope).toBe('home');
    world.target = PLANET;
    settle();
    expect(root.dataset.scope).toBe('galaxy');
    expect(shows(PLANET)).toBe(false);
    // Arrived: in that system, with its own bodies drawn.
    enter(1);
    settle();
    expect(root.dataset.scope).toBe('projects');
    expect(shows(PLANET)).toBe(true);
  });

  it('eases from one view to the next, and cuts for a visitor who asked for less motion', () => {
    const eased = mapOn();
    const far = eased.at(SUN);
    eased.enter(0);
    eased.draw(STEP);
    // One frame on, the sun has only begun to slide out toward the rim.
    const [x, y] = eased.at(SUN);
    expect(Math.hypot(x - (far[0] ?? 0), y - (far[1] ?? 0))).toBeLessThan(10);
    expect(eased.mark(SUN).hasAttribute('data-pin')).toBe(false);
    cleanup?.();

    const cut = mapOn(true);
    cut.enter(0);
    cut.draw(STEP);
    expect(cut.at(HOME)).toEqual([60, 60]);
    expect(cut.mark(SUN).hasAttribute('data-pin')).toBe(true);
  });

  it('draws the circle a body travels on round its parent, while that body is drawn', () => {
    const { root, enter, settle, at } = mapOn();
    const circles = [...root.querySelectorAll('.minimap__orbit')];
    // The station's, the planet's and the moon's: a sun at the heart of its system has none.
    expect(circles).toHaveLength(3);
    expect(circles.every((circle) => circle.hasAttribute('data-off'))).toBe(true);
    enter(0);
    settle();
    const [station] = circles.filter((circle) => !circle.hasAttribute('data-off'));
    expect(circles.filter((circle) => !circle.hasAttribute('data-off'))).toHaveLength(1);
    expect(station?.getAttribute('data-theme')).toBe('butter');
    expect([Number(station?.getAttribute('cx')), Number(station?.getAttribute('cy'))]).toEqual(
      at(HOME),
    );
    // As far out as the station is from home.
    expect(Number(station?.getAttribute('r'))).toBeCloseTo(60 - (at(STATION)[0] ?? 0), 0);
  });
});

describe('the ship and the marks', () => {
  it('puts the ship in place every frame, turned to its bearing', () => {
    const { root, ship, draw, placeOf, at } = mapOn();
    const chevron = root.querySelector('.minimap__ship') as Element;
    const [x0, y0] = placeOf(chevron);
    // South of home: below it on the map.
    expect(x0).toBeCloseTo(at(HOME)[0] ?? 0, 0);
    expect(y0).toBeGreaterThan(at(HOME)[1] ?? 0);
    expect(chevron.getAttribute('transform')).toContain('rotate(0)');
    // A sixtieth of a second later it has flown north and turned to the west (a quarter left).
    ship.position.z = 300;
    ship.heading = Math.PI / 2;
    draw(STEP);
    expect(placeOf(chevron)[1]).toBeLessThan(y0);
    expect(chevron.getAttribute('transform')).toContain('rotate(270)');
    expect(chevron.getAttribute('transform')).toContain(`scale(${P.shipPx / 10})`);
  });

  it('puts the marks in place bodiesHz times a second', () => {
    const { positions, draw, at } = mapOn();
    const before = at(SUN);
    positions[4] = -600;
    draw(STEP);
    expect(at(SUN)).toEqual(before);
    draw(TICK);
    expect((at(SUN)[0] ?? 0) - (before[0] ?? 0)).toBeLessThan(-10);
  });
});

describe('pointing at the minimap', () => {
  it('flies to the mark a press is let go on, by the canvas’s own call', () => {
    const { picked, opened, at, tap } = mapOn();
    tap(at(SUN));
    expect(picked).toEqual([SUN]);
    expect(opened()).toBe(0);
    // A finger too.
    tap(at(HOME), 'touch');
    expect(picked).toEqual([SUN, HOME]);
  });

  it('opens the star map for a tap where nothing is, and does nothing for a drag that ends there', () => {
    const { picked, opened, fire, tap } = mapOn();
    tap(NOWHERE);
    expect(opened()).toBe(1);
    // A press that travels...
    fire('pointerdown', NOWHERE);
    fire('pointermove', [60, 6]);
    fire('pointerup', [60, 6], 'mouse', 90);
    expect(opened()).toBe(1);
    // ...or lingers is no tap.
    fire('pointerdown', NOWHERE);
    fire('pointerup', NOWHERE, 'mouse', 900);
    expect(opened()).toBe(1);
    expect(picked).toEqual([]);
  });

  it('aims, then lets go: a press that slides onto a mark flies there', () => {
    const { root, picked, opened, at, fire } = mapOn();
    fire('pointerdown', NOWHERE);
    expect(root.hasAttribute('data-pick')).toBe(false);
    fire('pointermove', at(SUN));
    expect(root.hasAttribute('data-pick')).toBe(true);
    fire('pointerup', at(SUN), 'mouse', 900);
    expect(picked).toEqual([SUN]);
    expect(opened()).toBe(0);
  });

  it('does nothing at all for a press on the mark of where the ship is, or is headed', () => {
    const { world, picked, opened, root, draw, at, tap, fire } = mapOn();
    world.target = SUN;
    draw();
    fire('pointermove', at(SUN));
    expect(root.hasAttribute('data-pick')).toBe(false);
    tap(at(SUN));
    expect(picked).toEqual([]);
    expect(opened()).toBe(0);
  });

  it('ignores the other mouse buttons, and a release it saw no press of', () => {
    const { root, picked, opened, at } = mapOn();
    const fireButton = (type: string, button: number): void => {
      const [x, y] = at(SUN);
      root.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 1,
          clientX: x,
          clientY: y,
          pointerType: 'mouse',
          button,
        }),
      );
    };
    fireButton('pointerdown', 2);
    fireButton('pointerup', 2);
    fireButton('pointerup', 0);
    expect(picked).toEqual([]);
    expect(opened()).toBe(0);
  });

  it('rings the mark a mouse is over and names it on the pill, until the mouse leaves', () => {
    const { root, enter, settle, at, mark, pill, fire } = mapOn();
    const ring = root.querySelector('.minimap__aim') as Element;
    const label = root.querySelector('.minimap__name') as Element;
    expect(ring.hasAttribute('data-off')).toBe(true);
    fire('pointermove', at(SUN));
    expect(ring.hasAttribute('data-off')).toBe(false);
    expect([Number(ring.getAttribute('cx')), Number(ring.getAttribute('cy'))]).toEqual(at(SUN));
    expect(Number(ring.getAttribute('r'))).toBeGreaterThan(P.minRadiusPx.galaxy.sun);
    expect(pill()).toBe('Software');
    expect(label.getAttribute('data-theme')).toBe('sky');
    expect(label.hasAttribute('data-lit')).toBe(true);
    fire('pointerleave', at(SUN));
    expect(ring.hasAttribute('data-off')).toBe(true);
    expect(pill()).toBe('Galaxy');
    expect(label.hasAttribute('data-lit')).toBe(false);

    // Planned work says so, as its name in the sky does.
    enter(1);
    settle();
    expect(mark(MOON).hasAttribute('data-off')).toBe(false);
    fire('pointermove', at(MOON));
    expect(pill()).toBe('Fish Online, Planned');
    expect(label.querySelector('.minimap__note')?.parentElement).toBe(label);
    fire('pointermove', at(PLANET));
    expect(pill()).toBe('Days2Meet');
    expect(label.querySelector('.minimap__note')).toBeNull();
  });

  it('aims again when the marks have moved under a mouse at rest', () => {
    const { root, positions, draw, at, pill, fire } = mapOn();
    fire('pointermove', at(SUN));
    expect(pill()).toBe('Software');
    // The sun goes elsewhere; the mouse stays.
    positions[4] = -300;
    positions[5] = 300;
    draw();
    expect(pill()).toBe('Galaxy');
    expect(root.hasAttribute('data-pick')).toBe(false);
  });

  it('gives a finger the aim only while it is down, and only where it is clear which mark it means', () => {
    const { root, world, enter, settle, picked, opened, at, pill, fire, tap } = mapOn();
    // A finger that only moves over the map (no press) aims at nothing.
    fire('pointermove', at(SUN), 'touch');
    expect(root.hasAttribute('data-pick')).toBe(false);
    fire('pointerdown', at(SUN), 'touch');
    expect(pill()).toBe('Software');
    fire('pointerup', at(SUN), 'touch', 90);
    expect(picked).toEqual([SUN]);
    // Lifted, it aims at nothing any more.
    expect(pill()).toBe('Galaxy');
    expect(root.hasAttribute('data-pick')).toBe(false);

    // Between a planet and its moon, a few px apart, a finger means neither: its tap opens the
    // star map, where they are apart.
    enter(1);
    settle();
    const [planetX, planetY] = at(PLANET);
    const [moonX, moonY] = at(MOON);
    expect(Math.hypot(planetX - moonX, planetY - moonY)).toBeLessThan(20);
    const between = [(planetX + moonX) / 2, (planetY + moonY) / 2] as const;
    tap(between, 'touch');
    expect(picked).toEqual([SUN]);
    expect(opened()).toBe(1);
    // A mouse there means the nearer one.
    tap(between);
    expect(picked).toEqual([SUN, PLANET]);
    // And docked at the moon, the finger means the planet: where the ship is, is no rival.
    world.target = MOON;
    tap(between, 'touch');
    expect(picked).toEqual([SUN, PLANET, PLANET]);
  });
});

/** A straight way from one point to another, in 41 samples, as the autopilot holds its path. */
function wayFrom(x0: number, z0: number, x1: number, z1: number): MiniJourney['path'] {
  const path = createPath();
  path.count = 41;
  for (let i = 0; i < path.count; i += 1) {
    path.x[i] = x0 + ((x1 - x0) * i) / (path.count - 1);
    path.z[i] = z0 + ((z1 - z0) * i) / (path.count - 1);
  }
  return path;
}

describe('a journey, read as fast forward', () => {
  it('rings the body the ship is at or headed for, at once, whatever the scale draws of it', () => {
    const { root, world, draw, at, shows } = mapOn();
    const here = root.querySelector('.minimap__here') as Element;
    const ring = (): number[] => ['cx', 'cy', 'r'].map((name) => Number(here.getAttribute(name)));
    expect(here.hasAttribute('data-off')).toBe(true);
    // A new target is ringed with the next frame, not with the next turn of the marks.
    world.target = SUN;
    draw(STEP);
    expect(here.hasAttribute('data-off')).toBe(false);
    expect(ring()).toEqual([...at(SUN), P.minRadiusPx.galaxy.sun + 4]);
    // A planet has no mark on the galaxy: the ring stands where it is all the same, 200 u from
    // its sun toward +X, which is to the left.
    world.target = PLANET;
    draw(STEP);
    expect(shows(PLANET)).toBe(false);
    expect(here.hasAttribute('data-off')).toBe(false);
    const [sunX = 0, sunY = 0] = at(SUN);
    const [x = 0, y = 0, r] = ring();
    expect(r).toBe(4);
    expect(y).toBeCloseTo(sunY, 0);
    expect(x).toBeLessThan(sunX - 10);
    // And it is not the ring of a pointer's aim, which never falls on that body.
    expect(root.querySelector('.minimap__aim')?.hasAttribute('data-off')).toBe(true);
    world.target = -1;
    draw(STEP);
    expect(here.hasAttribute('data-off')).toBe(true);
  });

  it('draws the way that is left, from the ship to the journey’s end, and takes it away after', () => {
    const { root, ship, world, draw, at, placeOf } = mapOn();
    const route = root.querySelector('.minimap__route') as Element;
    const chevron = root.querySelector('.minimap__ship') as Element;
    const line = (): number[][] =>
      (route.getAttribute('points') ?? '')
        .split(' ')
        .filter(Boolean)
        .map((pair) => pair.split(',').map(Number));
    // Flying by hand there is no line, and none is written.
    expect(route.hasAttribute('points')).toBe(false);

    const path = wayFrom(0, -100, -900, 900);
    world.target = SUN;
    world.journey = { path, index: 0, etaSec: 4.2 };
    draw(STEP);
    const whole = line();
    // No more points than the tuning allows: the first is the ship, the last the journey's end.
    expect(whole.length).toBeGreaterThan(2);
    expect(whole.length).toBeLessThanOrEqual(P.routePoints);
    expect(whole[0]).toEqual(placeOf(chevron));
    expect(whole.at(-1)?.[0]).toBeCloseTo(at(SUN)[0] ?? 0, 0);
    expect(whole.at(-1)?.[1]).toBeCloseTo(at(SUN)[1] ?? 0, 0);

    // Half way there: it begins at the ship, where the ship now is, and is only the rest.
    ship.position.x = path.x[20] ?? 0;
    ship.position.z = path.z[20] ?? 0;
    world.journey = { path, index: 20, etaSec: 2 };
    draw(STEP);
    const rest = line();
    expect(rest[0]).toEqual(placeOf(chevron));
    expect(rest[0]).not.toEqual(whole[0]);
    expect(rest.at(-1)).toEqual(whole.at(-1));
    const length = (points: number[][]): number =>
      points
        .slice(1)
        .reduce(
          (sum, [x = 0, y = 0], i) =>
            sum + Math.hypot(x - (points[i]?.[0] ?? 0), y - (points[i]?.[1] ?? 0)),
          0,
        );
    expect(length(rest)).toBeCloseTo(length(whole) / 2, 0);

    // On its last piece there is still a line, to the end; arrived or stopped, there is none.
    world.journey = { path, index: 39, etaSec: 0.1 };
    draw(STEP);
    expect(line()).toHaveLength(2);
    world.journey = null;
    draw(STEP);
    expect(route.getAttribute('points')).toBe('');
  });

  it('names where the journey is headed and counts its seconds down, never up', () => {
    const { root, world, draw, at, chip, fire } = mapOn();
    const label = root.querySelector('.minimap__name') as Element;
    const range = root.querySelector('.minimap__range') as Element;
    const name = (): string => label.querySelector('b')?.textContent ?? '';
    const path = wayFrom(0, -100, -900, 900);
    // At rest the chip says how far the face reaches.
    expect(chip()).toMatch(/^RANGE /);
    expect(range.hasAttribute('data-eta')).toBe(false);

    world.target = SUN;
    world.journey = { path, index: 0, etaSec: 4.2 };
    draw(STEP);
    expect(name()).toBe('Software');
    expect(chip()).toBe('ETA 5 s');
    expect(range.hasAttribute('data-eta')).toBe(true);
    expect(label.getAttribute('data-theme')).toBe('sky');
    expect(label.hasAttribute('data-lit')).toBe(true);
    // With the frame it changes in, not with the next turn of the marks.
    world.journey = { path, index: 4, etaSec: 3.9 };
    draw(STEP);
    expect(chip()).toBe('ETA 4 s');
    // The autopilot plans again and finds the way a little longer: the count does not go up.
    world.journey = { path, index: 6, etaSec: 4.6 };
    draw(STEP);
    expect(chip()).toBe('ETA 4 s');
    world.journey = { path, index: 20, etaSec: 1.5 };
    draw(STEP);
    expect(chip()).toBe('ETA 2 s');

    // A pointer's aim comes first, and the chip speaks of the face again; then the journey.
    fire('pointermove', at(HOME));
    expect(name()).toBe('About Me');
    expect(chip()).toMatch(/^RANGE /);
    expect(range.hasAttribute('data-eta')).toBe(false);
    fire('pointerleave', at(HOME));
    expect(name()).toBe('Software');
    expect(chip()).toBe('ETA 2 s');

    // Sent on to another body while it flies: a new journey, counted from its own first plan.
    world.target = HOME;
    world.journey = { path: wayFrom(-450, 400, 0, 0), index: 0, etaSec: 8.5 };
    draw(STEP);
    expect(name()).toBe('About Me');
    expect(chip()).toBe('ETA 9 s');
    expect(label.getAttribute('data-theme')).toBe('butter');

    // Arrived, or stopped: the pill says what the scope shows again, and the chip how far.
    world.journey = null;
    world.target = -1;
    draw(STEP);
    expect(name()).toBe('Galaxy');
    expect(chip()).toMatch(/^RANGE /);
    expect(range.hasAttribute('data-eta')).toBe(false);
    expect(label.hasAttribute('data-lit')).toBe(false);
  });

  it('counts afresh when it comes back from the star map in the middle of a journey', () => {
    const { world, draw, chip } = mapOn();
    const path = wayFrom(0, -100, -900, 900);
    world.target = SUN;
    world.journey = { path, index: 0, etaSec: 1.2 };
    draw(STEP);
    expect(chip()).toBe('ETA 2 s');
    // Stopped on the map and sent there again: another journey to the same body, a longer one.
    world.map = true;
    draw(STEP);
    world.journey = { path, index: 0, etaSec: 5.5 };
    world.map = false;
    draw(STEP);
    expect(chip()).toBe('ETA 6 s');
  });

  it('runs the rim down as the journey’s clock, and puts it away after', () => {
    const { root, world, draw } = mapOn();
    const clock = root.querySelector('.minimap__left') as SVGElement;
    const gone = (): string => clock.style.getPropertyValue('--gone');
    const path = wayFrom(0, -100, -900, 900);
    expect(clock.hasAttribute('data-off')).toBe(true);

    world.target = SUN;
    world.journey = { path, index: 0, etaSec: 4.2 };
    draw(STEP);
    // Five seconds to go: it is told where to be when the chip counts one less, a fifth gone,
    // and the stylesheet glides it there.
    expect(clock.hasAttribute('data-off')).toBe(false);
    expect(gone()).toBe('0.2');
    world.journey = { path, index: 4, etaSec: 3.9 };
    draw(STEP);
    expect(gone()).toBe('0.4');
    // The plan grows a little: the seconds do not go up, and the clock does not run back.
    world.journey = { path, index: 6, etaSec: 4.6 };
    draw(STEP);
    expect(gone()).toBe('0.4');
    world.journey = { path, index: 20, etaSec: 1.5 };
    draw(STEP);
    expect(gone()).toBe('0.8');
    world.journey = { path, index: 20, etaSec: 0.4 };
    draw(STEP);
    expect(gone()).toBe('1');

    // Sent on to another body: a new journey, and a clock of its own nine seconds.
    world.target = HOME;
    world.journey = { path: wayFrom(-450, 400, 0, 0), index: 0, etaSec: 8.5 };
    draw(STEP);
    expect(gone()).toBe('0.111');

    // Arrived, or stopped: put away, to be wound up unseen.
    world.journey = null;
    world.target = -1;
    draw(STEP);
    expect(clock.hasAttribute('data-off')).toBe(true);
    expect(gone()).toBe('0');
  });

  it('steps the clock with the seconds for a visitor who asked for less motion', () => {
    const { root, world, draw } = mapOn(true);
    const clock = root.querySelector('.minimap__left') as SVGElement;
    const gone = (): string => clock.style.getPropertyValue('--gone');
    const path = wayFrom(0, -100, -900, 900);
    world.target = SUN;
    world.journey = { path, index: 0, etaSec: 4.2 };
    draw(STEP);
    // Nothing glides: it shows the seconds as they stand, whole at the start.
    expect(gone()).toBe('0');
    world.journey = { path, index: 4, etaSec: 3.9 };
    draw(STEP);
    expect(gone()).toBe('0.2');
    world.journey = { path, index: 20, etaSec: 0.4 };
    draw(STEP);
    expect(gone()).toBe('0.8');
  });
});

describe('the scope, as an instrument', () => {
  it('is the ball’s sibling in its parts: a pill, a plate with the face on it, a chip', () => {
    const { root } = mapOn();
    expect([...root.children].map((node) => node.className)).toEqual([
      'minimap__name',
      'minimap__plate',
      'minimap__range',
    ]);
    const map = root.querySelector('.minimap__plate > .minimap__map') as Element;
    expect(map).not.toBeNull();
    // Under every mark: the two rings of dots (a third and two thirds of the way out) and north.
    const order = [...map.children].map((node) => node.getAttribute('class') ?? node.tagName);
    expect(order.slice(0, 3)).toEqual(['minimap__dots', 'minimap__dots', 'minimap__north']);
    expect(
      [...map.querySelectorAll('.minimap__dots')].map((ring) => [
        ring.getAttribute('r'),
        ring.getAttribute('pathLength'),
      ]),
    ).toEqual([
      ['16.67%', '12'],
      ['33.33%', '24'],
    ]);
    expect(map.querySelector('.minimap__north')?.textContent).toBe('N');
    // Over every mark: the journey's clock, "here", a pointer's aim, and the ship on top.
    expect(order.slice(-4)).toEqual([
      'minimap__left',
      'minimap__here',
      'minimap__aim',
      'minimap__ship',
    ]);
  });

  it('measures a pointer from the face, wherever the face lies in its box', () => {
    const { minimap, root, enter, settle, draw, at, picked, opened, pill, fire, tap } = mapOn();
    // The face 14 px in and 27 px down in the instrument's box, as the stylesheet puts it.
    const map = root.querySelector('.minimap__map') as SVGElement;
    map.getBoundingClientRect = () => ({ left: 14, top: 27, width: 148, height: 148 }) as DOMRect;
    root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 176, height: 200 }) as DOMRect;
    minimap.resize();
    draw();
    const inBox = ([x, y]: readonly [number, number]): [number, number] => [x + 14, y + 27];
    fire('pointermove', inBox(at(SUN)));
    expect(pill()).toBe('Software');
    tap(inBox(at(SUN)));
    expect(picked).toEqual([SUN]);

    // From inside home the sun is a pin, 9 px inside the rim. A finger on the plate's band beside
    // it, 12 px further out than the pin, means the pin: the band is part of the instrument.
    enter(0);
    settle();
    const [pinX, pinY] = at(SUN);
    const out = 12 / Math.hypot(pinX - 74, pinY - 74);
    const beside: [number, number] = [pinX + (pinX - 74) * out, pinY + (pinY - 74) * out];
    expect(Math.hypot(beside[0] - 74, beside[1] - 74)).toBeGreaterThan(74);
    tap(inBox(beside), 'touch');
    expect(picked).toEqual([SUN, SUN]);

    // A tap on the pill, above the plate: nothing is there, so the star map opens.
    expect(opened()).toBe(0);
    tap([88, 10]);
    expect(opened()).toBe(1);
    expect(picked).toEqual([SUN, SUN]);
  });
});
