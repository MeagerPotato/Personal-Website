import type { System, Viewport } from '../core/Engine';
import type { ManifestBody } from '../manifest';
import {
  createLabelBoxes,
  createTakenBoxes,
  declutter,
  type DeclutterParams,
  type ScreenBox,
} from '../sim/declutter';
import type { ScreenMap } from '../sim/screen';

type BodyKind = ManifestBody['kind'];

export interface LabelsParams extends DeclutterParams {
  /** A name sits this far below the edge of its body (CSS px). */
  readonly offsetPx: number;
  /** A body that looks smaller than this (radius, CSS px) gets no name: there is nothing to name. */
  readonly minVisiblePx: number;
  /** Names keep this far from the sides and the bottom of the free view, and from the top bar. */
  readonly edgePx: number;
  /** No name starts higher than this, even if nobody says how tall the top bar is (`setTop`). */
  readonly topPx: number;
}

export interface LabelsOptions {
  /** Where interactive DOM goes: outside the engine's mount, which is hidden from assistive tech. */
  overlay: HTMLElement;
  /** Where every body is on screen (ui/BodiesOnScreen.ts). */
  screen: Readonly<ScreenMap>;
  /** By row of the orbit table. */
  bodies: ReadonlyArray<{ readonly title: string; readonly kind: BodyKind }>;
  params: LabelsParams;
  /** The part of the view that the info panel leaves free, as shares of its width and height. */
  view: { readonly freeWidth: number; readonly freeHeight: number };
  /** Row of the body the ship is headed for or docked at, or -1. */
  target(): number;
  /** Is the ship docked (at `target`)? Then its page is open, and its name is on the page. */
  docked(): boolean;
  /** The visitor pressed the name of the body in this row. */
  onPick(row: number): void;
  /**
   * Whatever else of the engine's lies over the sky and can be pressed (the dock prompt, the boost
   * pad): where each one is right now, or null while it is not there. Names keep off them, the
   * way they keep off each other.
   */
  obstacles?: ReadonlyArray<() => Readonly<ScreenBox> | null>;
}

/** Suns and the home planet name a whole system; moons are the small print. */
const RANK: Record<BodyKind, number> = {
  sun: 1,
  home: 1,
  planet: 2,
  station: 2,
  satellite: 2,
  moon: 3,
};
/** Ranks are this far apart, so that distance (u) only ever decides WITHIN a rank. */
const RANK_STEP = 1e6;

/**
 * NAMES OVER THE BODIES (docs/PLAN.md §5.5): one real <button> per body, so a name can be tapped,
 * tabbed to and read out, and pressing it flies there like pointing at the body itself. The
 * engine decides where each one is and which may show (sim/declutter.ts: important first, never
 * touching, never flickering); how they LOOK is CSS (`.body-label` in src/styles/global.css).
 *
 * Add it AFTER ui/BodiesOnScreen.ts. It writes a transform per visible name per frame and nothing
 * else. The only layout it reads, once the names are measured, is where its few `obstacles` are,
 * and it asks before it writes anything, while layout is still clean from the frame before.
 */
export class Labels implements System {
  private readonly root = document.createElement('div');
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly boxes;
  private readonly taken;
  private readonly wasShown: Uint8Array;
  private readonly lastX: Float64Array;
  private readonly lastY: Float64Array;
  private width = 1;
  private height = 1;
  private measured = false;
  private focused = -1;
  private marked = -1;
  private barBottom = 0;

  constructor(private readonly options: LabelsOptions) {
    const count = options.bodies.length;
    this.boxes = createLabelBoxes(count);
    this.taken = createTakenBoxes(options.obstacles?.length ?? 0);
    this.wasShown = new Uint8Array(count);
    this.lastX = new Float64Array(count).fill(Number.NaN);
    this.lastY = new Float64Array(count).fill(Number.NaN);

    this.root.className = 'body-labels';
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Fly to');
    options.bodies.forEach((body, row) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'body-label';
      button.dataset.row = String(row);
      button.dataset.kind = body.kind;
      button.textContent = body.title;
      this.buttons.push(button);
    });
    this.root.append(...this.buttons);
    options.overlay.append(this.root);

    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('focusin', this.onFocusIn);
    this.root.addEventListener('focusout', this.onFocusOut);
    // Names are measured in the font they are drawn in: measure again once that has arrived.
    void document.fonts?.ready.then(() => {
      this.measured = false;
    });
  }

  frameUpdate(): void {
    if (!this.measured) this.measure();
    const { screen, params, view, bodies } = this.options;
    const { boxes } = this;
    const target = this.options.target();
    const docked = this.options.docked();
    const right = this.width * view.freeWidth - params.edgePx;
    const bottom = this.height * view.freeHeight - params.edgePx;
    const ceiling = Math.max(params.topPx, this.barBottom + params.edgePx);

    // First, while this frame has not touched the page yet: what is in the way.
    let obstacles = 0;
    for (const where of this.options.obstacles ?? []) {
      const box = where();
      const slot = this.taken.boxes[obstacles];
      if (!box || !slot) continue;
      slot.left = box.left;
      slot.top = box.top;
      slot.width = box.width;
      slot.height = box.height;
      obstacles += 1;
    }
    this.taken.count = obstacles;

    boxes.count = Math.min(screen.count, bodies.length);
    for (let row = 0; row < boxes.count; row += 1) {
      boxes.priority[row] = Infinity;
      const depth = screen.depth[row] ?? 0;
      const radius = screen.radius[row] ?? 0;
      if (!(depth > 0) || radius < params.minVisiblePx) continue;
      if (docked && row === target) continue;

      const w = boxes.width[row] ?? 0;
      const left = (screen.x[row] ?? 0) - w / 2;
      const top = (screen.y[row] ?? 0) + radius + params.offsetPx;
      boxes.left[row] = left;
      boxes.top[row] = top;
      const inView =
        left >= params.edgePx &&
        left + w <= right &&
        top >= ceiling &&
        top + (boxes.height[row] ?? 0) <= bottom;
      if (!inView) continue;

      // Where the ship is going comes first, then whatever the keyboard is on (a name must not
      // vanish from under someone who has tabbed to it), then systems, planets, moons.
      const kind = bodies[row]?.kind ?? 'moon';
      const rank = row === target ? 0 : row === this.focused ? 0.5 : RANK[kind];
      boxes.priority[row] = rank * RANK_STEP + depth;
    }
    declutter(boxes, params, this.taken);

    for (let row = 0; row < boxes.count; row += 1) {
      const button = this.buttons[row];
      if (!button) continue;
      const shows = boxes.shown[row] === 1;
      if (shows !== (this.wasShown[row] === 1)) {
        this.wasShown[row] = shows ? 1 : 0;
        if (shows) button.dataset.shown = '';
        else delete button.dataset.shown;
      }
      if (!shows) continue;
      // Tenths of a pixel: finer than anyone can see, coarse enough to skip most writes at rest.
      const x = Math.round((boxes.left[row] ?? 0) * 10) / 10;
      const y = Math.round((boxes.top[row] ?? 0) * 10) / 10;
      if (x === this.lastX[row] && y === this.lastY[row]) continue;
      this.lastX[row] = x;
      this.lastY[row] = y;
      button.style.transform = `translate(${x}px, ${y}px)`;
    }

    if (target !== this.marked) {
      const before = this.buttons[this.marked];
      if (before) delete before.dataset.state;
      const now = this.buttons[target];
      if (now) now.dataset.state = 'target';
      this.marked = target;
    }
  }

  /**
   * How far down the page's top bar reaches (CSS px). The bar is the web layer's, so the web layer
   * measures it (shell/panel-inset.ts): on a phone it is two rows tall, and a name must not lie
   * on its links.
   */
  setTop(px: number): void {
    this.barBottom = Math.max(0, px);
  }

  resize(viewport: Viewport): void {
    this.width = viewport.width;
    this.height = viewport.height;
    // A breakpoint may have changed the type size.
    this.measured = false;
  }

  dispose(): void {
    this.root.removeEventListener('click', this.onClick);
    this.root.removeEventListener('focusin', this.onFocusIn);
    this.root.removeEventListener('focusout', this.onFocusOut);
    this.root.remove();
  }

  /** How big each name is. The one time layout is read; a hidden name still has its size. */
  private measure(): void {
    this.measured = true;
    this.buttons.forEach((button, row) => {
      // No layout (a test, a detached overlay): a fair guess keeps everything else working.
      this.boxes.width[row] = button.offsetWidth || (button.textContent?.length ?? 0) * 7 + 24;
      this.boxes.height[row] = button.offsetHeight || 44;
    });
  }

  private rowOf(event: Event): number {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    const row = Number(button?.dataset.row ?? Number.NaN);
    return Number.isInteger(row) ? row : -1;
  }

  private readonly onClick = (event: Event): void => {
    const row = this.rowOf(event);
    if (row >= 0) this.options.onPick(row);
  };

  private readonly onFocusIn = (event: Event): void => {
    this.focused = this.rowOf(event);
  };

  private readonly onFocusOut = (): void => {
    this.focused = -1;
  };
}
