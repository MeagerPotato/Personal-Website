import { easeBlend } from '../camera/CameraRig';
import type { MapSight } from '../camera/MapCam';
import { boxOf } from '../core/dom';
import type { Frame, System, Viewport } from '../core/Engine';
import { belongsToPage } from '../core/input/KeyboardInput';
import type { ScreenBox } from '../sim/declutter';
import {
  clampView,
  fitView,
  panBy,
  spanLimit,
  takeIn,
  unitsPerPx,
  zoomAbout,
  type MapBounds,
  type MapBoundsOut,
  type MapView,
  type MapViewParams,
} from '../sim/mapView';
import { createSpring, snapSpring, stepSpring } from '../sim/spring';

export interface StarMapParams extends MapViewParams {
  /** Seconds from the flight view up to the map, and back down. A cut under reduced motion. */
  readonly blendSec: number;
  /** 1/s: how quickly the map settles after a step of the wheel or a key. */
  readonly viewOmega: number;
  /** Each CSS px of wheel zooms by e to this power: 0.0015 is about 16% a notch. */
  readonly wheelZoomPerPx: number;
  /** Scrolling OUT this far (CSS px) in one go, while flying, opens the map. */
  readonly wheelOpenPx: number;
  /** The arrow keys move the map this fast, in CSS px per second. */
  readonly keyPanPxPerSec: number;
  /** + and - zoom by this factor. */
  readonly keyZoomStep: number;
}

export interface StarMapOptions {
  canvas: HTMLCanvasElement;
  /** Where the Map button goes (interactive DOM lives outside the engine's mount). None: no button. */
  overlay?: HTMLElement | undefined;
  /** Everything there is to see (sim/mapView.ts, `boundsOf`)... */
  bounds: MapBounds;
  /** ...and where the ship is, which may be out beyond it. None: the galaxy alone. */
  ship?: (() => Readonly<{ x: number; z: number }>) | undefined;
  /** The part of the view that the info panel leaves free, as shares. A live object (CameraRig). */
  view: { readonly freeWidth: number; readonly freeHeight: number };
  params: StarMapParams;
  reducedMotion: boolean;
  /** The map opened or closed, whoever did it. `cut`: at once, so the camera should cut too. */
  onChange(open: boolean, cut: boolean): void;
}

const TOGGLE_KEY = 'KeyM';
/** Which way each key moves the VIEW: [right, down] on screen. */
const PAN_KEYS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  KeyA: [-1, 0],
  ArrowRight: [1, 0],
  KeyD: [1, 0],
  ArrowUp: [0, -1],
  KeyW: [0, -1],
  ArrowDown: [0, 1],
  KeyS: [0, 1],
};
const ZOOM_IN_KEYS = new Set(['Equal', 'NumpadAdd']);
const ZOOM_OUT_KEYS = new Set(['Minus', 'NumpadSubtract']);
/** Wheel events further apart than this are separate gestures. */
const WHEEL_GESTURE_MS = 300;
/** A wheel that reports lines, or pages, instead of pixels (Firefox with a mouse). */
const WHEEL_LINE_PX = 33;
const WHEEL_PAGE_PX = 400;

/**
 * THE STAR MAP (docs/PLAN.md §3): pull out to the whole galaxy seen from above, drag it about,
 * zoom, and point at where to go. This class is the map's STATE and its controls: whether it is
 * open, what it shows, and every way of changing either (the Map button, M and Esc, the wheel, a
 * drag, a pinch, the arrow keys). The camera that looks at it is camera/MapCam.ts, and what a
 * pick means is decided in main.ts, as for the flight view.
 *
 * While the map is open the flight controls are off (main.ts), so the same keys and the same
 * fingers move the map instead of the ship; the ship carries on with whatever it was doing.
 *
 * How the button looks is CSS (`.map-toggle` in src/styles/global.css).
 */
export class StarMap implements System, MapSight {
  private open = false;
  /** 0 = the flight view, 1 = the map, linear in time; `weight` is the eased version. */
  private progress = 0;
  private readonly want: MapView = { x: 0, z: 0, span: 1 };
  /** Scratch: what the map has to show (`look`). */
  private readonly seen: MapBoundsOut = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  private readonly eased = { x: createSpring(), z: createSpring(), span: createSpring(1) };
  private width = 1;
  private height = 1;
  private barBottom = 0;
  /** How far down the Map button reaches, CSS px from the top of the canvas. Measured on opening. */
  private buttonBottom = 0;

  private readonly button: HTMLButtonElement | null;
  private readonly label: HTMLSpanElement | null = null;
  private readonly area: ScreenBox = { left: 0, top: 0, width: 0, height: 0 };
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private readonly held = new Set<string>();
  private wheelOut = 0;
  private wheelAt = 0;
  /** Where the canvas is in the window: measured when a gesture starts. */
  private left = 0;
  private top = 0;

  constructor(private readonly options: StarMapOptions) {
    const { canvas, overlay } = options;
    if (overlay) {
      this.button = document.createElement('button');
      this.button.type = 'button';
      this.button.className = 'map-toggle';
      // The key is a hint for the eye; to a screen reader the button is "Map", shortcut M.
      this.button.setAttribute('aria-keyshortcuts', 'M');
      const key = document.createElement('kbd');
      key.textContent = 'M';
      key.setAttribute('aria-hidden', 'true');
      this.label = document.createElement('span');
      this.button.append(key, this.label);
      overlay.append(this.button);
      this.button.addEventListener('click', this.toggle);
    } else {
      this.button = null;
    }
    this.render();

    // Capture: Escape closes the map BEFORE the page hears of it, or it would close the panel too.
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.letGo);
    document.addEventListener('visibilitychange', this.letGo);
    // The wheel counts over the engine's own DOM too: whoever zooms in on a planet has the pointer
    // on the planet or on its name, and a name is a button lying over the canvas.
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    overlay?.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      canvas.addEventListener(type, this.onPointerUp);
    }
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** How much of the picture is the map's: 0 flying, 1 on the map, eased in between. */
  get weight(): number {
    return easeBlend(this.progress);
  }

  get x(): number {
    return this.eased.x.value;
  }

  get z(): number {
    return this.eased.z.value;
  }

  get unitsPerPx(): number {
    return unitsPerPx(this.eased.span.value, this.frame());
  }

  get viewportHeight(): number {
    return this.height;
  }

  get dropPx(): number {
    return this.ceiling() / 2;
  }

  /**
   * How far down the page's top bar reaches (CSS px; the web layer measures it, as for the names:
   * ui/Labels.ts). The map is fitted into what is left BELOW it: a system under the bar's links
   * could be neither seen nor pointed at.
   */
  setTop(px: number): void {
    this.barBottom = Math.max(0, px);
  }

  /** Open or close. `cut`: at once, with no way there (a rebuilt engine picking up where it was). */
  setOpen(open: boolean, cut = false): void {
    const instant = cut || this.options.reducedMotion;
    const changed = open !== this.open;
    this.open = open;
    if (changed && open) this.measure();
    if (changed && open && this.progress === 0) {
      // A fresh look at everything. (Opened again on its way down, it carries on as it was.)
      fitView(this.look(), this.frame(), this.options.params, this.want);
      this.settle();
    }
    if (instant) this.progress = open ? 1 : 0;
    if (!changed) return;
    if (!open) this.letGo();
    this.render();
    this.options.onChange(open, instant);
  }

  readonly toggle = (): void => this.setOpen(!this.open);

  /** Where the Map button is on the page: names keep off it (ui/Labels.ts). */
  box(): Readonly<ScreenBox> | null {
    return this.button ? boxOf(this.button, this.area) : null;
  }

  frameUpdate(frame: Frame): void {
    const { params, reducedMotion } = this.options;
    const step = params.blendSec > 0 && !reducedMotion ? frame.dt / params.blendSec : 1;
    this.progress = this.open
      ? Math.min(1, this.progress + step)
      : Math.max(0, this.progress - step);
    if (this.progress === 0) return;

    if (this.open && this.held.size > 0) {
      let right = 0;
      let down = 0;
      for (const code of this.held) {
        right += PAN_KEYS[code]?.[0] ?? 0;
        down += PAN_KEYS[code]?.[1] ?? 0;
      }
      // Moving the VIEW right is dragging the map left.
      const reach = params.keyPanPxPerSec * frame.dt;
      panBy(this.want, -right * reach, -down * reach, this.frame());
    }
    clampView(this.want, this.look(), this.frame(), params);

    if (reducedMotion) {
      this.settle();
      return;
    }
    // One stiffness for all three, so that they move as ONE view: whatever a zoom keeps under
    // the pointer stays under it on the way, not only on arrival.
    stepSpring(this.eased.x, this.want.x, params.viewOmega, frame.dt);
    stepSpring(this.eased.z, this.want.z, params.viewOmega, frame.dt);
    stepSpring(this.eased.span, this.want.span, params.viewOmega, frame.dt);
  }

  resize(viewport: Viewport): void {
    this.width = viewport.width;
    this.height = viewport.height;
    // The bar may have wrapped and the button moved with it.
    if (this.open) this.measure();
  }

  dispose(): void {
    const { canvas } = this.options;
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.letGo);
    document.removeEventListener('visibilitychange', this.letGo);
    canvas.removeEventListener('wheel', this.onWheel);
    this.options.overlay?.removeEventListener('wheel', this.onWheel);
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      canvas.removeEventListener(type, this.onPointerUp);
    }
    this.button?.removeEventListener('click', this.toggle);
    this.button?.remove();
    delete canvas.dataset.map;
    delete canvas.dataset.dragging;
  }

  /**
   * Where the map lives, in CSS px: what the panel leaves free, below the top bar AND below the
   * Map button. On a phone with a page open that is a third of the screen, and whatever the map
   * opens on must be in it, not under a button.
   */
  private frame(): { width: number; height: number } {
    const { view } = this.options;
    return {
      width: this.width * view.freeWidth,
      height: Math.max(1, this.height * view.freeHeight - this.ceiling()),
    };
  }

  /** How much of the top of the view is taken, CSS px. */
  private ceiling(): number {
    return Math.max(this.barBottom, this.buttonBottom);
  }

  /**
   * The closest and the furthest the map may zoom right now: out to everything (the galaxy and
   * the ship) and no further.
   */
  private limits(): { min: number; max: number } {
    const { params } = this.options;
    return { min: params.spanMin, max: spanLimit(this.look(), this.frame(), params) };
  }

  /** What the map has to show: the galaxy, grown to take in the ship when it is out beyond it. */
  private look(): MapBounds {
    const { bounds, ship } = this.options;
    if (!ship) return bounds;
    const at = ship();
    return takeIn(bounds, at.x, at.z, this.seen);
  }

  /** Be where the view is wanted, now: a drag is followed exactly, and a cut is a cut. */
  private settle(): void {
    snapSpring(this.eased.x, this.want.x);
    snapSpring(this.eased.z, this.want.z);
    snapSpring(this.eased.span, this.want.span);
  }

  private render(): void {
    const { canvas } = this.options;
    if (this.open) canvas.dataset.map = '';
    else delete canvas.dataset.map;
    if (!this.button || !this.label) return;
    this.label.textContent = this.open ? 'Close map' : 'Map';
    if (this.open) this.button.dataset.state = 'open';
    else delete this.button.dataset.state;
  }

  /** A point of the window, in CSS px from the middle of the free view. */
  private fromMiddle(clientX: number, clientY: number): { px: number; py: number } {
    const frame = this.frame();
    return {
      px: clientX - this.left - frame.width / 2,
      py: clientY - this.top - this.ceiling() - frame.height / 2,
    };
  }

  /** The one place layout is read: where the canvas is, and how far down the button reaches. */
  private measure(): void {
    const box = this.options.canvas.getBoundingClientRect();
    this.left = box.left;
    this.top = box.top;
    const button = this.box();
    this.buttonBottom = button ? Math.max(0, button.top + button.height - box.top) : 0;
  }

  private zoom(factor: number, px: number, py: number): void {
    zoomAbout(this.want, factor, px, py, this.frame(), this.limits());
    clampView(this.want, this.look(), this.frame(), this.options.params);
  }

  private readonly letGo = (): void => {
    this.held.clear();
    this.pointers.clear();
    delete this.options.canvas.dataset.dragging;
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (belongsToPage(event)) return;
    if (event.code === TOGGLE_KEY) {
      if (!event.repeat) this.toggle();
      event.preventDefault();
      return;
    }
    if (!this.open) return;
    if (event.key === 'Escape' && !event.shiftKey) {
      this.setOpen(false);
      // The page closes its panel on Escape, unless somebody got there first (shell/panel.ts).
      event.preventDefault();
    } else if (Object.hasOwn(PAN_KEYS, event.code)) {
      this.held.add(event.code);
      event.preventDefault();
    } else if (ZOOM_IN_KEYS.has(event.code) || ZOOM_OUT_KEYS.has(event.code)) {
      const { keyZoomStep } = this.options.params;
      this.zoom(ZOOM_IN_KEYS.has(event.code) ? 1 / keyZoomStep : keyZoomStep, 0, 0);
      event.preventDefault();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
  };

  private readonly onWheel = (event: WheelEvent): void => {
    const unit = event.deltaMode === 1 ? WHEEL_LINE_PX : event.deltaMode === 2 ? WHEEL_PAGE_PX : 1;
    const delta = event.deltaY * unit;
    if (this.open) {
      // A pinch on a trackpad arrives as a wheel with Ctrl held: the map's, not the browser's.
      event.preventDefault();
      this.measure();
      const { px, py } = this.fromMiddle(event.clientX, event.clientY);
      this.zoom(Math.exp(delta * this.options.params.wheelZoomPerPx), px, py);
      return;
    }
    // Flying: scrolling OUT, and meaning it, pulls out to the map. (Ctrl+wheel zooms the page.)
    if (event.ctrlKey || event.metaKey) return;
    if (event.timeStamp - this.wheelAt > WHEEL_GESTURE_MS || delta <= 0) this.wheelOut = 0;
    this.wheelAt = event.timeStamp;
    if (delta <= 0) return;
    this.wheelOut += delta;
    if (this.wheelOut >= this.options.params.wheelOpenPx) {
      this.wheelOut = 0;
      event.preventDefault();
      this.setOpen(true);
    }
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.open || (event.pointerType === 'mouse' && event.button !== 0)) return;
    this.measure();
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.options.canvas.setPointerCapture?.(event.pointerId);
    this.options.canvas.dataset.dragging = '';
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer || !this.open) return;
    const others = [...this.pointers.entries()].filter(([id]) => id !== event.pointerId);
    const other = others[0]?.[1];
    const frame = this.frame();
    if (other) {
      // Two fingers: what lies between them stays between them, as they spread, close and move.
      const before = Math.hypot(pointer.x - other.x, pointer.y - other.y);
      const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
      const midBefore = this.fromMiddle((pointer.x + other.x) / 2, (pointer.y + other.y) / 2);
      const midAfter = this.fromMiddle(
        (event.clientX + other.x) / 2,
        (event.clientY + other.y) / 2,
      );
      if (before > 1 && after > 1) {
        zoomAbout(this.want, before / after, midBefore.px, midBefore.py, frame, this.limits());
      }
      panBy(this.want, midAfter.px - midBefore.px, midAfter.py - midBefore.py, frame);
    } else {
      panBy(this.want, event.clientX - pointer.x, event.clientY - pointer.y, frame);
    }
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    clampView(this.want, this.look(), frame, this.options.params);
    // A hand on the map moves it exactly: no easing between a finger and what it holds.
    this.settle();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size === 0) delete this.options.canvas.dataset.dragging;
  };
}
