import type { Frame, System, Viewport } from '../core/Engine';
import type { ThemeKey } from '../design/tokens';
import type { ManifestBody } from '../manifest';
import {
  createLabelBoxes,
  createTakenBoxes,
  declutter,
  glidePast,
  NOWHERE,
  verticalClearance,
  type DeclutterParams,
  type DeclutterRules,
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
  /**
   * On the map, a name that has just appeared, hidden or changed places makes no other change of
   * its own accord for this long (s): it does not come back, go back to its first place, nor move
   * aside for another. It still gives way where it must.
   */
  readonly dwellSec: number;
  /**
   * On the map, a body that circles another (a moon, a planet, a relay) gets its name once its
   * orbit is this wide on screen (its radius, CSS px), and one that shows keeps it until the orbit
   * is `keepPx` narrower. Closer in, its name has nowhere steady to be: it and its parent's take
   * turns at the same few places as the body goes round, a change every few seconds for as long as
   * the map is open. Zooming in is what brings such a name. Never the name of where the ship is
   * going, nor the one the keyboard is on. 0: every body in view may have its name.
   */
  readonly orbitMinPx: number;
  /**
   * On the map, while the view carries a body across the screen faster than this (CSS px a
   * second: a stroke of a finger, a pinch, a held key), its name is not juggled: it is offered
   * only its places as they are, none slid along the body to stay off an edge that is itself
   * passing by; a planet's or a moon's name keeps the place it has or goes, and none comes. A
   * system's name may still come, and change places, so that the landmarks stay named under the
   * fingers. The view at rest decides everything again. Infinity: never.
   */
  readonly sweptPxPerSec: number;
}

export interface LabelsOptions {
  /** Where interactive DOM goes: outside the engine's mount, which is hidden from assistive tech. */
  overlay: HTMLElement;
  /** Where every body is on screen (ui/BodiesOnScreen.ts). */
  screen: Readonly<ScreenMap>;
  /**
   * By row of the orbit table. `planned`: work not built yet, and its name says so. `href`: a
   * profile on another site (a link, which nothing docks at): its name is a real link to it, in a
   * group of its own, and pressing it leaves the site the way any link does. `theme`: the colour
   * family it wears (manifest.ts, `familiesOf`), whose glyph its tag shows before the name.
   */
  bodies: ReadonlyArray<{
    readonly title: string;
    readonly kind: BodyKind;
    readonly planned?: boolean;
    readonly href?: string | undefined;
    readonly theme?: ThemeKey | undefined;
    /** Row of the body it circles, or -1 (or left out) for one that circles none. */
    readonly parent?: number | undefined;
  }>;
  params: LabelsParams;
  /**
   * The part of the view that the page leaves free, as shares of its width and height: across
   * from `freeLeft` to `freeWidth`, and down to `freeHeight`.
   */
  view: { readonly freeLeft: number; readonly freeWidth: number; readonly freeHeight: number };
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
   * Is the star map up, and has the camera pulled all the way out to it? It holds still, and
   * there a name has more than one place: ABOVE its body, where it has no room below (the panel,
   * an edge) or the ship is in its way there; BESIDE it, like a station's name on a transit map;
   * or slid along it, away from a screen edge it would cross, as long as its body stays over its
   * tag; and a system's name also off a CORNER of its body, on the side towards the middle of the
   * view. Where one place is taken it takes another, and names make way for each other where they
   * can (sim/declutter.ts), and a name that has just changed lets that stand a while
   * (`dwellSec`). In flight everything drifts, and a name that hopped round its body would only
   * distract: one place, under it. So too on the way up to the map (its 0.9 s blend), while the
   * view still sweeps: the map's places take over in the frame it arrives, every name free to
   * take the one it likes best, and settle there, where the visitor is looking. (Taken on the way
   * up, they would each hold the place they had at some moment of the sweep a second longer than
   * that moment lasted: tests/map-names/, opening with the blend.)
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
 * way away from the nearer screen edge first (the body over the round end of the tag); and, for
 * a system's name alone, off the two CORNERS of its body that are towards the middle of the view
 * (`corner`), below it and above it.
 *
 * The corners came with the emblem worlds (2026-10-01), when every tag grew wider by its family's
 * glyph and the gap after it, 13 px: on a 360 px phone's first view that left Hardware's name no
 * place but on Software's sun whenever the home planet's, kept from below its planet by the ship,
 * stood beside it instead (tests/map-names/). Off a corner, the home planet's name
 * clears the row its neighbour needs. Only a system's name: a planet's or a moon's off a corner
 * reads as its neighbour's too often (a laptop's first view, tags level with another body a look:
 * 0.56, and 1.76 with corners for every name). Only the two towards the middle: the other two
 * changed no count, and every place makes the systems' search dearer (sim/declutter.ts,
 * `TOGETHER_TRIES`).
 */
const PLACES = 10;
/**
 * Which way a tag reaches along its body: centred (0), all to one side of it with the body over
 * its round end (1: to the right), or past the body altogether, off its corner (2).
 */
type Reach = -2 | -1 | 0 | 1 | 2;
/** Far below anything anyone can see (CSS px), and far above a double's rounding. */
const HAIR_PX = 1e-3;
/**
 * What a name's tag would lie on, at one of its places on the map (`liesOn`): nothing, another
 * body, a gap off a sun or the home planet, or right on one (sim/declutter.ts, `covers`).
 */
const CLEAR = 0;
const ON_A_BODY = 1;
const BY_A_LANDMARK = 2;
const ON_A_LANDMARK = 3;

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
 * Ranks are this far apart, so that what decides WITHIN a rank never crosses into the next: in
 * flight, nearness (the distance from the camera, u); on the map, first whether the name shows
 * already (`WAITING`), then nearness (the distance from the middle of the view, CSS px).
 */
const RANK_STEP = 1e6;
/**
 * On the map, a name that does not show yet waits behind every name of its rank that does: it
 * takes the room that is left, and never the room of one that shows (sim/declutter.ts). Nearness
 * decides only between two that both show, or both wait, and is counted up to `NEAR_MAX` px.
 */
const WAITING = RANK_STEP / 4;
const NEAR_MAX = WAITING - 1;
/**
 * Who gives way to whom (sim/declutter.ts). The name of where the ship is going and the one under
 * the keyboard are placed first and never moved, nor left out, for another. On the map the
 * systems' names come next, placed together, every way of fitting them all tried before one is
 * left out; they move for each other, and for a planet's only back to their first places; and a
 * name that has just appeared keeps its place in `max` (12 names, which a laptop's map fills at
 * its first view most of the time) while it is young (`dwellSec`). Past that, `max` goes by rank:
 * a planet's name that waits with room takes the place of a moon's that shows, never of another
 * planet's (one that waits comes after every one of its rank that shows: `WAITING`).
 */
const IN_FLIGHT: DeclutterRules = {
  firm: RANK.sun * RANK_STEP,
  together: -Infinity,
  keepSlots: false,
};
const ON_MAP: DeclutterRules = {
  firm: RANK.sun * RANK_STEP,
  together: (RANK.sun + 1) * RANK_STEP,
  keepSlots: true,
};

/**
 * NAMES OVER THE BODIES (docs/PLAN.md §5.5): one real <button> per body, so a name can be tapped,
 * tabbed to and read out, and pressing it flies there like pointing at the body itself. The
 * engine decides where each one is and which may show (sim/declutter.ts: important first, never
 * touching, and steady: tests/map-names/ watches every change, frame by frame); how they LOOK
 * is CSS (`.body-label` in src/styles/global.css).
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
  /**
   * How far the target's tag reaches left of its box (CSS px), should the stylesheet grow it
   * there: 0 while the target's mark is its glyph, in the flow (global.css).
   */
  private lead = 0;
  private leadMeasured = false;
  private readonly wasShown: Uint8Array;
  /**
   * When each name last appeared, hid or changed places on the map (`Frame.elapsed`, s): what
   * `dwellSec` counts from. A change in flight holds nothing back (-Infinity), so the map opens
   * with every name free to show.
   */
  private readonly changedAt: Float64Array;
  /** `Frame.elapsed` of this frame. */
  private now = 0;
  /**
   * Which side of its body each name would rather be on, on the map: 1 above (out of the ship's
   * way, or where it has no room below), 0 below. `sideOf` alone decides it, from where things
   * are and from what it decided the frame before, never from where declutter put the name: so a
   * name's first place changes only when the sky does, not when the names do.
   */
  private readonly prefer: Uint8Array;
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
  /** Where each body was on screen the frame before (CSS px): which way the view takes it. */
  private readonly seenX: Float64Array;
  private readonly seenY: Float64Array;
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
  private readonly room = { left: 0, right: 0, bottom: 0, top: 0 };
  /**
   * Is the name being placed offered its places without room to spare from the edges of the view
   * (`slackAt`), having none with it?
   */
  private loose = false;
  /** Is the name being placed offered its places as they are, none slid along its body (`along`)? */
  private rigid = false;
  /** Scratch: the name being placed and its body (`offer`), filled in again for every name. */
  private readonly spot = {
    x: 0,
    y: 0,
    radius: 0,
    centred: 0,
    width: 0,
    tag: 0,
    under: 0,
    over: 0,
    ship: null as Readonly<ScreenBox> | null,
  };

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
    this.changedAt = new Float64Array(count).fill(-Infinity);
    this.prefer = new Uint8Array(count);
    this.reach = new Int8Array(count);
    this.placeSide = new Uint8Array(count * PLACES);
    this.placeReach = new Int8Array(count * PLACES);
    this.drawnSide = new Uint8Array(count);
    this.lastX = new Float64Array(count).fill(Number.NaN);
    this.lastY = new Float64Array(count).fill(Number.NaN);
    this.lastBodyX = new Float64Array(count).fill(Number.NaN);
    this.lastBodyY = new Float64Array(count).fill(Number.NaN);
    this.seenX = new Float64Array(count).fill(Number.NaN);
    this.seenY = new Float64Array(count).fill(Number.NaN);

    group(this.root, 'Fly to');
    options.bodies.forEach((body, row) => {
      const name = body.href === undefined ? flyTo(body) : elsewhere(body.title, body.href);
      name.classList.add('body-label');
      name.dataset.row = String(row);
      name.dataset.kind = body.kind;
      // Its family: the tag's glyph is `--theme-glyph` in `--theme-base` (global.css).
      if (body.theme !== undefined) name.dataset.theme = body.theme;
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

  frameUpdate(frame: Frame): void {
    this.now = frame.elapsed;
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
    room.left = this.width * view.freeLeft + params.edgePx;
    room.right = this.width * view.freeWidth - params.edgePx;
    room.bottom = this.height * view.freeHeight - params.edgePx;
    room.top = Math.max(params.topPx, this.barBottom + params.edgePx);
    // The middle of where names may go: on the map, where the visitor is looking.
    const middleX = (room.left + room.right) / 2;
    const middleY = (room.top + room.bottom) / 2;
    // How far a body may go across the screen in this frame before the view is sweeping it along.
    const sweptPx = params.sweptPxPerSec * frame.dt;

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
    boxes.covers.fill(0, 0, boxes.count * PLACES);
    for (let row = 0; row < boxes.count; row += 1) {
      boxes.priority[row] = Infinity;
      const depth = screen.depth[row] ?? 0;
      const radius = screen.radius[row] ?? 0;
      const x = screen.x[row] ?? 0;
      const y = screen.y[row] ?? 0;
      // On its way out of the view: as it goes on screen, or as it goes by itself. They are the
      // same thing until a finger drags the map: then every body goes the finger's way on screen,
      // for as long as the drag lasts, and its own way again the moment the finger stops.
      const movedX = x - (this.seenX[row] ?? x);
      const movedY = y - (this.seenY[row] ?? y);
      const leaving =
        this.leaving(x, y, movedX, movedY) ||
        this.leaving(x, y, screen.ownX[row] ?? 0, screen.ownY[row] ?? 0);
      this.seenX[row] = x;
      this.seenY[row] = y;
      if (!(depth > 0) || radius < params.minVisiblePx || (docked && row === target)) {
        this.prefer[row] = 0;
        continue;
      }
      if (onMap && this.tooClose(row, x, y, target)) {
        this.prefer[row] = 0;
        continue;
      }

      // Where its name may go. On the map a place must have room to spare from the edges of the
      // view (`slackAt`), so that a name does not come and go, nor hop from place to place, as its
      // body drifts past one by a pixel. That is to keep a name steady, never to keep it out for
      // good: one with no room to spare at any of its places (a sun half over the bottom of a
      // phone) takes any place it fits, and keeps it as any name keeps the place it has; unless its
      // body is on its way out of the view, where it would only come and go. (Its own way counts
      // as much as the way a finger is taking it: a body dragged IN from the edge while its orbit
      // takes it OUT would get its name for the drag, and lose it half a second after.)
      //
      // And while the view sweeps the body along (`sweptPxPerSec`: a finger, a pinch, a held key),
      // nothing is juggled: a place slid along the body, away from an edge that is itself going
      // by, is no place for those frames, and a planet's or a moon's name keeps the one place it
      // has, or goes, and does not come. (Under the fingers every edge of the view passes every
      // body in turn, and each pass used to be a name that came, slid and went within frames:
      // tests/map-names/, the fingers.) A system's name is placed as ever, but for the sliding:
      // the landmarks stay named whatever the fingers do.
      const preferred = this.prefer[row] ?? 0;
      const kind = bodies[row]?.kind ?? 'moon';
      const kept = row === target || row === this.focused || row === this.beckoning;
      const swept = onMap && !kept && Math.hypot(movedX, movedY) > sweptPx;
      const held = swept && RANK[kind] !== RANK.sun;
      if (held && this.wasShown[row] !== 1) continue;
      this.rigid = swept;
      let offered = this.placesOf(row, target, ship, onMap, middleX);
      if (offered === 0 && onMap && !leaving && !swept) {
        this.prefer[row] = preferred;
        this.loose = true;
        offered = this.placesOf(row, target, ship, onMap, middleX);
        this.loose = false;
      }
      this.rigid = false;
      if (offered === 0) continue;
      const base = row * PLACES;
      // Where it showed last frame, among the places it has now: it may stay there a while. In
      // flight a name has one place, and showed there if it showed at all, wherever on the map it
      // hung a frame ago (as the map closes).
      boxes.at[row] =
        !onMap && this.wasShown[row] === 1 && Number.isFinite(boxes.left[base] ?? Number.NaN)
          ? 0
          : NOWHERE;
      for (let place = 0; onMap && place < PLACES; place += 1) {
        if (!Number.isFinite(boxes.left[base + place] ?? Number.NaN)) continue;
        if (placeSide[base + place] !== this.drawnSide[row]) continue;
        if (placeReach[base + place] !== this.reach[row]) continue;
        boxes.at[row] = place;
        break;
      }
      if (held) {
        // Swept along: the place it has, and no other. (With none, it is no candidate at all.)
        const stays = boxes.at[row] ?? NOWHERE;
        if (stays === NOWHERE) continue;
        for (let place = 0; place < PLACES; place += 1) {
          if (place === stays) continue;
          boxes.left[base + place] = Number.NaN;
          boxes.top[base + place] = Number.NaN;
        }
      }

      // Where the ship is going comes first, then whatever the keyboard is on (a name must not
      // vanish from under someone who has tabbed to it, or who is about to be: `beckon`), then
      // systems, planets, moons. Among those, in flight, the nearest the camera first. The map is
      // seen from straight above (every body is as far from the camera) and holds still: there a
      // name that shows goes before one of its rank that waits to (`WAITING`), so that the room
      // stays with whoever has it and nothing is traded back and forth as bodies go round; and
      // between two that both show, or both wait, the nearest the middle of the view, where the
      // visitor is looking.
      const rank =
        row === target ? 0 : row === this.focused || row === this.beckoning ? 0.5 : RANK[kind];
      boxes.priority[row] = onMap
        ? rank * RANK_STEP +
          (this.wasShown[row] ? 0 : WAITING) +
          Math.min(Math.hypot(x - middleX, y - middleY), NEAR_MAX)
        : rank * RANK_STEP + depth;
      // On the map, where it holds still, a name that has just changed lets that change stand a
      // while (sim/declutter.ts: `young`). In flight everything drifts, and names come and go
      // with it.
      boxes.young[row] =
        onMap && this.now - (this.changedAt[row] ?? -Infinity) < params.dwellSec ? 1 : 0;
    }
    declutter(boxes, params, this.taken, onMap ? ON_MAP : IN_FLIGHT);

    for (let row = 0; row < boxes.count; row += 1) {
      const name = this.names[row];
      if (!name) continue;
      const shows = boxes.shown[row] === 1;
      if (shows !== (this.wasShown[row] === 1)) {
        this.wasShown[row] = shows ? 1 : 0;
        this.changedAt[row] = onMap ? this.now : -Infinity;
        if (shows) name.dataset.shown = '';
        else delete name.dataset.shown;
      }
      if (!shows) continue;
      const place = row * PLACES + (boxes.at[row] ?? 0);
      const side = placeSide[place] ?? BELOW;
      const reach = placeReach[place] ?? 0;
      if (side !== this.drawnSide[row] || reach !== this.reach[row]) {
        this.changedAt[row] = onMap ? this.now : -Infinity;
      }
      this.reach[row] = reach;
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
   * On the map: does this row's body circle another so closely, as the map shows them now, that
   * its name has no steady place (`orbitMinPx`)? Never the name of where the ship is going, nor
   * the one the keyboard is on. One that shows stays until the orbit is a keep narrower.
   */
  private tooClose(row: number, x: number, y: number, target: number): boolean {
    const { screen, params, bodies } = this.options;
    const least = params.orbitMinPx;
    const parent = bodies[row]?.parent ?? -1;
    if (!(least > 0) || parent < 0) return false;
    if (row === target || row === this.focused || row === this.beckoning) return false;
    if (!((screen.depth[parent] ?? 0) > 0)) return false;
    const apart = Math.hypot(x - (screen.x[parent] ?? 0), y - (screen.y[parent] ?? 0));
    return apart < least - (this.wasShown[row] === 1 ? params.keepPx : 0);
  }

  /**
   * Is a body at (x, y) on screen, having moved (dx, dy) since the frame before (on screen, or by
   * itself: `ScreenMap.ownX`), on its way out of where names may go, through the edge of it (or
   * the top bar) that it is nearest?
   */
  private leaving(x: number, y: number, dx: number, dy: number): boolean {
    const { room } = this;
    const left = x - room.left;
    const right = room.right - x;
    const top = y - room.top;
    const bottom = room.bottom - y;
    const nearest = Math.min(left, right, top, bottom);
    if (nearest === left) return dx < 0;
    if (nearest === right) return dx > 0;
    if (nearest === top) return dy < 0;
    return dy > 0;
  }

  /**
   * Work out where this row's name may go this frame: its first place, and on the map its others
   * (`offer`), each with what it would lie on (`liesOn`), less those it must not take. How many it
   * has. While `loose` is set, a place needs no room to spare from the edges of the view.
   */
  private placesOf(
    row: number,
    target: number,
    ship: Readonly<ScreenBox> | null,
    onMap: boolean,
    middleX: number,
  ): number {
    const { screen, params, bodies } = this.options;
    const { boxes, placeSide, placeReach } = this;
    const base = row * PLACES;
    boxes.left.fill(Number.NaN, base, base + PLACES);
    boxes.top.fill(Number.NaN, base, base + PLACES);
    boxes.covers.fill(0, base, base + PLACES);
    const radius = screen.radius[row] ?? 0;
    // The box as it is drawn: the target's tag reaches further left, to hold its dot.
    const x = screen.x[row] ?? 0;
    const y = screen.y[row] ?? 0;
    const lead = row === target ? this.lead : 0;
    const centred = x - (this.widths[row] ?? 0) / 2 - lead;
    const width = (this.widths[row] ?? 0) + lead;
    const tag = this.tags[row] ?? 0;
    const height = this.heights[row] ?? 0;
    const kept = row === target || row === this.focused || row === this.beckoning;
    // On the map a name that would cross a screen edge slides away from it, along its body (as
    // far as the body stays over its tag: with room to spare, `slackAt`, unless it is there).
    const slid = onMap
      ? this.along(
          x,
          centred,
          width,
          tag,
          0,
          kept ? 0 : Math.min(this.slackAt(row, BELOW, 0), this.slackAt(row, ABOVE, 0)),
        )
      : Number.NaN;
    const left = Number.isFinite(slid) ? slid : centred;
    // Where the button goes, below its body or above it. Either side the TAG sits offsetPx off
    // the body, at the end of the 44 px box nearest it (its top below, its bottom above: CSS,
    // `data-side`), and the rest of the box, a clear touch target, lies beyond it.
    const under = y + radius + params.offsetPx;
    const over = y - radius - params.offsetPx - height;
    // How far each side's tag would have to glide, away from the body, to clear the ship.
    const down = ship ? glidePast(left, under, width, tag, ship, params.gapPx, 1) : 0;
    const up = ship ? glidePast(left, over + height - tag, width, tag, ship, params.gapPx, -1) : 0;
    const { spot } = this;
    spot.x = x;
    spot.y = y;
    spot.radius = radius;
    spot.centred = centred;
    spot.width = width;
    spot.tag = tag;
    spot.under = under;
    spot.over = over;
    spot.ship = ship;
    let side = onMap ? this.sideOf(row, left, width, under, over, down, up, ship) : BELOW;
    this.prefer[row] = side;
    let top = side ? over - up : under + down;
    let first = true;
    const slack = onMap && !kept ? this.slackAt(row, side, 0) : 0;
    if (!this.fits(row, left, width, top, 0, slack)) {
      // No room past the ship. Where the ship is going, and whatever the keyboard is on, then
      // show where they would have been: on the ship is better than gone.
      if (!kept || (down === 0 && up === 0)) first = false;
      else if (this.fits(row, left, width, under)) [side, top] = [BELOW, under];
      else if (onMap && this.fits(row, left, width, over)) [side, top] = [ABOVE, over];
      else first = false;
    } else if (!kept && (side ? up : down) > this.patienceAt(row, side, 0)) {
      // Any other name glides a little, and makes way for the ship beyond that.
      first = false;
    }
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
      // the nearer screen edge. Last, a system's name off the two corners of its body that way.
      const inward: Reach = x < middleX ? 1 : -1;
      const other = side === ABOVE ? BELOW : ABOVE;
      offered += this.offer(row, 1, other, 0);
      offered += this.offer(row, 2, inward > 0 ? RIGHT : LEFT, 0);
      offered += this.offer(row, 3, inward > 0 ? LEFT : RIGHT, 0);
      offered += this.offer(row, 4, side, inward);
      offered += this.offer(row, 5, side, -inward as Reach);
      offered += this.offer(row, 6, other, inward);
      offered += this.offer(row, 7, other, -inward as Reach);
      if (RANK[bodies[row]?.kind ?? 'moon'] === RANK.sun) {
        offered += this.corner(row, 8, side, inward);
        offered += this.corner(row, 9, other, inward);
      }
      // What each of them would lie on: declutter takes a place that lies on another body only
      // where the name has none that lies on less (sim/declutter.ts, `covers`). A sun or the
      // home planet, the landmarks the map is read by, is no place at all for a planet's name
      // or a moon's; a system's name (or the one where the ship is going, or the keyboard is)
      // would rather lie on one, as a last resort, than go.
      const lastResort = kept || RANK[bodies[row]?.kind ?? 'moon'] === RANK.sun;
      for (let place = 0; place < PLACES; place += 1) {
        const at = base + place;
        const placeLeft = boxes.left[at] ?? Number.NaN;
        if (!Number.isFinite(placeLeft)) continue;
        const placed = placeSide[at] ?? BELOW;
        const here = this.isAt(row, placed, (placeReach[at] ?? 0) as Reach);
        const lies = this.liesOn(row, placeLeft, boxes.top[at] ?? 0, width, placed, here);
        if (lies >= BY_A_LANDMARK && !lastResort) {
          boxes.left[at] = Number.NaN;
          boxes.top[at] = Number.NaN;
          offered -= 1;
        } else {
          boxes.covers[at] = lies;
        }
      }
    }
    boxes.width[row] = width;
    boxes.height[row] = height;
    return offered;
  }

  /**
   * Which side of its body a name would rather be on, on the map: above it (1) or below (0),
   * given how far each side's tag would glide to clear the ship. Below, unless there is no room
   * there (the panel, an edge, something that can be pressed), or the ship is in the way there
   * and clearly less so above. Steady, with a memory of its own (`prefer`): a side keeps its
   * patience with the room it has (a keep closer than the gap), and the name goes back below only
   * once below has room to spare and the ship is a gap and a keep clear of it (or clearly more in
   * the way above), so it never hops back and forth. Where declutter then puts the name is its
   * business: this is only its first place.
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
    const stay = -keepPx;
    if (this.prefer[row]) {
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
    if (!this.fits(row, left, width, top, 0, Math.max(0, slack))) return false;
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
   * only where the ship is a gap clear of the tag. 1 if it is a place (wholly in the free view, with
   * room to spare unless the name is there already, `slackAt`, and the glide no more than this
   * name's patience THERE: `patienceAt`), else 0, and the place is left out (NaN). `spot` says
   * where the name and its body are.
   */
  private offer(row: number, index: number, side: number, reach: Reach): number {
    const place = row * PLACES + index;
    this.placeSide[place] = side;
    this.placeReach[place] = reach;
    const { x, y, radius, centred, width, tag, under, over, ship } = this.spot;
    const { gapPx, offsetPx } = this.options.params;
    const height = this.heights[row] ?? 0;
    const slack = this.slackAt(row, side, reach);
    let left: number;
    let top: number;
    if (side === RIGHT || side === LEFT) {
      left = side === RIGHT ? x + radius + offsetPx : x - radius - offsetPx - width;
      top = y - height / 2;
      if (ship && glidePast(left, y - tag / 2, width, tag, ship, gapPx, 1) > 0) return 0;
      if (!this.fits(row, left, width, top, slack, slack)) return 0;
    } else {
      left = this.along(x, centred, width, tag, reach, slack);
      if (!Number.isFinite(left)) return 0;
      const glide = !ship
        ? 0
        : side === ABOVE
          ? glidePast(left, over + height - tag, width, tag, ship, gapPx, -1)
          : glidePast(left, under, width, tag, ship, gapPx, 1);
      top = side === ABOVE ? over - glide : under + glide;
      if (
        !this.fits(row, left, width, top, 0, slack) ||
        glide > this.patienceAt(row, side, reach)
      ) {
        return 0;
      }
    }
    this.boxes.left[place] = left;
    this.boxes.top[place] = top;
    return 1;
  }

  /**
   * Offer place `index` of a name on the map: off a CORNER of its body, the tag below it or above
   * (`side`, drawn as any tag on that side is) and wholly to one side of it (`way` 1: to the
   * right), the corner of its box nearest the body `offsetPx` off the disc on the diagonal. Only
   * where the ship is a gap clear of the tag, as beside the body, and the place wholly in the free
   * view, with room to spare unless the name is there already (`slackAt`). 1 if it is a place,
   * else 0, and the place is left out (NaN). `spot` says where the name and its body are.
   */
  private corner(row: number, index: number, side: number, way: -1 | 1): number {
    const place = row * PLACES + index;
    const reach = (2 * way) as Reach;
    this.placeSide[place] = side;
    this.placeReach[place] = reach;
    const { x, y, radius, width, tag, ship } = this.spot;
    const { gapPx, offsetPx } = this.options.params;
    const height = this.heights[row] ?? 0;
    const slack = this.slackAt(row, side, reach);
    const off = (radius + offsetPx) * Math.SQRT1_2;
    const left = way > 0 ? x + off : x - off - width;
    const top = side === ABOVE ? y - off - height : y + off;
    const tagTop = side === ABOVE ? top + height - tag : top;
    if (ship && glidePast(left, tagTop, width, tag, ship, gapPx, 1) > 0) return 0;
    if (!this.fits(row, left, width, top, slack, slack)) return 0;
    this.boxes.left[place] = left;
    this.boxes.top[place] = top;
    return 1;
  }

  /**
   * Where a name `width` wide goes along its body at `x`: centred on it (`centred`, reach 0), or
   * reaching all one way from it (1: to the right), the body over the round end of its tag. Slid
   * back into the free view if that would cross a side of it, as long as the body stays over the
   * tag, past its round end (and, slid, `slack` further in); NaN if it cannot.
   */
  private along(
    x: number,
    centred: number,
    width: number,
    tag: number,
    reach: Reach,
    slack = 0,
  ): number {
    const end = tag / 2;
    const wanted = reach === 0 ? centred : reach > 0 ? x - end : x + end - width;
    const min = this.room.left;
    const max = this.room.right - width;
    if (max < min) return Number.NaN;
    const left = Math.min(Math.max(wanted, min), max);
    if (this.rigid && left !== wanted) return Number.NaN;
    // Reaching one way, the body is right over the tag's round end by construction: a hair's
    // tolerance, or rounding would take that place away every other frame. Slid, the body nears
    // the end the tag was slid towards as it nears the edge: that is the end to keep clear of.
    const low = left + end - HAIR_PX + (left > wanted ? slack : 0);
    const high = left + width - end + HAIR_PX - (left < wanted ? slack : 0);
    return x >= low && x <= high ? left : Number.NaN;
  }

  /**
   * How far a name other than the target's or the focused one may glide to clear the ship at one
   * of its places (CSS px): at the place where it shows already, as much closer than the gap as
   * declutter lets a name stay; anywhere else, no further than the gap. Only where it IS: a place
   * open to a name only while it showed would come and go with it, and a name could then hop
   * there and back.
   *
   * But as far as it takes where the ship is AT this body, its marker on the body's own disc (or
   * within `offsetPx` of it): parked beside the home planet, where a first visit starts, on a
   * phone's map. The marker is then part of what the name names, and past the two of them is the
   * name's own place, below or above; with a gap's patience it had none there, and stood beside
   * its planet or off a corner of it instead, in the row its neighbours' names need. (A galaxy of
   * six on a 360 px phone, over a whole turn: without this, 0.29 tags a look lay on another
   * system's sun, and Software went unnamed for 18.9% of the turn and About Me for 10.5%; with
   * it, no tag on a sun and no system unnamed. tests/map-names/.) `spot` says where the body and
   * the ship are.
   */
  private patienceAt(row: number, side: number, reach: Reach): number {
    const { gapPx, keepPx, offsetPx } = this.options.params;
    const { x, y, radius, ship } = this.spot;
    if (ship) {
      const within = radius + offsetPx;
      const dx = x - Math.min(Math.max(x, ship.left), ship.left + ship.width);
      const dy = y - Math.min(Math.max(y, ship.top), ship.top + ship.height);
      if (dx * dx + dy * dy < within * within) return Infinity;
    }
    return this.isAt(row, side, reach) ? gapPx + keepPx : gapPx;
  }

  /**
   * How much more room than it needs a name must have at one of its places to take it, on the
   * map (CSS px): none where it shows already, and anywhere else `keepPx`, as declutter asks of a
   * name next to another. Its edges are the view's (and the top bar's), and, for a name slid along
   * its body, the round end of its tag. So a name whose body drifts past an edge by a pixel does
   * not come and go with it. None either for a name that has no place with it (`loose`).
   */
  private slackAt(row: number, side: number, reach: Reach): number {
    return this.loose || this.isAt(row, side, reach) ? 0 : this.options.params.keepPx;
  }

  /** Does this row's name show, on `side` of its body and reaching `reach` along it? */
  private isAt(row: number, side: number, reach: Reach): boolean {
    return this.wasShown[row] === 1 && this.drawnSide[row] === side && this.reach[row] === reach;
  }

  /**
   * What a name's tag, its box at (left, top) on `side` of its body, would lie on, on the map:
   * the disc of a sun or the home planet not its own (`ON_A_LANDMARK`, or within the gap off it,
   * `BY_A_LANDMARK`), of any other body that can be seen, or BESIDE one (`ON_A_BODY`), or nothing
   * (`CLEAR`). A disc counts from a gap off it (`gapPx`), further than the name's own body is from
   * its tag (`offsetPx`), so that its own body is always plainly the nearest. Beside: the body
   * level with the tag, less than the tag's height off one of its ends, where the tag reads as
   * that body's name ("SOFTWARE ( ) HARDWARE"). Where the name is already (`here`) only the disc
   * itself counts, and a body beside it a keep nearer, so that a body drifting past by a pixel
   * does not send the name back and forth. The tag is the visible part of the 44 px box: at its
   * top below the body, at its bottom above it, in the middle beside it (CSS, `data-side`).
   */
  private liesOn(
    row: number,
    left: number,
    top: number,
    width: number,
    side: number,
    here: boolean,
  ): number {
    const { screen, params, bodies } = this.options;
    const height = this.heights[row] ?? 0;
    const tag = this.tags[row] ?? height;
    const tagTop =
      side === BELOW ? top : side === ABOVE ? top + height - tag : top + (height - tag) / 2;
    const right = left + width;
    const bottom = tagTop + tag;
    const near = here ? 0 : params.gapPx;
    const beside = here ? tag - params.keepPx : tag;
    let lies = CLEAR;
    for (let other = 0; other < this.boxes.count; other += 1) {
      const radius = screen.radius[other] ?? 0;
      if (other === row || !((screen.depth[other] ?? 0) > 0) || radius < params.minVisiblePx) {
        continue;
      }
      // The nearest point of the tag to the body's centre, and how far that is from its disc.
      const x = screen.x[other] ?? 0;
      const y = screen.y[other] ?? 0;
      const dx = x - Math.min(Math.max(x, left), right);
      const dy = y - Math.min(Math.max(y, tagTop), bottom);
      const reach = radius + near;
      const apart = dx * dx + dy * dy;
      if (apart < reach * reach) {
        if (RANK[bodies[other]?.kind ?? 'moon'] !== RANK.sun) lies = Math.max(lies, ON_A_BODY);
        else if (apart < radius * radius) return ON_A_LANDMARK;
        else lies = BY_A_LANDMARK;
      } else if (dy === 0 && Math.abs(dx) - radius < beside) {
        lies = Math.max(lies, ON_A_BODY);
      }
    }
    return lies;
  }

  /**
   * Would this row's name, put here, be wholly in the free view, clear of its edges (and `across`
   * more from its sides, `upDown` more from its top and bottom)?
   */
  private fits(
    row: number,
    left: number,
    width: number,
    top: number,
    across = 0,
    upDown = 0,
  ): boolean {
    const { room } = this;
    return (
      left >= room.left + across &&
      left + width <= room.right - across &&
      top >= room.top + upDown &&
      top + (this.heights[row] ?? 0) <= room.bottom - upDown
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
