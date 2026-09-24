import type { System, Viewport } from '../core/Engine';
import type { ManifestBody } from '../manifest';
import {
  createLabelBoxes,
  createTakenBoxes,
  declutter,
  glidePast,
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
   * map), or null. No name's tag lies on it. It is not an obstacle like the others, because it is
   * most often right beside the very body whose name it is (circling it, or parked beside home):
   * a name it would be under glides just past it, away from its body, or changes sides
   * (`eitherSide`), and never hides for it where it has room to do either.
   */
  ship?: () => Readonly<ScreenBox> | null;
  /**
   * May a name sit ABOVE its body, where it has no room below (the panel, an edge) or where the
   * ship is in its way there? Only on the star map, which holds still: in flight everything
   * drifts, and a name that hopped round its body would only distract.
   */
  eitherSide?: () => boolean;
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
 * else. The only layout it reads, once the names and their tags are measured (and the target's
 * tag, once one wears it), is where its few `obstacles` are, and it asks before it writes
 * anything, while layout is still clean from the frame before.
 */
export class Labels implements System {
  private readonly root = document.createElement('div');
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly boxes;
  private readonly taken;
  /** Each name's size as measured (its 44 px box), and how tall its visible tag is within it. */
  private readonly widths: Float64Array;
  private readonly heights: Float64Array;
  private readonly tags: Float64Array;
  /** How far the target's tag reaches left of its box, to hold the station dot (CSS px). */
  private lead = 0;
  private leadMeasured = false;
  private readonly wasShown: Uint8Array;
  /** 1 for a name that sits above its body, out of the ship's way; 0 (as usual) below it. */
  private readonly above: Uint8Array;
  /** Which side each name's button was last told it is on (`data-side`), so CSS draws it so. */
  private readonly drawnAbove: Uint8Array;
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
    this.widths = new Float64Array(count);
    this.heights = new Float64Array(count);
    this.tags = new Float64Array(count);
    // Two more than the obstacles: the face of the body the ship is docked at, and the page's
    // footer chip.
    this.taken = createTakenBoxes((options.obstacles?.length ?? 0) + 2);
    this.wasShown = new Uint8Array(count);
    this.above = new Uint8Array(count);
    this.drawnAbove = new Uint8Array(count);
    this.lastX = new Float64Array(count).fill(Number.NaN);
    this.lastY = new Float64Array(count).fill(Number.NaN);

    // A finger that moves on a name moves the map (ui/StarMap.ts), never the page: `touch-action`
    // on `.body-labels` in src/styles/global.css.
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
      this.leadMeasured = false;
    });
  }

  frameUpdate(): void {
    if (!this.measured) this.measure();
    // The target's tag is measured on the name that wears it, once one has (it was marked at the
    // end of a frame, so layout is clean again by the start of the next).
    if (!this.leadMeasured && this.marked >= 0) this.measureLead(this.marked);
    const { screen, params, view, bodies } = this.options;
    const { boxes } = this;
    const target = this.options.target();
    const docked = this.options.docked();
    const ship = this.options.ship?.() ?? null;
    const eitherSide = this.options.eitherSide?.() ?? false;
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

      // The box as it is drawn: the target's tag reaches further left, to hold its dot.
      const lead = row === target ? this.lead : 0;
      const left = (screen.x[row] ?? 0) - (this.widths[row] ?? 0) / 2 - lead;
      const width = (this.widths[row] ?? 0) + lead;
      const tag = this.tags[row] ?? 0;
      const height = this.heights[row] ?? 0;
      // Where the button goes, below its body or above it. Either side the TAG sits offsetPx off
      // the body, at the end of the 44 px box nearest it (its top below, its bottom above: CSS,
      // `data-side`), and the rest of the box, a clear touch target, lies beyond it.
      const under = (screen.y[row] ?? 0) + radius + params.offsetPx;
      const over = (screen.y[row] ?? 0) - radius - params.offsetPx - height;
      // How far each side's tag would have to glide, away from the body, to clear the ship.
      const down = ship ? glidePast(left, under, width, tag, ship, params.gapPx, 1) : 0;
      const up = ship
        ? glidePast(left, over + height - tag, width, tag, ship, params.gapPx, -1)
        : 0;
      let side = eitherSide ? this.sideOf(row, left, width, under, over, down, up, ship) : 0;
      let top = side ? over - up : under + down;
      const kept = row === target || row === this.focused;
      if (!this.fits(row, left, width, top)) {
        // No room past the ship. Where the ship is going, and whatever the keyboard is on, then
        // show where they would have been: on the ship is better than gone.
        if (!kept || (down === 0 && up === 0)) continue;
        if (this.fits(row, left, width, under)) [side, top] = [0, under];
        else if (eitherSide && this.fits(row, left, width, over)) [side, top] = [1, over];
        else continue;
      } else if (!kept && (side ? up : down) > this.patience(row)) {
        // Any other name glides a little, and makes way for the ship beyond that.
        continue;
      }
      this.above[row] = side;
      boxes.left[row] = left;
      boxes.top[row] = top;
      boxes.width[row] = width;
      boxes.height[row] = height;

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
      const side = this.above[row] ?? 0;
      if (side !== this.drawnAbove[row]) {
        this.drawnAbove[row] = side;
        if (side) button.dataset.side = 'above';
        else delete button.dataset.side;
      }
      // Tenths of a pixel: finer than anyone can see, coarse enough to skip most writes at rest.
      const lead = row === target ? this.lead : 0;
      const x = Math.round(((boxes.left[row] ?? 0) + lead) * 10) / 10;
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
   * Above its body (1) or below it (0), given how far each side's tag would glide to clear the
   * ship. Below, unless there is no room there (the panel, an edge, something that can be
   * pressed), or the ship is in the way there and clearly less so above. Steady, like declutter:
   * a name stays on its side as long as declutter would let it stay, and one that went above
   * comes back only once below has room to spare and the ship is a gap and a keep clear of it (or
   * clearly more in the way above), so it never hops back and forth.
   */
  private sideOf(
    row: number,
    left: number,
    width: number,
    under: number,
    over: number,
    down: number,
    up: number,
    ship: Readonly<ScreenBox> | null,
  ): number {
    const { gapPx, keepPx } = this.options.params;
    const margin = keepPx / 2;
    const stay = this.wasShown[row] ? -keepPx : 0;
    if (this.above[row]) {
      if (!this.hasRoom(row, left, width, over - up, stay)) return 0;
      if (!this.hasRoom(row, left, width, under + down, keepPx)) return 1;
      const clear = ship
        ? verticalClearance(left, under, width, this.tags[row] ?? 0, ship, gapPx)
        : Infinity;
      return clear >= gapPx + keepPx || up > down + margin ? 0 : 1;
    }
    if (!this.hasRoom(row, left, width, over - up, 0)) return 0;
    if (!this.hasRoom(row, left, width, under + down, stay)) return 1;
    return down > up + margin ? 1 : 0;
  }

  /**
   * Would this row's name, put here, have room: wholly in the free view, and a gap clear of
   * everything that can be pressed (the obstacles, the footer chip)? `slack` asks for that much
   * more room, or (negative) lets a name that shows already stay that much closer, as declutter
   * does.
   */
  private hasRoom(row: number, left: number, width: number, top: number, slack: number): boolean {
    if (!this.fits(row, left, width, top, Math.max(0, slack))) return false;
    const pad = this.options.params.gapPx + slack;
    const height = this.heights[row] ?? 0;
    const { taken } = this;
    for (let k = 0; k < taken.count; k += 1) {
      const box = taken.boxes[k];
      if (!box) continue;
      if (
        left - pad < box.left + box.width &&
        left + width + pad > box.left &&
        top - pad < box.top + box.height &&
        top + height + pad > box.top
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * How far a name other than the target's or the focused one may glide to clear the ship (CSS
   * px): as much closer than the gap as declutter lets a name that shows already stay, and no
   * further than the gap for one that has yet to appear.
   */
  private patience(row: number): number {
    const { gapPx, keepPx } = this.options.params;
    return this.wasShown[row] ? gapPx + keepPx : gapPx;
  }

  /**
   * Would this row's name, put here, be wholly in the free view, clear of its edges (and, up and
   * down, `inset` more)?
   */
  private fits(row: number, left: number, width: number, top: number, inset = 0): boolean {
    const { room } = this;
    return (
      left >= this.options.params.edgePx &&
      left + width <= room.right &&
      top >= room.top + inset &&
      top + (this.heights[row] ?? 0) <= room.bottom - inset
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
    this.leadMeasured = false;
  }

  /**
   * Measure the names again before they are next placed: the stylesheet may set them in another
   * size now (on the star map, `html[data-map]`, where they are read from further off).
   */
  remeasure(): void {
    this.measured = false;
    // The target's tag too: it is set in the same size as the names.
    this.leadMeasured = false;
  }

  dispose(): void {
    this.root.removeEventListener('click', this.onClick);
    this.root.removeEventListener('focusin', this.onFocusIn);
    this.root.removeEventListener('focusout', this.onFocusOut);
    this.root.remove();
  }

  /**
   * How big each name is, and its tag. The one time layout is read; a hidden name still has its
   * size.
   */
  private measure(): void {
    this.measured = true;
    this.buttons.forEach((button, row) => {
      // No layout (a test, a detached overlay): a fair guess keeps everything else working, and
      // takes the whole box for the tag.
      const height = button.offsetHeight || 44;
      this.widths[row] = button.offsetWidth || (button.textContent?.length ?? 0) * 7 + 24;
      this.heights[row] = height;
      const tag = parseFloat(getComputedStyle(button, '::after').height);
      this.tags[row] = tag > 0 ? Math.min(tag, height) : height;
    });
  }

  /** How far the target's tag reaches left of its box, measured on the name that wears it. */
  private measureLead(row: number): void {
    const button = this.buttons[row];
    if (!button) return;
    this.leadMeasured = true;
    const left = parseFloat(getComputedStyle(button, '::after').left);
    this.lead = left < 0 ? -left : 0;
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
