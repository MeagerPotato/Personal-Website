// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { Frame } from '../core/Engine';
import { tuning } from '../design/tuning';
import { boundsOf } from '../sim/mapView';
import { MiniMap, type MiniMapBody, type MiniMapSystem } from './MiniMap';

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
  const world = { at: -1, target: -1, room: true, map: false };
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
  const caption = (): string => root.querySelector('.minimap__caption')?.textContent ?? '';
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
    caption,
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

/** A point of the map where nothing is: its top left corner, far from every mark of the test. */
const NOWHERE = [6, 6] as const;

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
    expect(map.getAttribute('viewBox')).toBe('0 0 130 130');
    map.getBoundingClientRect = () => ({ width: 166, height: 166 }) as DOMRect;
    minimap.resize();
    expect(map.getAttribute('viewBox')).toBe('0 0 166 166');
    // Hidden, it has no size to measure, and keeps the one it had.
    world.room = false;
    draw();
    map.getBoundingClientRect = () => ({ width: 0, height: 0 }) as DOMRect;
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
    const { root, shows, at, caption } = mapOn();
    expect(root.dataset.scope).toBe('galaxy');
    expect(caption()).toBe('Galaxy');
    expect(root.querySelector('.minimap__caption')?.hasAttribute('data-theme')).toBe(false);
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
        expect(px).toBeLessThan(130);
      }
    }
  });

  it('is the system the ship is in: its bodies in place, every other system a pin at the rim', () => {
    const { root, enter, settle, shows, at, mark, caption } = mapOn();
    enter(0);
    settle();
    expect(root.dataset.scope).toBe('home');
    expect(caption()).toBe('Home');
    expect(root.querySelector('.minimap__caption')?.getAttribute('data-theme')).toBe('butter');
    // Home in the middle, its station to the LEFT of it (+X), at the size its kind is given.
    expect(at(HOME)).toEqual([65, 65]);
    expect(shows(STATION)).toBe(true);
    expect(at(STATION)[0]).toBeLessThan(65);
    expect(at(STATION)[1]).toBe(65);
    expect(Number(mark(STATION).getAttribute('r'))).toBeGreaterThanOrEqual(
      P.minRadiusPx.system.station,
    );
    // Projects is off the map: its sun is pinned inside the rim, up and to the right, in outline.
    expect(mark(SUN).hasAttribute('data-pin')).toBe(true);
    const [pinX, pinY] = at(SUN);
    expect(pinX).toBeCloseTo(130 - P.rimInsetPx, 1);
    expect(pinY).toBeCloseTo(P.rimInsetPx, 1);
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
    expect(cut.at(HOME)).toEqual([65, 65]);
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
    expect(Number(station?.getAttribute('r'))).toBeCloseTo(65 - (at(STATION)[0] ?? 0), 0);
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

  it('rings the mark a mouse is over and names it in the caption, until the mouse leaves', () => {
    const { root, enter, settle, at, mark, caption, fire } = mapOn();
    const ring = root.querySelector('.minimap__aim') as Element;
    const label = root.querySelector('.minimap__caption') as Element;
    expect(ring.hasAttribute('data-off')).toBe(true);
    fire('pointermove', at(SUN));
    expect(ring.hasAttribute('data-off')).toBe(false);
    expect([Number(ring.getAttribute('cx')), Number(ring.getAttribute('cy'))]).toEqual(at(SUN));
    expect(Number(ring.getAttribute('r'))).toBeGreaterThan(P.minRadiusPx.galaxy.sun);
    expect(caption()).toBe('Software');
    expect(label.getAttribute('data-theme')).toBe('sky');
    expect(label.hasAttribute('data-aim')).toBe(true);
    fire('pointerleave', at(SUN));
    expect(ring.hasAttribute('data-off')).toBe(true);
    expect(caption()).toBe('Galaxy');
    expect(label.hasAttribute('data-aim')).toBe(false);

    // Planned work says so, as its name in the sky does.
    enter(1);
    settle();
    expect(mark(MOON).hasAttribute('data-off')).toBe(false);
    fire('pointermove', at(MOON));
    expect(caption()).toBe('Fish Online, Planned');
    expect(label.querySelector('.minimap__note')?.parentElement).toBe(label);
    fire('pointermove', at(PLANET));
    expect(caption()).toBe('Days2Meet');
    expect(label.querySelector('.minimap__note')).toBeNull();
  });

  it('aims again when the marks have moved under a mouse at rest', () => {
    const { root, positions, draw, at, caption, fire } = mapOn();
    fire('pointermove', at(SUN));
    expect(caption()).toBe('Software');
    // The sun goes elsewhere; the mouse stays.
    positions[4] = -300;
    positions[5] = 300;
    draw();
    expect(caption()).toBe('Galaxy');
    expect(root.hasAttribute('data-pick')).toBe(false);
  });

  it('gives a finger the aim only while it is down, and only where it is clear which mark it means', () => {
    const { root, world, enter, settle, picked, opened, at, caption, fire, tap } = mapOn();
    // A finger that only moves over the map (no press) aims at nothing.
    fire('pointermove', at(SUN), 'touch');
    expect(root.hasAttribute('data-pick')).toBe(false);
    fire('pointerdown', at(SUN), 'touch');
    expect(caption()).toBe('Software');
    fire('pointerup', at(SUN), 'touch', 90);
    expect(picked).toEqual([SUN]);
    // Lifted, it aims at nothing any more.
    expect(caption()).toBe('Galaxy');
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
