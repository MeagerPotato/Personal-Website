import type { System } from '../core/Engine';
import { isTap, pickBody, type PickParams, type ScreenMap, type TapParams } from '../sim/screen';

export interface PickerParams extends TapParams {
  /** A mouse is precise, a finger is not: each gets its own idea of how small a target may be. */
  readonly mouse: PickParams;
  readonly touch: PickParams;
}

export interface PickerOptions {
  canvas: HTMLCanvasElement;
  /** Where every body is on screen (ui/BodiesOnScreen.ts). */
  screen: Readonly<ScreenMap>;
  params: PickerParams;
  /** Row of the body that is not worth picking: the ship is there already, or on its way. -1: none. */
  ignore(): number;
  /** The visitor pointed at the body in this row. */
  onPick(row: number): void;
}

/**
 * POINT AT A PLANET TO GO THERE. A click, or a tap that neither moved nor lingered (so it was not
 * the thumb stick, core/input/TouchControls.ts), on a body that can be seen. It only ever TELLS
 * whoever listens; what a pick means is decided in main.ts.
 *
 * A mouse over something that can be picked is shown as `data-pick` on the canvas; what that
 * looks like (the cursor) is CSS. A finger has no hover and gets no hint here: the labels are
 * buttons, and they are the ones that say "this can be pressed".
 *
 * The canvas answers clicks, as far as the browser can tell (a listener that does nothing: the
 * picking is done above). A browser moves a finger that lands near something it thinks can be
 * pressed onto that thing (touch adjustment, in Chromium and WebKit), and a canvas with only
 * pointer listeners does not count. A name hangs just below its body, so a finger on a body
 * would press the name instead: harmless for a planet, whose name flies there too, but a
 * relay's name is a link, and pointing at a relay must never leave the site (ui/Labels.ts,
 * `beckon`). Answering clicks, the canvas is a candidate too, and it wins wherever the finger
 * lands on it rather than on a name's 44 px box. tests/e2e/links.spec.ts taps with a finger.
 */
export class Picker implements System {
  private readonly presses = new Map<number, { x: number; y: number; at: number }>();
  private hovering = false;
  private hoverX = 0;
  private hoverY = 0;
  private shown = false;
  /** Where the canvas is in the window. Measured when that can have changed, not on every move. */
  private left = 0;
  private top = 0;

  constructor(private readonly options: PickerOptions) {
    const { canvas } = options;
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onCancel);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerenter', this.measure);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('click', this.answer);
  }

  frameUpdate(): void {
    // Bodies move and so does the camera: what is under a mouse at rest changes all the same.
    const { screen, params, ignore } = this.options;
    const over =
      this.hovering && pickBody(screen, this.hoverX, this.hoverY, params.mouse, ignore()) >= 0;
    if (over === this.shown) return;
    this.shown = over;
    if (over) this.options.canvas.dataset.pick = '';
    else delete this.options.canvas.dataset.pick;
  }

  resize(): void {
    this.measure();
  }

  dispose(): void {
    const { canvas } = this.options;
    canvas.removeEventListener('pointerdown', this.onDown);
    canvas.removeEventListener('pointerup', this.onUp);
    canvas.removeEventListener('pointercancel', this.onCancel);
    canvas.removeEventListener('pointermove', this.onMove);
    canvas.removeEventListener('pointerenter', this.measure);
    canvas.removeEventListener('pointerleave', this.onLeave);
    canvas.removeEventListener('click', this.answer);
    this.presses.clear();
    delete canvas.dataset.pick;
  }

  private readonly measure = (): void => {
    const box = this.options.canvas.getBoundingClientRect();
    this.left = box.left;
    this.top = box.top;
  };

  private readonly onDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.measure();
    this.presses.set(event.pointerId, { x: event.clientX, y: event.clientY, at: event.timeStamp });
  };

  private readonly onUp = (event: PointerEvent): void => {
    const press = this.presses.get(event.pointerId);
    this.presses.delete(event.pointerId);
    if (!press) return;
    const { screen, params, ignore, onPick } = this.options;
    const seconds = (event.timeStamp - press.at) / 1000;
    if (!isTap(press.x, press.y, event.clientX, event.clientY, seconds, params)) return;

    const target = event.pointerType === 'mouse' ? params.mouse : params.touch;
    const row = pickBody(
      screen,
      event.clientX - this.left,
      event.clientY - this.top,
      target,
      ignore(),
    );
    if (row >= 0) onPick(row);
  };

  private readonly onCancel = (event: PointerEvent): void => {
    this.presses.delete(event.pointerId);
  };

  private readonly onMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') return;
    this.hovering = true;
    this.hoverX = event.clientX - this.left;
    this.hoverY = event.clientY - this.top;
  };

  private readonly onLeave = (): void => {
    this.hovering = false;
  };

  /** Nothing to do: it is there so that the browser sees a canvas that answers clicks (above). */
  private readonly answer = (): void => {};
}
