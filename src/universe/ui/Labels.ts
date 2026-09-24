import type { System, Viewport } from '../core/Engine';
import type { ManifestBody } from '../manifest';
import {
  createLabelBoxes,
  createTakenBoxes,
  declutter,
  verticalClearance,
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
  /**
   * Where the ship is drawn right now, while it is a marker that says "you are here" (the star
   * map), or null. No name lies on it, like the obstacles; but where one would, that name moves
   * to ABOVE its body instead of hiding, because the ship is most often beside the very body
   * whose name it is (circling it, or parked beside home).
   */
  ship?: () => Readonly<ScreenBox> | null;
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
  /** 1 for a name that sits above its body, out of the ship's way; 0 (as usual) below it. */
  private readonly above: Uint8Array;
  private readonly lastX: Float64Array;
  private readonly lastY: Float64Array;
  private width = 1;
  private height = 1;
  private measured = false;
  private focused = -1;
  private marked = -1;
  private barBottom = 0;
  private foot: { right: number; top: number } | null = null;
  /** Where names may go this frame (CSS px): the free view, less its edges and the top bar. */
  private readonly room = { right: 0, bottom: 0, top: 0 };

  constructor(private readonly options: LabelsOptions) {
    const count = options.bodies.length;
    this.boxes = createLabelBoxes(count);
    // Three more than the obstacles: the face of the body the ship is docked at, the ship, and
    // the page's footer chip.
    this.taken = createTakenBoxes((options.obstacles?.length ?? 0) + 3);
    this.wasShown = new Uint8Array(count);
    this.above = new Uint8Array(count);
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
    const { room } = this;
    room.right = this.width * view.freeWidth - params.edgePx;
    room.bottom = this.height * view.freeHeight - params.edgePx;
    room.top = Math.max(params.topPx, this.barBottom + params.edgePx);

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
    // Docked, the body is the picture and its name is on the page: no other name lies on its
    // face (a station passing in front of it, say), as none lies on the prompt.
    const face = this.taken.boxes[obstacles];
    const faceRadius = screen.radius[target] ?? 0;
    if (docked && face && (screen.depth[target] ?? 0) > 0 && faceRadius > 0) {
      face.left = (screen.x[target] ?? 0) - faceRadius;
      face.top = (screen.y[target] ?? 0) - faceRadius;
      face.width = 2 * faceRadius;
      face.height = 2 * faceRadius;
      obstacles += 1;
    }
    const ship = this.options.ship?.() ?? null;
    const shipSlot = this.taken.boxes[obstacles];
    if (ship && shipSlot) {
      shipSlot.left = ship.left;
      shipSlot.top = ship.top;
      shipSlot.width = ship.width;
      shipSlot.height = ship.height;
      obstacles += 1;
    }
    const footSlot = this.taken.boxes[obstacles];
    if (this.foot && footSlot) {
      footSlot.left = 0;
      footSlot.top = this.foot.top;
      footSlot.width = this.foot.right;
      footSlot.height = Math.max(0, this.height - this.foot.top);
      obstacles += 1;
    }
    this.taken.count = obstacles;

    boxes.count = Math.min(screen.count, bodies.length);
    for (let row = 0; row < boxes.count; row += 1) {
      boxes.priority[row] = Infinity;
      const depth = screen.depth[row] ?? 0;
      const radius = screen.radius[row] ?? 0;
      if (!(depth > 0) || radius < params.minVisiblePx || (docked && row === target)) {
        this.above[row] = 0;
        continue;
      }

      const w = boxes.width[row] ?? 0;
      const h = boxes.height[row] ?? 0;
      const left = (screen.x[row] ?? 0) - w / 2;
      const under = (screen.y[row] ?? 0) + radius + params.offsetPx;
      const over = (screen.y[row] ?? 0) - radius - params.offsetPx - h;
      this.above[row] = ship ? this.sideOf(row, left, under, over, ship) : 0;
      const top = this.above[row] ? over : under;
      boxes.left[row] = left;
      boxes.top[row] = top;
      if (!this.fits(row, left, top)) continue;

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
   * Above its body (1) or below it (0): below, unless the ship lies there and above is clearly the
   * better place. Steady, like declutter: a name only moves when the ship comes within the gap of
   * it, moves back once the ship is a gap and a keep away (or clearly further from below than from
   * above), and changes sides before the ship is so far over it that declutter would hide it.
   */
  private sideOf(
    row: number,
    left: number,
    under: number,
    over: number,
    ship: Readonly<ScreenBox>,
  ): number {
    const { gapPx, keepPx } = this.options.params;
    const w = this.boxes.width[row] ?? 0;
    const h = this.boxes.height[row] ?? 0;
    const below = verticalClearance(left, under, w, h, ship, gapPx);
    const above = verticalClearance(left, over, w, h, ship, gapPx);
    const margin = keepPx / 2;
    if (this.above[row]) {
      const back = !this.fits(row, left, over) || below >= gapPx + keepPx || below > above + margin;
      return back ? 0 : 1;
    }
    return below < gapPx && above > below + margin && this.fits(row, left, over) ? 1 : 0;
  }

  /** Would this row's name, put here, be wholly in the free view, clear of its edges? */
  private fits(row: number, left: number, top: number): boolean {
    const { room } = this;
    return (
      left >= this.options.params.edgePx &&
      left + (this.boxes.width[row] ?? 0) <= room.right &&
      top >= room.top &&
      top + (this.boxes.height[row] ?? 0) <= room.bottom
    );
  }

  /**
   * How far down the page's top bar reaches (CSS px). The bar is the web layer's, so the web layer
   * measures it (shell/panel-inset.ts): on a phone it is two rows tall, and a name must not lie
   * on its links.
   */
  setTop(px: number): void {
    this.barBottom = Math.max(0, px);
  }

  /**
   * Where the page's footer chip is (CSS px: from the left edge to `right`, from `top` down), or
   * null. The web layer's, measured by the web layer like the top bar; names keep off it.
   */
  setFoot(foot: { readonly right: number; readonly top: number } | null): void {
    this.foot = foot ? { right: foot.right, top: foot.top } : null;
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
