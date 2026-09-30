import type { System, Viewport } from '../core/Engine';
import type { ManifestBody } from '../manifest';
import {
  createLabelBoxes,
  createTakenBoxes,
  declutter,
  glidePast,
  NOWHERE,
  verticalClearance,
  type DeclutterParams,
  type ScreenBox,
} from '../sim/declutter';
import type { ScreenMap } from '../sim/screen';
import { plannedName } from './planned';

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
  /**
   * By row of the orbit table. `planned`: work not built yet, and its name says so. `href`: a
   * profile on another site (a link, which nothing docks at): its name is a real link to it, in a
   * group of its own, and pressing it leaves the site the way any link does.
   */
  bodies: ReadonlyArray<{
    readonly title: string;
    readonly kind: BodyKind;
    readonly planned?: boolean;
    readonly href?: string | undefined;
  }>;
  params: LabelsParams;
  /** The part of the view that the info panel leaves free, as shares of its width and height. */
  view: { readonly freeWidth: number; readonly freeHeight: number };
  /** Row of the body the ship is headed for or docked at, or -1. */
  target(): number;
  /** Is the ship docked (at `target`)? Then its page is open, and its name is on the page. */
  docked(): boolean;
  /** The visitor pressed the name of the body in this row (never a link's: that is followed). */
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
   * (`onMap`), and never hides for it where it has room to do either.
   */
  ship?: () => Readonly<ScreenBox> | null;
  /**
   * Is the star map up? It holds still, and there a name has more than one place: ABOVE its
   * body, where it has no room below (the panel, an edge) or the ship is in its way there; BESIDE
   * it, like a station's name on a transit map; or slid along it, away from a screen edge it
   * would cross, as long as its body stays over its tag. Where one place is taken it takes
   * another, and names make way for each other where they can (sim/declutter.ts). In flight
   * everything drifts, and a name that hopped round its body would only distract: one place,
   * under it.
   */
  onMap?: () => boolean;
}

/** Which side of its body a name's tag is on (`data-side` in the stylesheet, but for below). */
const BELOW = 0;
const ABOVE = 1;
const RIGHT = 2;
const LEFT = 3;
const SIDE_NAMES = [undefined, 'above', 'right', 'left'] as const;

/**
 * How many places a name has on the map (`onMap`). The first is centred on the side `sideOf`
 * chooses, below or above; then the other of the two, centred; then beside the body, the side
 * towards the middle of the view first; then below and above again, slid along the body, the
 * way away from the nearer screen edge first (the body over the round end of the tag).
 */
const PLACES = 8;
/** Which way a tag reaches along its body: centred, or all to one side of it. */
type Reach = -1 | 0 | 1;

/**
 * Suns and the home planet name a whole system; moons are the small print. A link ranks with the
 * planets: Allen's profiles are what a recruiter looks for.
 */
const RANK: Record<BodyKind, number> = {
  sun: 1,
  home: 1,
  planet: 2,
  station: 2,
  satellite: 2,
  link: 2,
  moon: 3,
};
/**
 * Ranks are this far apart, so that nearness (in flight the distance from the camera, u; on the
 * map the distance from the middle of the view, CSS px) only ever decides WITHIN a rank.
 */
const RANK_STEP = 1e6;
/** On the map, every name ranked with the systems or above them is placed together (declutter). */
const SYSTEMS_TOGETHER = (RANK.sun + 1) * RANK_STEP;

/**
 * NAMES OVER THE BODIES (docs/PLAN.md §5.5): one real <button> per body, so a name can be tapped,
 * tabbed to and read out, and pressing it flies there like pointing at the body itself. The
 * engine decides where each one is and which may show (sim/declutter.ts: important first, never
 * touching, never flickering); how they LOOK is CSS (`.body-label` in src/styles/global.css).
 *
 * A link's name (a profile elsewhere: GitHub) is a real <a> instead, in a group of its own,
 * "Elsewhere": a link that leaves the site is not a way to fly. Pointing at its BODY never leaves
 * the site either; it beckons the name (`beckon`), and leaving is a second, explicit press.
 *
 * Add it AFTER ui/BodiesOnScreen.ts. It writes a transform per visible name per frame and nothing
 * else: `translate(body) translate(place)`, to its body and from there to where the name sits, so
 * the page itself says where each body is. The only layout it reads, once the names and their
 * tags are measured (and the target's tag, once one wears it), is where its few `obstacles` are,
 * and it asks before it writes anything, while layout is still clean from the frame before.
 */
export class Labels implements System {
  /** "Fly to": the names that fly the ship somewhere. */
  private readonly root = document.createElement('div');
  /** "Elsewhere": the names of links, which leave the site. Only made when there is one. */
  private readonly elsewhere: HTMLDivElement | null = null;
  /** By row: a <button>, or for a link an <a>. */
  private readonly names: HTMLElement[] = [];
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
  /**
   * 1 for a name that sits above its body, out of the ship's way; 0 (as usual) below it, or
   * beside it. What `sideOf` remembers from frame to frame.
   */
  private readonly above: Uint8Array;
  /** Which way along its body each name's tag reaches, as it was last placed (`Reach`). */
  private readonly reach: Int8Array;
  /** What each place offered this frame is, by [row * PLACES + place]: its side, and its reach. */
  private readonly placeSide: Uint8Array;
  private readonly placeReach: Int8Array;
  /** Which side each name's button was last told it is on (`data-side`), so CSS draws it so. */
  private readonly drawnSide: Uint8Array;
  /** Where each name's box, and its body, were last written (`translate`), to the tenth. */
  private readonly lastX: Float64Array;
  private readonly lastY: Float64Array;
  private readonly lastBodyX: Float64Array;
  private readonly lastBodyY: Float64Array;
  private width = 1;
  private height = 1;
  private measured = false;
  private focused = -1;
  /** A link's row whose body was pointed at: its name takes the focus as soon as it shows. */
  private beckoning = -1;
  private marked = -1;
  private barBottom = 0;
  private foot: { right: number; top: number } | null = null;
  /** Where names may go this frame (CSS px): the free view, less its edges and the top bar. */
  private readonly room = { right: 0, bottom: 0, top: 0 };

  constructor(private readonly options: LabelsOptions) {
    const count = options.bodies.length;
    this.boxes = createLabelBoxes(count, PLACES);
    this.widths = new Float64Array(count);
    this.heights = new Float64Array(count);
    this.tags = new Float64Array(count);
    // Two more than the obstacles: the face of the body the ship is docked at, and the page's
    // footer chip.
    this.taken = createTakenBoxes((options.obstacles?.length ?? 0) + 2);
    this.wasShown = new Uint8Array(count);
    this.above = new Uint8Array(count);
    this.reach = new Int8Array(count);
    this.placeSide = new Uint8Array(count * PLACES);
    this.placeReach = new Int8Array(count * PLACES);
    this.drawnSide = new Uint8Array(count);
    this.lastX = new Float64Array(count).fill(Number.NaN);
    this.lastY = new Float64Array(count).fill(Number.NaN);
    this.lastBodyX = new Float64Array(count).fill(Number.NaN);
    this.lastBodyY = new Float64Array(count).fill(Number.NaN);

    group(this.root, 'Fly to');
    options.bodies.forEach((body, row) => {
      const name = body.href === undefined ? flyTo(body) : elsewhere(body.title, body.href);
      name.classList.add('body-label');
      name.dataset.row = String(row);
      name.dataset.kind = body.kind;
      this.names.push(name);
    });
    const links = this.names.filter((name) => name instanceof HTMLAnchorElement);
    this.root.append(...this.names.filter((name) => !(name instanceof HTMLAnchorElement)));
    options.overlay.append(this.root);
    if (links.length > 0) {
      this.elsewhere = group(document.createElement('div'), 'Elsewhere');
      this.elsewhere.append(...links);
      options.overlay.append(this.elsewhere);
    }

    // (A link is followed by the browser, like any link: it is no click of ours.)
    this.root.addEventListener('click', this.onClick);
    for (const root of this.roots()) {
      root.addEventListener('focusin', this.onFocusIn);
      root.addEventListener('focusout', this.onFocusOut);
    }
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
    const { boxes, placeSide, placeReach } = this;
    const target = this.options.target();
    const docked = this.options.docked();
    const ship = this.options.ship?.() ?? null;
    const onMap = this.options.onMap?.() ?? false;
    const { room } = this;
    room.right = this.width * view.freeWidth - params.edgePx;
    room.bottom = this.height * view.freeHeight - params.edgePx;
    room.top = Math.max(params.topPx, this.barBottom + params.edgePx);
    // The middle of where names may go: on the map, where the visitor is looking.
    const middleX = (params.edgePx + room.right) / 2;
    const middleY = (room.top + room.bottom) / 2;

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
    boxes.left.fill(Number.NaN, 0, boxes.count * PLACES);
    boxes.top.fill(Number.NaN, 0, boxes.count * PLACES);
    for (let row = 0; row < boxes.count; row += 1) {
      boxes.priority[row] = Infinity;
      const depth = screen.depth[row] ?? 0;
      const radius = screen.radius[row] ?? 0;
      if (!(depth > 0) || radius < params.minVisiblePx || (docked && row === target)) {
        this.above[row] = 0;
        continue;
      }

      // The box as it is drawn: the target's tag reaches further left, to hold its dot.
      const x = screen.x[row] ?? 0;
      const y = screen.y[row] ?? 0;
      const lead = row === target ? this.lead : 0;
      const centred = x - (this.widths[row] ?? 0) / 2 - lead;
      const width = (this.widths[row] ?? 0) + lead;
      const tag = this.tags[row] ?? 0;
      const height = this.heights[row] ?? 0;
      // On the map a name that would cross a screen edge slides away from it, along its body.
      const slid = onMap ? this.along(x, centred, width, tag, 0) : Number.NaN;
      const left = Number.isFinite(slid) ? slid : centred;
      // Where the button goes, below its body or above it. Either side the TAG sits offsetPx off
      // the body, at the end of the 44 px box nearest it (its top below, its bottom above: CSS,
      // `data-side`), and the rest of the box, a clear touch target, lies beyond it.
      const under = y + radius + params.offsetPx;
      const over = y - radius - params.offsetPx - height;
      // How far each side's tag would have to glide, away from the body, to clear the ship.
      const down = ship ? glidePast(left, under, width, tag, ship, params.gapPx, 1) : 0;
      const up = ship
        ? glidePast(left, over + height - tag, width, tag, ship, params.gapPx, -1)
        : 0;
      let side = onMap ? this.sideOf(row, left, width, under, over, down, up, ship) : 0;
      let top = side ? over - up : under + down;
      const kept = row === target || row === this.focused || row === this.beckoning;
      let first = true;
      if (!this.fits(row, left, width, top)) {
        // No room past the ship. Where the ship is going, and whatever the keyboard is on, then
        // show where they would have been: on the ship is better than gone.
        if (!kept || (down === 0 && up === 0)) first = false;
        else if (this.fits(row, left, width, under)) [side, top] = [0, under];
        else if (onMap && this.fits(row, left, width, over)) [side, top] = [1, over];
        else first = false;
      } else if (!kept && (side ? up : down) > this.patience(row)) {
        // Any other name glides a little, and makes way for the ship beyond that.
        first = false;
      }
      this.above[row] = side;
      const base = row * PLACES;
      placeSide[base] = side;
      placeReach[base] = 0;
      if (first) {
        boxes.left[base] = left;
        boxes.top[base] = top;
      }
      let offered = first ? 1 : 0;
      if (onMap) {
        // Its other places: the other side, beside the body, then above and below with the tag
        // reaching all one way along the body. Towards the middle of the view first: away from
        // the nearer screen edge.
        const inward: Reach = x < middleX ? 1 : -1;
        const other = side === ABOVE ? BELOW : ABOVE;
        const at = { x, y, radius, centred, width, tag, under, over, ship };
        offered += this.offer(row, 1, other, 0, at);
        offered += this.offer(row, 2, inward > 0 ? RIGHT : LEFT, 0, at);
        offered += this.offer(row, 3, inward > 0 ? LEFT : RIGHT, 0, at);
        offered += this.offer(row, 4, side, inward, at);
        offered += this.offer(row, 5, side, -inward as Reach, at);
        offered += this.offer(row, 6, other, inward, at);
        offered += this.offer(row, 7, other, -inward as Reach, at);
      }
      if (offered === 0) continue;
      boxes.width[row] = width;
      boxes.height[row] = height;
      // Where it showed last frame, among the places it has now: it may stay there a while.
      boxes.at[row] = NOWHERE;
      for (let place = 0; place < PLACES; place += 1) {
        if (!Number.isFinite(boxes.left[base + place] ?? Number.NaN)) continue;
        if (placeSide[base + place] !== this.drawnSide[row]) continue;
        if (placeReach[base + place] !== this.reach[row]) continue;
        boxes.at[row] = place;
        break;
      }

      // Where the ship is going comes first, then whatever the keyboard is on (a name must not
      // vanish from under someone who has tabbed to it, or who is about to be: `beckon`), then
      // systems, planets, moons. Among those, the nearest first: in flight the nearest the
      // camera, and on the map, which is seen from straight above (every body is as far from the
      // camera), the nearest the middle of the view, where the visitor is looking.
      const kind = bodies[row]?.kind ?? 'moon';
      const rank =
        row === target ? 0 : row === this.focused || row === this.beckoning ? 0.5 : RANK[kind];
      const near = onMap ? Math.hypot(x - middleX, y - middleY) : depth;
      boxes.priority[row] = rank * RANK_STEP + near;
    }
    // On the map, whatever names a system (and where the ship is going, and the keyboard's name)
    // is placed together: every way of fitting them all is tried before one of them is left out.
    declutter(boxes, params, this.taken, onMap ? SYSTEMS_TOGETHER : -Infinity);

    for (let row = 0; row < boxes.count; row += 1) {
      const name = this.names[row];
      if (!name) continue;
      const shows = boxes.shown[row] === 1;
      if (shows !== (this.wasShown[row] === 1)) {
        this.wasShown[row] = shows ? 1 : 0;
        if (shows) name.dataset.shown = '';
        else delete name.dataset.shown;
      }
      if (!shows) continue;
      const place = row * PLACES + (boxes.at[row] ?? 0);
      const side = placeSide[place] ?? BELOW;
      this.above[row] = side === ABOVE ? 1 : 0;
      this.reach[row] = placeReach[place] ?? 0;
      if (side !== this.drawnSide[row]) {
        this.drawnSide[row] = side;
        const drawn = SIDE_NAMES[side];
        if (drawn) name.dataset.side = drawn;
        else delete name.dataset.side;
      }
      // Tenths of a pixel: finer than anyone can see, coarse enough to skip most writes at rest.
      // Two moves: to the body, then from there to the name's place. The box lands where declutter
      // put it, and whoever reads the transform (the end-to-end tests) knows where the body is,
      // whichever of its places the name took.
      const lead = row === target ? this.lead : 0;
      const x = tenths((boxes.left[place] ?? 0) + lead);
      const y = tenths(boxes.top[place] ?? 0);
      const bodyX = tenths(screen.x[row] ?? 0);
      const bodyY = tenths(screen.y[row] ?? 0);
      if (
        x === this.lastX[row] &&
        y === this.lastY[row] &&
        bodyX === this.lastBodyX[row] &&
        bodyY === this.lastBodyY[row]
      ) {
        continue;
      }
      this.lastX[row] = x;
      this.lastY[row] = y;
      this.lastBodyX[row] = bodyX;
      this.lastBodyY[row] = bodyY;
      const dx = tenths(x - bodyX);
      const dy = tenths(y - bodyY);
      name.style.transform = `translate(${bodyX}px, ${bodyY}px) translate(${dx}px, ${dy}px)`;
    }

    if (target !== this.marked) {
      const before = this.names[this.marked];
      if (before) delete before.dataset.state;
      const now = this.names[target];
      if (now) now.dataset.state = 'target';
      this.marked = target;
    }

    // A beckoned name is focused once it shows (a hidden one cannot take the focus). One that
    // cannot show this frame, with no room anywhere near its body, is not beckoned at all.
    if (this.beckoning >= 0) {
      const name = this.names[this.beckoning];
      if (name && this.wasShown[this.beckoning] === 1) {
        name.dataset.beckon = '';
        name.focus({ preventScroll: true });
      }
      this.beckoning = -1;
    }
  }

  /**
   * The room a name needs below its body, or above it (CSS px): its gap off the body, its box,
   * and the gap names keep from the edge of the view. The star map lets its view go this far
   * past the top and the bottom of the galaxy (main.ts), so that a body at the very edge can be
   * brought in until its name has room there. 0 until the names have been measured.
   */
  get roomPx(): number {
    if (!this.measured) return 0;
    let tallest = 0;
    for (const height of this.heights) tallest = Math.max(tallest, height);
    const { offsetPx, edgePx } = this.options.params;
    return offsetPx + tallest + edgePx;
  }

  /**
   * The visitor pointed at the body of a link (a relay: main.ts): that never takes them off the
   * site by itself, whatever a hand does while it steers. The link's name comes forward instead,
   * with the next frame: it shows whatever else wants the room, takes the keyboard's focus and is
   * lit (`data-beckon`, until the focus moves on), so that leaving is a second, explicit press of
   * the link itself, or Enter. Nothing for a row that is not a link.
   */
  beckon(row: number): void {
    if (this.names[row] instanceof HTMLAnchorElement) this.beckoning = row;
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
   * Offer place `index` of a name on the map: its tag on `side` of its body. Below or above it,
   * reaching `reach` along it and glided a little past the ship if that is in the way, as the
   * first place is; beside it, in the middle of the box's height and `offsetPx` off the disc, and
   * only where the ship is a gap clear of the tag. 1 if it is a place (wholly in the free view, and
   * the glide no more than this name's patience), else 0, and the place is left out (NaN). `at` is
   * where the name and its body are.
   */
  private offer(
    row: number,
    index: number,
    side: number,
    reach: Reach,
    at: {
      readonly x: number;
      readonly y: number;
      readonly radius: number;
      readonly centred: number;
      readonly width: number;
      readonly tag: number;
      readonly under: number;
      readonly over: number;
      readonly ship: Readonly<ScreenBox> | null;
    },
  ): number {
    const place = row * PLACES + index;
    this.placeSide[place] = side;
    this.placeReach[place] = reach;
    const { x, y, radius, centred, width, tag, under, over, ship } = at;
    const { gapPx, offsetPx } = this.options.params;
    const height = this.heights[row] ?? 0;
    let left: number;
    let top: number;
    if (side === RIGHT || side === LEFT) {
      left = side === RIGHT ? x + radius + offsetPx : x - radius - offsetPx - width;
      top = y - height / 2;
      if (ship && glidePast(left, y - tag / 2, width, tag, ship, gapPx, 1) > 0) return 0;
      if (!this.fits(row, left, width, top)) return 0;
    } else {
      left = this.along(x, centred, width, tag, reach);
      if (!Number.isFinite(left)) return 0;
      const glide = !ship
        ? 0
        : side === ABOVE
          ? glidePast(left, over + height - tag, width, tag, ship, gapPx, -1)
          : glidePast(left, under, width, tag, ship, gapPx, 1);
      top = side === ABOVE ? over - glide : under + glide;
      if (!this.fits(row, left, width, top) || glide > this.patience(row)) return 0;
    }
    this.boxes.left[place] = left;
    this.boxes.top[place] = top;
    return 1;
  }

  /**
   * Where a name `width` wide goes along its body at `x`: centred on it (`centred`, reach 0), or
   * reaching all one way from it (1: to the right), the body over the round end of its tag. Slid
   * back into the free view if that would cross a side of it, as long as the body stays over the
   * tag, past its round end; NaN if it cannot.
   */
  private along(x: number, centred: number, width: number, tag: number, reach: Reach): number {
    const end = tag / 2;
    const wanted = reach === 0 ? centred : reach > 0 ? x - end : x + end - width;
    const min = this.options.params.edgePx;
    const max = this.room.right - width;
    if (max < min) return Number.NaN;
    const left = Math.min(Math.max(wanted, min), max);
    return x >= left + end && x <= left + width - end ? left : Number.NaN;
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
    for (const root of this.roots()) {
      root.removeEventListener('focusin', this.onFocusIn);
      root.removeEventListener('focusout', this.onFocusOut);
      root.remove();
    }
  }

  private roots(): HTMLDivElement[] {
    return this.elsewhere ? [this.root, this.elsewhere] : [this.root];
  }

  /**
   * How big each name is, and its tag. The one time layout is read; a hidden name still has its
   * size.
   */
  private measure(): void {
    this.measured = true;
    this.names.forEach((name, row) => {
      // No layout (a test, a detached overlay): a fair guess keeps everything else working, and
      // takes the whole box for the tag.
      const height = name.offsetHeight || 44;
      this.widths[row] = name.offsetWidth || (name.textContent?.length ?? 0) * 7 + 24;
      this.heights[row] = height;
      const tag = parseFloat(getComputedStyle(name, '::after').height);
      this.tags[row] = tag > 0 ? Math.min(tag, height) : height;
    });
  }

  /** How far the target's tag reaches left of its box, measured on the name that wears it. */
  private measureLead(row: number): void {
    const name = this.names[row];
    if (!name) return;
    this.leadMeasured = true;
    const left = parseFloat(getComputedStyle(name, '::after').left);
    this.lead = left < 0 ? -left : 0;
  }

  /** The row of the name an event happened on (a button or a link, or a part of one), or -1. */
  private rowOf(event: Event): number {
    const name = event.target instanceof Element ? event.target.closest('[data-row]') : null;
    const row = Number(name instanceof HTMLElement ? name.dataset.row : Number.NaN);
    return Number.isInteger(row) ? row : -1;
  }

  private readonly onClick = (event: Event): void => {
    const row = this.rowOf(event);
    if (row >= 0 && !(this.names[row] instanceof HTMLAnchorElement)) this.options.onPick(row);
  };

  private readonly onFocusIn = (event: Event): void => {
    this.focused = this.rowOf(event);
  };

  private readonly onFocusOut = (event: Event): void => {
    this.focused = -1;
    // A beckoned name is lit only while it has the focus.
    if (event.target instanceof HTMLElement) delete event.target.dataset.beckon;
  };
}

function group(root: HTMLDivElement, label: string): HTMLDivElement {
  // A finger that moves on a name moves the map (ui/StarMap.ts), never the page: `touch-action`
  // on `.body-labels` in src/styles/global.css.
  root.className = 'body-labels';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', label);
  return root;
}

/** The name of a body the ship can fly to: a button. */
function flyTo(body: { readonly title: string; readonly planned?: boolean }): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = body.title;
  // Planned work says so, seen and heard: "Sports Analysis, Planned" (ui/planned.ts). The
  // button is a flex box: the name and its note share one inline wrapper.
  if (body.planned) {
    button.dataset.planned = '';
    button.replaceChildren(plannedName('body-label', body.title));
  }
  return button;
}

/**
 * The name of a link: a real link to the profile, in this tab like every link on the site (Back
 * brings the visitor, and the ship, back: shell/pose-memory.ts), `rel="me"` as on the pages. It is
 * heard with the site it goes to ("GitHub, on github.com"), which it does not show: the outward
 * arrow after the name says that it leaves (global.css). It is never dragged as a link: on the
 * star map a hand that moves on a name moves the map.
 */
function elsewhere(title: string, href: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = href;
  link.rel = 'me noopener';
  link.draggable = false;
  link.textContent = title;
  link.setAttribute('aria-label', `${title}, on ${hostOf(href)}`);
  return link;
}

/** "https://www.linkedin.com/in/x" -> "linkedin.com". */
function hostOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return href;
  }
}

/** To the tenth of a CSS pixel. */
function tenths(px: number): number {
  return Math.round(px * 10) / 10;
}
