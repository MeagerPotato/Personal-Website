// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createScreenMap } from '../sim/screen';
import { Picker } from './Picker';

const PARAMS = {
  tapMaxPx: 10,
  tapMaxSec: 0.4,
  mouse: { minTargetPx: 12, minVisiblePx: 1.5 },
  touch: { minTargetPx: 22, minVisiblePx: 1.5 },
};

/** Two bodies on screen: row 0 big on the left, row 1 a dot on the right. */
function setup(ignore = -1) {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const screen = createScreenMap(2);
  screen.count = 2;
  screen.x.set([200, 600]);
  screen.y.set([300, 300]);
  screen.radius.set([40, 3]);
  screen.depth.set([100, 900]);
  const picked: number[] = [];
  const picker = new Picker({
    canvas,
    screen,
    params: PARAMS,
    ignore: () => ignore,
    onPick: (row) => picked.push(row),
  });
  let stamp = 1000;
  const fire = (type: string, x: number, y: number, pointerType = 'mouse', afterMs = 0): void => {
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
    canvas.dispatchEvent(event);
  };
  return { canvas, picker, picked, fire };
}

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = '';
});

describe('Picker', () => {
  it('picks the body that was clicked, and nothing for a click on empty sky', () => {
    const { picker, picked, fire } = setup();
    cleanup = () => picker.dispose();
    fire('pointerdown', 210, 310);
    fire('pointerup', 211, 310, 'mouse', 90);
    expect(picked).toEqual([0]);

    fire('pointerdown', 400, 100);
    fire('pointerup', 400, 100, 'mouse', 90);
    expect(picked).toEqual([0]);
  });

  it('gives a finger a bigger target than a mouse', () => {
    const { picker, picked, fire } = setup();
    cleanup = () => picker.dispose();
    // 18 px from a dot: too far for a mouse, near enough for a thumb.
    fire('pointerdown', 618, 300);
    fire('pointerup', 618, 300, 'mouse', 90);
    expect(picked).toEqual([]);
    fire('pointerdown', 618, 300, 'touch');
    fire('pointerup', 618, 300, 'touch', 90);
    expect(picked).toEqual([1]);
  });

  it('knows a tap from steering: a press that moves or lingers picks nothing', () => {
    const { picker, picked, fire } = setup();
    cleanup = () => picker.dispose();
    fire('pointerdown', 200, 300, 'touch');
    fire('pointerup', 200, 330, 'touch', 90); // the thumb stick, pushed
    fire('pointerdown', 200, 300, 'touch');
    fire('pointerup', 200, 300, 'touch', 900); // a thumb at rest
    fire('pointerdown', 200, 300, 'touch');
    fire('pointercancel', 200, 300, 'touch', 50);
    fire('pointerup', 200, 300, 'touch', 50); // the browser took the gesture away
    expect(picked).toEqual([]);
  });

  it('leaves the other mouse buttons alone, and the body it is told to ignore', () => {
    const right = setup();
    const event = new PointerEvent('pointerdown', {
      pointerId: 1,
      clientX: 200,
      clientY: 300,
      pointerType: 'mouse',
      button: 2,
    });
    right.canvas.dispatchEvent(event);
    right.fire('pointerup', 200, 300, 'mouse', 50);
    expect(right.picked).toEqual([]);
    right.picker.dispose();

    const { picker, picked, fire } = setup(0);
    cleanup = () => picker.dispose();
    fire('pointerdown', 200, 300);
    fire('pointerup', 200, 300, 'mouse', 50);
    expect(picked).toEqual([]);
  });

  it('marks the canvas while a mouse is over something that can be picked', () => {
    const { canvas, picker, fire } = setup();
    cleanup = () => picker.dispose();
    picker.frameUpdate();
    expect('pick' in canvas.dataset).toBe(false);

    fire('pointermove', 205, 295);
    picker.frameUpdate();
    expect('pick' in canvas.dataset).toBe(true);

    fire('pointermove', 400, 100);
    picker.frameUpdate();
    expect('pick' in canvas.dataset).toBe(false);

    // A finger never hovers.
    fire('pointermove', 205, 295, 'touch');
    picker.frameUpdate();
    expect('pick' in canvas.dataset).toBe(false);

    fire('pointermove', 205, 295);
    picker.frameUpdate();
    fire('pointerleave', 900, 900);
    picker.frameUpdate();
    expect('pick' in canvas.dataset).toBe(false);
  });

  it('stops listening, and cleans up, when disposed', () => {
    const { canvas, picker, picked, fire } = setup();
    fire('pointermove', 205, 295);
    picker.frameUpdate();
    picker.dispose();
    expect('pick' in canvas.dataset).toBe(false);
    fire('pointerdown', 200, 300);
    fire('pointerup', 200, 300, 'mouse', 50);
    expect(picked).toEqual([]);
  });
});
