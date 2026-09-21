// @vitest-environment happy-dom
import { PerspectiveCamera, Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyPose, createPose } from '../camera/CameraRig';
import { MapCam } from '../camera/MapCam';
import type { Frame } from '../core/Engine';
import { boundsOf } from '../sim/mapView';
import { StarMap, type StarMapParams } from './StarMap';

const PARAMS: StarMapParams = {
  blendSec: 1,
  spanMin: 400,
  spanMax: 7000,
  fitMargin: 1.25,
  viewOmega: 12,
  wheelZoomPerPx: 0.0015,
  wheelOpenPx: 100,
  keyPanPxPerSec: 600,
  keyZoomStep: 1.5,
};
// The home system, and one system up and to the left of it.
const BOUNDS = boundsOf([
  { position: [0, 0], radius: 66 },
  { position: [-735, 618], radius: 203 },
]);
const frame = (dt: number): Frame => ({ elapsed: 0, dt, alpha: 1, simTime: 0 });

function setup({ reducedMotion = false, overlay = true, freeWidth = 1 } = {}) {
  const canvas = document.createElement('canvas');
  const layer = document.createElement('div');
  document.body.append(canvas, layer);
  const changes: [boolean, boolean][] = [];
  const map = new StarMap({
    canvas,
    overlay: overlay ? layer : undefined,
    bounds: BOUNDS,
    view: { freeWidth, freeHeight: 1 },
    params: PARAMS,
    reducedMotion,
    onChange: (open, cut) => changes.push([open, cut]),
  });
  map.resize({ width: 1280, height: 800, pixelRatio: 1 });
  const key = (code: string, init: KeyboardEventInit = {}, target: EventTarget = window) => {
    const event = new KeyboardEvent('keydown', {
      code,
      key: code === 'Escape' ? 'Escape' : code,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    target.dispatchEvent(event);
    return event;
  };
  const keyUp = (code: string): void => {
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
  };
  let stamp = 1000;
  const wheel = (deltaY: number, init: WheelEventInit = {}, afterMs = 16) => {
    stamp += afterMs;
    const event = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true, ...init });
    Object.defineProperty(event, 'timeStamp', { value: stamp });
    // (happy-dom's WheelEvent is not a MouseEvent: no pointer position, no modifier keys.)
    Object.defineProperty(event, 'clientX', { value: init.clientX ?? 0 });
    Object.defineProperty(event, 'clientY', { value: init.clientY ?? 0 });
    Object.defineProperty(event, 'ctrlKey', { value: init.ctrlKey ?? false });
    Object.defineProperty(event, 'metaKey', { value: init.metaKey ?? false });
    canvas.dispatchEvent(event);
    return event;
  };
  const pointer = (type: string, id: number, x: number, y: number, pointerType = 'mouse') => {
    canvas.dispatchEvent(
      new PointerEvent(type, {
        pointerId: id,
        clientX: x,
        clientY: y,
        pointerType,
        button: 0,
        bubbles: true,
      }),
    );
  };
  const run = (seconds: number): void => {
    for (let t = 0; t < seconds; t += 1 / 60) map.frameUpdate(frame(1 / 60));
  };
  const button = (): HTMLButtonElement | null => layer.querySelector('button.map-toggle');
  return { canvas, layer, map, changes, key, keyUp, wheel, pointer, run, button };
}

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = '';
});

describe('StarMap, opening and closing', () => {
  it('opens with M or its button, eases there, and says so', () => {
    const { map, changes, key, run, button, canvas } = setup();
    cleanup = () => map.dispose();
    expect(map.isOpen).toBe(false);
    expect(map.weight).toBe(0);
    expect(button()?.textContent).toBe('MMap');

    const pressed = key('KeyM');
    expect(pressed.defaultPrevented).toBe(true);
    expect(map.isOpen).toBe(true);
    expect(changes).toEqual([[true, false]]);
    expect(button()?.textContent).toBe('MClose map');
    expect(canvas.dataset.map).toBe('');
    // The way there takes blendSec, eased: slow, fast, slow.
    run(0.5);
    expect(map.weight).toBeCloseTo(0.5, 1);
    run(0.6);
    expect(map.weight).toBe(1);

    button()?.click();
    expect(map.isOpen).toBe(false);
    expect(changes).toEqual([
      [true, false],
      [false, false],
    ]);
    expect(canvas.dataset.map).toBeUndefined();
    run(1.1);
    expect(map.weight).toBe(0);
  });

  it('ignores a held M, and keys that belong to the page or the browser', () => {
    const { map, key } = setup();
    cleanup = () => map.dispose();
    key('KeyM', { repeat: true });
    key('KeyM', { ctrlKey: true });
    const field = document.createElement('input');
    const reading = document.createElement('main');
    reading.dataset.flightKeys = 'off';
    document.body.append(field, reading);
    key('KeyM', {}, field);
    key('KeyM', {}, reading);
    expect(map.isOpen).toBe(false);
  });

  it('closes on Escape before the page hears of it, and leaves Escape alone when closed', () => {
    const { map, key } = setup();
    cleanup = () => map.dispose();
    // The page's own Escape handler (shell/panel.ts) skips an event somebody has dealt with.
    const page = vi.fn((event: Event) => event.defaultPrevented);
    document.addEventListener('keydown', page);

    key('Escape', {}, document.body);
    expect(page).toHaveLastReturnedWith(false);

    map.setOpen(true);
    key('Escape', {}, document.body);
    expect(map.isOpen).toBe(false);
    expect(page).toHaveLastReturnedWith(true);

    // With the keyboard INSIDE the reading panel, Escape is the panel's, map or no map.
    const reading = document.createElement('main');
    reading.dataset.flightKeys = 'off';
    document.body.append(reading);
    map.setOpen(true);
    key('Escape', {}, reading);
    expect(map.isOpen).toBe(true);
    expect(page).toHaveLastReturnedWith(false);
    document.removeEventListener('keydown', page);
  });

  it('opens when the wheel is scrolled out, and meant: not on a nudge, not on Ctrl+wheel', () => {
    const { map, wheel } = setup();
    cleanup = () => map.dispose();
    wheel(40);
    expect(map.isOpen).toBe(false);
    // The same nudge much later is a new gesture, not the rest of the old one.
    wheel(40, {}, 900);
    wheel(40, {}, 900);
    expect(map.isOpen).toBe(false);
    // Scrolling IN is not asking for the map, and takes back what was scrolled out.
    wheel(60, {}, 900);
    wheel(-30);
    wheel(60);
    expect(map.isOpen).toBe(false);
    // Ctrl+wheel (and a trackpad pinch) zooms the PAGE: the browser's business while flying.
    const zoomPage = wheel(500, { ctrlKey: true }, 900);
    expect(map.isOpen).toBe(false);
    expect(zoomPage.defaultPrevented).toBe(false);

    wheel(60, {}, 900);
    const opening = wheel(60);
    expect(map.isOpen).toBe(true);
    expect(opening.defaultPrevented).toBe(true);
    // A wheel that counts in lines (Firefox): three lines are one notch.
    map.setOpen(false, true);
    wheel(3, { deltaMode: 1 }, 900);
    wheel(1, { deltaMode: 1 });
    expect(map.isOpen).toBe(true);
  });

  it('cuts when asked to, and always under reduced motion', () => {
    const { map, changes } = setup();
    cleanup = () => map.dispose();
    map.setOpen(true, true);
    expect(map.weight).toBe(1);
    expect(changes).toEqual([[true, true]]);
    // Being told what it already knows is not news.
    map.setOpen(true);
    expect(changes).toHaveLength(1);

    const calm = setup({ reducedMotion: true });
    calm.key('KeyM');
    expect(calm.map.weight).toBe(1);
    expect(calm.changes).toEqual([[true, true]]);
    calm.key('KeyM');
    expect(calm.map.weight).toBe(0);
    calm.map.dispose();
  });

  it('has no button without a place to put one, and cleans up after itself', () => {
    const { map, button, key, canvas } = setup({ overlay: false });
    expect(button()).toBeNull();
    expect(map.box()).toBeNull();
    key('KeyM');
    expect(map.isOpen).toBe(true);

    map.dispose();
    expect(canvas.dataset.map).toBeUndefined();
    key('KeyM');
    expect(map.isOpen).toBe(true); // nobody is listening any more

    const withButton = setup();
    withButton.map.dispose();
    expect(withButton.button()).toBeNull();
  });
});

describe('StarMap, looking around', () => {
  it('opens on the whole galaxy, in the part of the view the panel leaves free', () => {
    const { map } = setup();
    cleanup = () => map.dispose();
    map.setOpen(true);
    expect(map.x).toBeCloseTo(-436, 6);
    expect(map.z).toBeCloseTo(377.5, 6);
    // 887 u of galaxy, and a quarter more, in 800 px of height.
    expect(map.unitsPerPx).toBeCloseTo((887 * 1.25) / 800, 9);
    expect(map.viewportHeight).toBe(800);

    // Half the width gone to the panel: the galaxy is now fitted to what is left of it.
    const narrow = setup({ freeWidth: 0.5 });
    narrow.map.setOpen(true);
    expect(narrow.map.unitsPerPx).toBeCloseTo((1004 * 1.25) / 640, 9);
    narrow.map.dispose();
  });

  it('keeps clear of the top bar: fitted below it, and centred in what is left', () => {
    const { map } = setup();
    cleanup = () => map.dispose();
    map.setTop(100);
    map.setOpen(true, true);
    expect(map.unitsPerPx).toBeCloseTo((887 * 1.25) / 700, 9);
    expect(map.dropPx).toBe(50);

    // Through the camera: the middle of the map is 50 px below the middle of the view.
    const pose = createPose();
    const view = { aspect: 1.6, freeWidth: 1, freeHeight: 1 };
    new MapCam(map, { fovDegrees: 12 }).update(frame(1 / 60), view, pose);
    const camera = new PerspectiveCamera(50, 1.6, 1, 1e6);
    applyPose(camera, pose);
    camera.updateMatrixWorld();
    const middle = new Vector3(map.x, 0, map.z).project(camera);
    expect((-middle.y / 2) * 800).toBeCloseTo(50, 6);
    expect(middle.x).toBeCloseTo(0, 9);
  });

  it('zooms about a pointer measured from the middle of what is left, too', () => {
    const { map, wheel, run } = setup();
    cleanup = () => map.dispose();
    map.setTop(100);
    map.setOpen(true, true);
    // The middle of the map is at (640, 450) now: zooming right there moves nothing sideways.
    const [x, z] = [map.x, map.z];
    wheel(-300, { clientX: 640, clientY: 450 });
    run(1.5);
    expect(map.x).toBeCloseTo(x, 6);
    expect(map.z).toBeCloseTo(z, 6);
  });

  it('is what the map camera looks at: north up, and to scale', () => {
    const { map } = setup();
    cleanup = () => map.dispose();
    map.setOpen(true, true);
    const pose = createPose();
    new MapCam(map, { fovDegrees: 12 }).update(
      frame(1 / 60),
      { aspect: 1.6, freeWidth: 1, freeHeight: 1 },
      pose,
    );
    const camera = new PerspectiveCamera(50, 1.6, 1, 1e6);
    applyPose(camera, pose);
    camera.updateMatrixWorld();

    const onScreen = (x: number, z: number): { px: number; py: number } => {
      const point = new Vector3(x, 0, z).project(camera);
      return { px: (point.x / 2) * 1280, py: (-point.y / 2) * 800 };
    };
    const middle = onScreen(map.x, map.z);
    expect(middle.px).toBeCloseTo(0, 6);
    expect(middle.py).toBeCloseTo(0, 6);
    // 100 u to the north (+Z) is up the screen, 100 u along +X is to the LEFT, and both are to scale.
    const north = onScreen(map.x, map.z + 100);
    expect(north.px).toBeCloseTo(0, 6);
    expect(north.py).toBeCloseTo(-100 / map.unitsPerPx, 6);
    const east = onScreen(map.x + 100, map.z);
    expect(east.px).toBeCloseTo(-100 / map.unitsPerPx, 6);
    expect(east.py).toBeCloseTo(0, 6);
  });

  it('is dragged by exactly as far as the pointer goes, only while open', () => {
    const { map, pointer, canvas } = setup();
    cleanup = () => map.dispose();
    pointer('pointerdown', 1, 400, 400);
    pointer('pointermove', 1, 500, 400);
    pointer('pointerup', 1, 500, 400);
    expect(map.x).toBe(0);

    map.setOpen(true, true);
    const [x, z, perPx] = [map.x, map.z, map.unitsPerPx];
    pointer('pointerdown', 1, 400, 400);
    expect(canvas.dataset.dragging).toBe('');
    pointer('pointermove', 1, 460, 370);
    // No easing between a hand and what it holds. Dragging right brings +X into the middle.
    expect(map.x).toBeCloseTo(x + 60 * perPx, 9);
    expect(map.z).toBeCloseTo(z - 30 * perPx, 9);
    pointer('pointerup', 1, 460, 370);
    expect(canvas.dataset.dragging).toBeUndefined();
    pointer('pointermove', 1, 900, 900);
    expect(map.x).toBeCloseTo(x + 60 * perPx, 9);
  });

  it('cannot be dragged off the galaxy', () => {
    const { map, pointer } = setup();
    cleanup = () => map.dispose();
    map.setOpen(true, true);
    pointer('pointerdown', 1, 0, 0);
    pointer('pointermove', 1, 50000, -50000);
    expect(map.x).toBe(BOUNDS.maxX);
    expect(map.z).toBe(BOUNDS.minZ);
  });

  it('zooms about the pointer with the wheel, easing, and keeps what is under it', () => {
    const { map, wheel, run } = setup();
    cleanup = () => map.dispose();
    map.setOpen(true, true);
    const perPx = map.unitsPerPx;
    // 200 px right of the middle and 100 px below it.
    const under = { x: map.x - 200 * perPx, z: map.z - 100 * perPx };
    const event = wheel(-400, { clientX: 840, clientY: 500 });
    expect(event.defaultPrevented).toBe(true);
    // On the way, and on arrival, the same point is under the pointer.
    for (const seconds of [0.05, 0.1, 1.5]) {
      run(seconds);
      expect(map.x - 200 * map.unitsPerPx).toBeCloseTo(under.x, 6);
      expect(map.z - 100 * map.unitsPerPx).toBeCloseTo(under.z, 6);
    }
    expect(map.unitsPerPx).toBeCloseTo(perPx * Math.exp(-400 * 0.0015), 6);

    // A pinch on a trackpad is a wheel with Ctrl: on the map it is the map's.
    const pinch = wheel(-100, { ctrlKey: true, clientX: 640, clientY: 400 });
    expect(pinch.defaultPrevented).toBe(true);
  });

  it('hears the wheel over its own DOM too: a name is a button lying over the canvas', () => {
    const { map, layer, run } = setup();
    cleanup = () => map.dispose();
    const name = document.createElement('button');
    layer.append(name);
    const roll = (deltaY: number): WheelEvent => {
      const event = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true });
      Object.defineProperty(event, 'timeStamp', { value: 5000 });
      Object.defineProperty(event, 'clientX', { value: 640 });
      Object.defineProperty(event, 'clientY', { value: 400 });
      name.dispatchEvent(event);
      return event;
    };
    roll(150);
    expect(map.isOpen).toBe(true);
    map.setOpen(true, true);
    const perPx = map.unitsPerPx;
    expect(roll(-200).defaultPrevented).toBe(true);
    run(1.5);
    expect(map.unitsPerPx).toBeLessThan(perPx);
  });

  it('stops zooming at its closest, and at everything', () => {
    const { map, wheel, run } = setup();
    cleanup = () => map.dispose();
    map.setOpen(true, true);
    wheel(-100000, { clientX: 640, clientY: 400 });
    run(2);
    expect(map.unitsPerPx).toBeCloseTo(400 / 800, 6);
    wheel(100000, { clientX: 640, clientY: 400 });
    run(2);
    expect(map.unitsPerPx).toBeCloseTo(7000 / 800, 6);
  });

  it('moves with the arrow keys and WASD, and zooms with + and -', () => {
    const { map, key, keyUp, run } = setup();
    cleanup = () => map.dispose();
    map.setOpen(true, true);
    key('Minus');
    run(2);
    const [x, z, perPx] = [map.x, map.z, map.unitsPerPx];
    expect(perPx).toBeCloseTo(((887 * 1.25) / 800) * 1.5, 6);

    // Left on the map is +X; it takes a moment to get going and to settle.
    const left = key('ArrowLeft');
    expect(left.defaultPrevented).toBe(true);
    run(0.2);
    keyUp('ArrowLeft');
    run(2);
    expect(map.x).toBeGreaterThan(x + 100 * perPx);
    expect(map.x).toBeLessThan(x + 140 * perPx);
    expect(map.z).toBeCloseTo(z, 6);

    key('KeyS');
    run(0.25);
    keyUp('KeyS');
    run(2);
    expect(map.z).toBeLessThan(z - 100 * perPx);

    key('Equal');
    run(2);
    expect(map.unitsPerPx).toBeCloseTo(perPx / 1.5, 6);
  });

  it('follows two fingers: what is between them stays between them', () => {
    const { map, pointer } = setup();
    cleanup = () => map.dispose();
    map.setOpen(true, true);
    const perPx = map.unitsPerPx;
    const between = { x: map.x - (500 - 640) * perPx, z: map.z - (400 - 400) * perPx };
    pointer('pointerdown', 1, 400, 400, 'touch');
    pointer('pointerdown', 2, 600, 400, 'touch');
    // Spread from 200 px apart to 400 px apart, about the same middle: twice as close.
    pointer('pointermove', 1, 300, 400, 'touch');
    pointer('pointermove', 2, 700, 400, 'touch');
    expect(map.unitsPerPx).toBeCloseTo(perPx / 2, 9);
    expect(map.x - (500 - 640) * map.unitsPerPx).toBeCloseTo(between.x, 6);
    expect(map.z).toBeCloseTo(between.z, 6);
    // One finger lifts: the other carries on as a drag, with no jump.
    const x = map.x;
    pointer('pointerup', 2, 700, 400, 'touch');
    pointer('pointermove', 1, 310, 400, 'touch');
    expect(map.x).toBeCloseTo(x + 10 * map.unitsPerPx, 9);
  });

  it('forgets held keys and fingers when it closes or the window loses focus', () => {
    const { map, key, run, pointer } = setup();
    cleanup = () => map.dispose();
    map.setOpen(true, true);
    key('ArrowLeft');
    window.dispatchEvent(new Event('blur'));
    const x = map.x;
    run(0.5);
    expect(map.x).toBeCloseTo(x, 9);

    pointer('pointerdown', 1, 400, 400);
    map.setOpen(false, true);
    map.setOpen(true, true);
    const again = map.x;
    pointer('pointermove', 1, 500, 400);
    expect(map.x).toBeCloseTo(again, 9);
  });

  it('carries on where it was when opened again on its way down, and starts afresh otherwise', () => {
    const { map, pointer, run } = setup();
    cleanup = () => map.dispose();
    map.setOpen(true, true);
    pointer('pointerdown', 1, 400, 400);
    pointer('pointermove', 1, 300, 400);
    pointer('pointerup', 1, 300, 400);
    const moved = map.x;
    expect(moved).not.toBeCloseTo(-436, 3);

    map.setOpen(false);
    run(0.3);
    map.setOpen(true);
    expect(map.x).toBeCloseTo(moved, 9);

    map.setOpen(false);
    run(1.5);
    map.setOpen(true);
    expect(map.x).toBeCloseTo(-436, 6);
  });
});
