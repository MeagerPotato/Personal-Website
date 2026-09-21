// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { FlightInput } from '../../sim/types';
import { PointerSteer } from './PointerSteer';
import { TouchControls } from './TouchControls';
import { mapStick, type StickIntent } from './stick';

const params = {
  stickRadiusPx: 50,
  stickDeadZone: 0.1,
  stickFullTurnDeg: 60,
  stickBrakeConeDeg: 30,
};
const blank = (): FlightInput => ({ thrust: 0, turn: 0, brake: 0, boost: false });

describe('what a thumb on the stick means', () => {
  const map = (x: number, y: number): StickIntent =>
    mapStick(x, y, params, { thrust: 0, turn: 0, brake: 0 });

  it('does nothing in the dead middle, and starts the throttle from zero at its edge', () => {
    expect(map(0, 0)).toEqual({ thrust: 0, turn: 0, brake: 0 });
    expect(map(0.05, -0.05)).toEqual({ thrust: 0, turn: 0, brake: 0 });
    expect(map(0, -0.1001).thrust).toBeLessThan(0.01);
    expect(map(Number.NaN, 0)).toEqual({ thrust: 0, turn: 0, brake: 0 });
  });

  it('flies straight ahead when pushed up, harder the further it is pushed', () => {
    const half = map(0, -0.55);
    expect(half.thrust).toBeCloseTo(0.5, 6);
    expect(half.turn).toBeCloseTo(0, 9);
    expect(map(0, -1).thrust).toBe(1);
    expect(map(0, -3).thrust).toBe(1); // past the edge is still just "full"
  });

  it('steers toward the side it is pushed to: LEFT is a positive turn', () => {
    const upLeft = map(-0.5, -0.866); // 30 degrees off straight up
    expect(upLeft.turn).toBeCloseTo(0.5, 2);
    expect(upLeft.thrust).toBeGreaterThan(0.9);
    expect(map(0.5, -0.866).turn).toBeCloseTo(-0.5, 2);

    // Sideways is a full turn that still thrusts: the pilot wants to GO there.
    expect(map(-1, 0)).toEqual({ thrust: 1, turn: 1, brake: 0 });
    expect(map(1, 0)).toEqual({ thrust: 1, turn: -1, brake: 0 });
  });

  it('brakes only when pulled nearly straight down', () => {
    expect(map(0, 1)).toEqual({ thrust: 0, turn: 0, brake: 1 });
    expect(map(0.3, 1).brake).toBeGreaterThan(0);
    const downLeft = map(-0.8, 0.8); // 45 degrees off straight down: outside the cone
    expect(downLeft.brake).toBe(0);
    expect(downLeft.turn).toBe(1);
  });
});

describe('TouchControls', () => {
  const mount = document.createElement('div');
  const canvas = document.createElement('canvas');
  mount.append(canvas);
  document.body.append(mount);
  let controls: TouchControls | undefined;

  const make = (): TouchControls => (controls = new TouchControls(canvas, mount, params));
  const fire = (
    target: Element,
    type: string,
    pointerId: number,
    x = 0,
    y = 0,
    pointerType = 'touch',
  ): void => {
    target.dispatchEvent(
      new PointerEvent(type, { pointerId, clientX: x, clientY: y, pointerType, bubbles: true }),
    );
  };
  const read = (): FlightInput => {
    const out = blank();
    controls?.read(out);
    return out;
  };
  const stick = (): HTMLElement => mount.querySelector('.touch-stick') as HTMLElement;
  const pad = (): HTMLElement => mount.querySelector('.touch-boost') as HTMLElement;

  afterEach(() => {
    controls?.dispose();
    controls = undefined;
  });

  it('shows nothing until a finger arrives, and never reacts to the mouse', () => {
    make();
    expect(stick().hidden).toBe(true);
    expect(pad().hidden).toBe(true);

    fire(canvas, 'pointerdown', 1, 100, 100, 'mouse');
    fire(canvas, 'pointermove', 1, 100, 40, 'mouse');
    expect(stick().hidden).toBe(true);
    expect(read()).toEqual(blank());
  });

  it('puts the stick under the first finger and flies by it', () => {
    make();
    fire(canvas, 'pointerdown', 7, 120, 300);
    expect(stick().hidden).toBe(false);
    expect(stick().style.transform).toBe('translate(120px, 300px)');
    expect(pad().hidden).toBe(false); // boost can be found from now on
    expect(read()).toEqual(blank());

    fire(canvas, 'pointermove', 7, 120, 250); // straight up, all the way
    expect(read()).toEqual({ thrust: 1, turn: 0, brake: 0, boost: false });

    fire(canvas, 'pointerup', 7, 120, 250);
    expect(stick().hidden).toBe(true);
    expect(read()).toEqual(blank());
  });

  it('drags the stick along when the thumb runs off its edge', () => {
    make();
    fire(canvas, 'pointerdown', 1, 200, 400);
    fire(canvas, 'pointermove', 1, 200, 250); // 150 px up: three times the travel
    expect(stick().style.transform).toBe('translate(200px, 300px)');
    expect(read().thrust).toBe(1);

    // So a reversal registers at once: 60 px back down is already past centre, into the brake.
    fire(canvas, 'pointermove', 1, 200, 340);
    expect(read().brake).toBeGreaterThan(0.5);
  });

  it('boosts with a second finger anywhere, or with the pad', () => {
    make();
    fire(canvas, 'pointerdown', 1, 100, 300);
    fire(canvas, 'pointerdown', 2, 320, 500);
    expect(read().boost).toBe(true);
    expect(pad().dataset.active).toBe('');
    fire(canvas, 'pointerup', 2, 320, 500);
    expect(read().boost).toBe(false);
    expect(pad().dataset.active).toBeUndefined();

    fire(pad(), 'pointerdown', 3);
    expect(read().boost).toBe(true);
    fire(pad(), 'pointercancel', 3);
    expect(read().boost).toBe(false);

    // Lifting the STEERING finger must not strand the other one as a stuck stick.
    fire(canvas, 'pointerup', 1, 100, 300);
    expect(stick().hidden).toBe(true);
  });

  it('lets go of everything when the window loses focus, and cleans up after itself', () => {
    make();
    fire(canvas, 'pointerdown', 1, 100, 300);
    fire(canvas, 'pointermove', 1, 60, 300);
    fire(canvas, 'pointerdown', 2, 300, 300);
    expect(read().turn).toBe(1);

    window.dispatchEvent(new Event('blur'));
    expect(read()).toEqual(blank());

    controls?.dispose();
    controls = undefined;
    expect(mount.querySelector('.touch-stick')).toBeNull();
    expect(mount.querySelector('.touch-boost')).toBeNull();
  });
});

describe('PointerSteer (an experiment behind a flag)', () => {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 600 }) as DOMRect;
  const down = (x: number, pointerType = 'mouse'): void => {
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, button: 0, pointerType }));
  };

  it('does nothing while the flag is off', () => {
    const steer = new PointerSteer(canvas, { pointerSteer: false, pointerFullTurnShare: 0.5 });
    down(900);
    const out = blank();
    steer.read(out);
    expect(out).toEqual(blank());
    steer.dispose();
  });

  it('flies toward the held cursor: right of the middle is a clockwise (negative) turn', () => {
    const steer = new PointerSteer(canvas, { pointerSteer: true, pointerFullTurnShare: 0.5 });
    const read = (): FlightInput => {
      const out = blank();
      steer.read(out);
      return out;
    };
    expect(read()).toEqual(blank());

    down(625); // a quarter of the way to the right edge = half of the full-turn distance
    expect(read()).toEqual({ thrust: 1, turn: -0.5, brake: 0, boost: false });
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, pointerType: 'mouse' }));
    expect(read().turn).toBe(1);

    canvas.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'mouse' }));
    expect(read()).toEqual(blank());

    down(900, 'touch'); // fingers belong to TouchControls
    expect(read()).toEqual(blank());
    steer.dispose();
  });
});
