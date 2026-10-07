import { boxOf, flag, html, put, svg } from '../core/dom';
import type { Frame, System } from '../core/Engine';
import type { BodyKind } from '../data/types';
import type { ThemeKey } from '../design/tokens';
import type { ScreenBox } from '../sim/declutter';
import { bearingOf, etaShown, rangeShown, type MiniSystem } from '../sim/instruments';
import { clamp } from '../sim/math';
import {
  displayScales,
  fitView,
  pointOn,
  unitsPerPx,
  type MapBodies,
  type MapBounds,
  type MapView,
} from '../sim/mapView';
import {
  GALAXY,
  PIN_DEPTH,
  glyphPath,
  markDepth,
  miniBounds,
  miniScope,
  pickMini,
  pinNear,
  projectMini,
  routePoints,
  type MiniBodies,
  type MiniMapParams,
} from '../sim/minimap';
import type { Path } from '../sim/path';
import {
  createScreenMap,
  isTap,
  type PickParams,
  type ScreenMap,
  type TapParams,
} from '../sim/screen';
import { createSpring, snapSpring, stepSpring } from '../sim/spring';
import { plannedNote } from './planned';

/** A system as the minimap needs it (the manifest's own fit). */
export interface MiniMapSystem extends MiniSystem {
  readonly id: string;
  readonly name: string;
  readonly theme: ThemeKey;
  /** Id of the body at its heart: the mark that stands for the system when it is off the face. */
  readonly center: string;
}

/** A body, by row of the orbit table. */
export interface MiniMapBody {
  readonly id: string;
  readonly title: string;
  readonly kind: BodyKind;
  readonly planned: boolean;
  /** Its colour family (manifest.ts, `familiesOf`). */
  readonly theme?: ThemeKey | undefined;
  /** Index of its system, or -1. */
  readonly system: number;
}

/** A journey under way, as the autopilot keeps it (sim/autopilot.ts, `CruiseState`). */
export interface MiniJourney {
  readonly path: Readonly<Path>;
  /** The piece of the path the ship is on: from sample `index` to the next. */
  readonly index: number;
  /** Seconds the journey still takes, as of the last plan. */
  readonly etaSec: number;
}

export interface MiniMapOptions {
  /** Where the engine's own DOM goes. The minimap is a picture there: hidden from assistive tech. */
  overlay: HTMLElement;
  systems: readonly MiniMapSystem[];
  bodies: readonly MiniMapBody[];
  /** The orbit table's own columns, by row: what each body circles, how far out, and round where. */
  orbits: {
    readonly parent: ArrayLike<number>;
    readonly radius: ArrayLike<number>;
    readonly centerX: ArrayLike<number>;
    readonly centerZ: ArrayLike<number>;
  };
  /** By row: how far out each body is drawn (world units), and whether a ship may dock at it (0: no). */
  radii: ArrayLike<number>;
  docks: ArrayLike<number>;
  /** Where every body is this frame: [x0, z0, x1, z1, ...], by row. */
  positions: Float64Array;
  /** Everything there is to see (sim/mapView.ts, `boundsOf`). */
  bounds: MapBounds;
  ship: { readonly position: { readonly x: number; readonly z: number }; readonly heading: number };
  /** The index of the system the ship is in, or -1 between systems. */
  at(): number;
  /** Row of the body the ship is at or is headed for, or -1. It cannot be picked: it is "here". */
  target(): number;
  /** The journey the autopilot is flying there, once it has planned it; null without one. */
  journey(): MiniJourney | null;
  /** Has the view room for it? (Where the deck has its full size: ui/FlightDeck.ts, `full`.) */
  room(): boolean;
  mapOpen(): boolean;
  /** The visitor pointed at the body in this row: the canvas's own call (main.ts, `pickRow`). */
  onPick(row: number): void;
  /** The visitor pressed the instrument where nothing is: open the star map. */
  onMap(): void;
  params: MiniMapParams;
  /** A mouse's and a finger's reach, and what counts as a tap (tuning.picking). */
  picking: TapParams & { readonly mouse: PickParams; readonly touch: PickParams };
  reducedMotion: boolean;
}

/** px. The face where nothing can be measured (no layout: a unit test): its smallest. */
const SIZE = 120;
/** px. The ring round the mark a pointer aims at stands this far off it... */
const AIM_GAP = 2.5;
/** ...and the ring round the body the ship is at or headed for, this far (2 px wide, 3 px off). */
const HERE_GAP = 4;
/** px. The middle of the N is this far below the top of the face (the pins' own circle, nearly)... */
const NORTH = 10;
/**
 * ...and it gives way to a system's pin whose middle is nearer to it than this: side by side, an
 * outlined glyph and a letter of the same height read as one sign of two. (9 px of letter, 10 of
 * pin: at 24 px there are 14 px of face between them.)
 */
const NORTH_CLEAR = 24;
/** The ship's chevron, 10 units from tip to tail, its nose up. */
const SHIP = 'M0-5.5 4 4.5 0 2.5-4 4.5Z';

/** A view is three numbers, and they ease as one. */
const VIEW = ['x', 'z', 'span'] as const;

/** To a tenth: finer than a screen shows, and coarse enough that a map at rest writes nothing. */
const round = (value: number): number => Math.round(value * 10) / 10;

/**
 * A circle about the middle of its drawing that no script places again: its radius in percent
 * of the drawing's width, and how many units its outline counts, which the stylesheet dashes it
 * by (the dots of the range rings, the part of a journey that is left).
 */
function loop(className: string, parent: Element, radius: string, units: string): SVGElement {
  const node = svg('circle', className, parent);
  node.setAttribute('cx', '50%');
  node.setAttribute('cy', '50%');
  node.setAttribute('r', radius);
  node.setAttribute('pathLength', units);
  return node;
}

/**
 * THE MINIMAP (sim/minimap.ts has the maths): the star map at another size, at the bottom right
 * of the view, built as the flight deck's ball is (ui/FlightDeck.ts): a SCOPE. A round PLATE with
 * a round FACE on it, a PILL fastened over its top and a CHIP under its bottom. The face looks at
 * the whole galaxy, or at the system the ship is in, north up; nobody pans or zooms it. Every
 * body a ship can dock at that has room at that scale is a mark (a sun and the home planet as
 * their family's glyph, the rest as discs), every other system is a pin on a circle just inside
 * the rim, and the ship is a chevron. Under the marks, and never moved: two rings of dots, a
 * third and two thirds of the way out, and an N at the top, which gives way to a pin that stands
 * beside it (a system due north of the one the face shows).
 *
 * THE PILL NAMES, THE CHIP MEASURES. The pill says what the face shows (the galaxy, a system), or
 * names a body: the one a pointer aims at, else the one a journey is headed for. The chip says
 * how far the face reaches from its middle (RANGE: `rangeShown`), or on a journey the seconds it
 * still takes (ETA).
 *
 * ONE GESTURE FOR EVERY POINTER. Down, or a move, AIMS: the mark gets a ring and the pill names
 * it. Up on an aimed mark is `onPick(row)`, the very call the canvas makes for a planet pointed
 * at; a tap where nothing is (on the face, the plate's band, the pill or the chip) opens the star
 * map (`onMap`), of which this is the preview; a drag that ends on nothing does nothing. The
 * corners of its box are the world's (the stylesheet's doing). The wheel is not touched: it
 * reaches the overlay, where scrolling out opens the map already (ui/StarMap.ts).
 *
 * A JOURNEY READS AS FAST FORWARD HERE. The body the ship is at or headed for wears a butter
 * ring ("here"); while the autopilot flies, the way that is left is a butter line from the ship
 * to that ring, the pill names the destination, and the chip counts the seconds down (`etaShown`:
 * never up, though the autopilot plans again twice a second). And THE RIM IS THE JOURNEY'S CLOCK:
 * a butter ring on it, whole when the journey starts, that a gap eats clockwise from twelve.
 *
 * IT IS A PICTURE of what real controls offer (the names in the sky, the Map button), so it is
 * `aria-hidden`, with nothing to focus: the canvas's own picking has no other standing either.
 * How it looks is all in the stylesheet (`.minimap` in src/styles/global.css), told by:
 *
 *   hidden        no room for it (it is only there beside the deck at full size)
 *   data-shown    the star map is closed: it fades in and out by this
 *   data-scope    galaxy, or the id of the system it is fitted to
 *   data-pick     a pointer aims at a mark (the cursor says so)
 *   on a mark     data-id, data-kind, data-theme, data-planned; data-pin at the rim; data-off
 *   the N         data-off (a pin stands beside it)
 *   the pill      data-theme (the family of what it names); data-lit (it names a body)
 *   the chip      data-eta (it counts a journey's seconds)
 *   the clock     data-off (no journey); --gone, how much of the way round has run (0 to 1)
 *
 * A pointer is measured against where the instrument RESTS: pressed, all of it drops onto the
 * plate's ledge, and what was aimed at must not slip from under the pointer for it.
 *
 * The ship is put in place every frame, the marks `bodiesHz` times a second (or every frame
 * while the view eases to another scope), and nothing at all while it does not show.
 */
export class MiniMap implements System {
  private readonly root: HTMLDivElement;
  private readonly map: SVGElement;
  /** By row: the mark of a body a ship can dock at, or null. */
  private readonly marks: (SVGElement | null)[];
  /** The circle each of them travels on. */
  private readonly paths: { readonly node: SVGElement; readonly row: number }[] = [];
  private readonly ship: SVGElement;
  private readonly north: SVGElement;
  private readonly aim: SVGElement;
  /** The ring round the body the ship is at or headed for, and the way there that is left. */
  private readonly here: SVGElement;
  private readonly route: SVGElement;
  /** The rim as a journey's clock: the part of the ring that is left of it. */
  private readonly left: SVGElement;
  /** The pill over the plate: a glyph, a name (and "Planned" after planned work). */
  private readonly pill: HTMLElement;
  private readonly label: HTMLElement;
  private readonly name = document.createTextNode('');
  private readonly note = plannedNote('minimap');
  /** The chip under the plate: a word (RANGE, ETA), its figures, their unit. */
  private readonly chip: HTMLElement;
  private readonly word: HTMLElement;
  private readonly figures: HTMLElement;
  private readonly unit: HTMLElement;

  private readonly screen: ScreenMap;
  private readonly scales: Float64Array;
  private readonly smallest: Float64Array;
  private readonly sized: MapBodies;
  private readonly marked: MiniBodies;
  private readonly frame = { width: SIZE, height: SIZE };
  private readonly seen = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  private readonly want: MapView = { x: 0, z: 0, span: 1 };
  private readonly eased = { x: createSpring(), z: createSpring(), span: createSpring(1) };
  /** The view the marks were last put in place by: the ship is drawn in it too. */
  private readonly view: MapView = { x: 0, z: 0, span: 1 };
  private readonly at = new Float64Array(2);
  private readonly area: ScreenBox = { left: 0, top: 0, width: 0, height: 0 };
  /** Scratch: the points of a journey's line, in world units (`routePoints`). */
  private readonly way: Float64Array;

  private scope = GALAXY;
  /** The row the ring is round, and the row a journey is headed for (-1: none under way). */
  private target = -1;
  private goal = -1;
  /** The seconds the chip counts down, those the journey began with, and the line as last written. */
  private eta = Infinity;
  private whole = Infinity;
  private line = '';
  /** Does it show, as of the last frame? And was it drawn then (else the view starts afresh)? */
  private shows = false;
  private awake = false;
  private placedAt = -Infinity;
  /** What the pill and the chip last said, and where the ship was last drawn: only written anew. */
  private said = '';
  private shipX = Number.NaN;
  private shipY = Number.NaN;
  private shipTurn = Number.NaN;
  /** Where the face is in the instrument's own box (px from its top left corner). */
  private inX = 0;
  private inY = 0;
  /** The pointer over the plate, from the face's top left corner; a finger only while it is down. */
  private over = false;
  private coarse = false;
  private px = 0;
  private py = 0;
  private aimed = -1;
  private press: { id: number; x: number; y: number; at: number } | null = null;

  constructor(private readonly options: MiniMapOptions) {
    const { bodies, systems, orbits, radii, docks } = options;
    const count = bodies.length;
    const root = (this.root = document.createElement('div'));
    root.className = 'minimap';
    root.setAttribute('aria-hidden', 'true');
    root.hidden = true;
    // Above the plate, the pill: what the scope shows, or the name of a body.
    this.pill = html('span', 'minimap__name', root);
    html('i', '', this.pill);
    this.label = html('b', '', this.pill);
    this.label.append(this.name);
    // The plate (its ticks are the stylesheet's own doing), and the face on it. Under everything
    // on the face, the range rings (two rings of dots) and north.
    const plate = html('span', 'minimap__plate', root);
    const map = (this.map = svg('svg', 'minimap__map', plate));
    loop('minimap__dots', map, '16.67%', '12');
    loop('minimap__dots', map, '33.33%', '24');
    const north = (this.north = svg('text', 'minimap__north', map));
    north.setAttribute('x', '50%');
    north.setAttribute('y', `${NORTH}`);
    north.setAttribute('dy', '0.35em');
    north.textContent = 'N';

    const depth = bodies.map((body, row) => (docks[row] === 0 ? 0 : markDepth(body.kind)));
    // The circles first, under every mark, and a journey's line over them; then the marks, the
    // smaller kinds last: where two lie on each other the smaller is on top, as it is to a
    // pointer (sim/minimap.ts, `markDepth`).
    const lines = svg('g', '', map);
    this.route = svg('polyline', 'minimap__route', map);
    this.way = new Float64Array(2 * options.params.routePoints);
    this.marks = bodies.map(() => null);
    const drawn = new Set<string>();
    for (const row of bodies.map((_, i) => i).sort((a, b) => (depth[b] ?? 0) - (depth[a] ?? 0))) {
      const body = bodies[row];
      if (!body || !depth[row]) continue;
      // A sun and the home planet are their family's glyph; everything else is a disc.
      const mark = svg((depth[row] ?? 0) > 2 ? 'path' : 'circle', 'minimap__mark', map);
      mark.dataset.id = body.id;
      mark.dataset.kind = body.kind;
      if (body.theme) mark.dataset.theme = body.theme;
      flag(mark, 'data-planned', body.planned);
      flag(mark, 'data-off', true);
      this.marks[row] = mark;
      // One circle for each path: bodies that share one (the two suns of a binary whose families
      // reach as far) share its line.
      const path = `${body.system} ${orbits.parent[row]} ${orbits.radius[row]}`;
      if (!((orbits.radius[row] ?? 0) > 0) || drawn.has(path)) continue;
      drawn.add(path);
      const line = svg('circle', 'minimap__orbit', lines);
      if (body.theme) line.dataset.theme = body.theme;
      flag(line, 'data-off', true);
      this.paths.push({ node: line, row });
    }
    this.left = loop('minimap__left', map, '49.3%', '1');
    this.here = svg('circle', 'minimap__here', map);
    this.aim = svg('circle', 'minimap__aim', map);
    for (const ring of [this.left, this.here, this.aim]) flag(ring, 'data-off', true);
    this.ship = svg('path', 'minimap__ship', map);
    this.ship.setAttribute('d', SHIP);

    this.chip = html('span', 'minimap__range', root);
    this.word = html('small', '', this.chip);
    this.figures = html('b', '', this.chip);
    this.unit = html('small', '', this.chip);

    this.screen = createScreenMap(count);
    this.scales = new Float64Array(count);
    this.smallest = new Float64Array(count);
    this.sized = {
      count,
      parent: orbits.parent,
      orbitRadius: orbits.radius,
      radius: radii,
      minRadiusPx: this.smallest,
    };
    this.marked = {
      count,
      radius: radii,
      depth,
      centers: systems.map(({ center }) => bodies.findIndex(({ id }) => id === center)),
    };

    root.addEventListener('pointerdown', this.onDown);
    root.addEventListener('pointermove', this.onMove);
    root.addEventListener('pointerup', this.onUp);
    root.addEventListener('pointercancel', this.letGo);
    root.addEventListener('pointerleave', this.onLeave);
    // Last in the overlay: nothing in it takes the focus, so the order of what does is unchanged.
    options.overlay.append(root);
  }

  frameUpdate(frame: Frame): void {
    const { options, root, view } = this;
    const { params, ship } = options;
    const shown = !options.mapOpen();
    flag(root, 'data-shown', shown);
    const room = options.room();
    if (root.hidden === room) {
      root.hidden = !room;
      this.shape();
    }
    this.shows = shown && room;
    if (!this.shows) {
      // (Whatever journey is under way when it is back counts down afresh, and its clock is whole
      // again at the seconds that are left. So it is in an engine built again from its snapshot
      // in the middle of a journey, which keeps neither: the seconds a journey began with are
      // this picture's own way of telling it, not state anybody else reads.)
      this.awake = false;
      this.goal = -1;
      return;
    }

    // What it looks at: the system the ship is in, unless it is headed out of it; else the galaxy.
    const { x, z } = ship.position;
    const target = options.target();
    const scope = miniScope(options.at(), options.bodies[target]?.system ?? -1);
    if (scope !== this.scope || !this.awake) {
      this.scope = scope;
      root.dataset.scope = options.systems[scope]?.id ?? 'galaxy';
    }
    fitView(
      miniBounds(scope, options.systems, options.bounds, x, z, this.seen),
      this.frame,
      params,
      this.want,
    );
    // Back in view, or asked for less motion: it is there. Else it eases, all three as one view.
    const cut = !this.awake || options.reducedMotion;
    let moved = 0;
    for (const key of VIEW) {
      const spring = this.eased[key];
      if (cut) snapSpring(spring, this.want[key]);
      else stepSpring(spring, this.want[key], params.viewOmega, frame.dt);
      moved += Math.abs(spring.value - view[key]);
    }
    // A journey: where to, and the seconds left of it. They count down from the first plan of each
    // journey, and never up (the autopilot plans again twice a second).
    const journey = options.journey();
    const goal = journey ? target : -1;
    const eta = journey
      ? etaShown(goal === this.goal ? this.eta : Infinity, journey.etaSec)
      : Infinity;
    const news = goal !== this.goal || eta !== this.eta;
    if (news) {
      // THE RIM IS THE JOURNEY'S CLOCK: whole at the seconds a journey begins with, and gone by
      // the share of them that has run (`--gone`, 0 to 1: the stylesheet opens that much of a
      // gap in the ring). Written with the seconds, as where it will be when the chip counts
      // one less: the stylesheet glides it there, and under reduced motion, where nothing
      // glides, it shows the seconds as they stand. Put away, the stylesheet winds it up again.
      if (goal !== this.goal || !(this.whole < Infinity)) this.whole = eta;
      const lead = options.reducedMotion ? 0 : 1;
      const gone = eta < Infinity ? clamp(1 - (eta - lead) / Math.max(1, this.whole), 0, 1) : 0;
      flag(this.left, 'data-off', goal < 0);
      this.left.style.setProperty('--gone', `${Math.round(gone * 1000) / 1000}`);
    }
    this.goal = goal;
    this.eta = eta;

    // The marks: now and then, at once for a new target, or with every frame while the view is on
    // its way (a tenth of a px).
    if (
      !this.awake ||
      target !== this.target ||
      frame.elapsed - this.placedAt >= 1 / params.bodiesHz ||
      moved > unitsPerPx(view.span, this.frame) / 10
    ) {
      this.awake = true;
      this.target = target;
      this.placedAt = frame.elapsed;
      for (const key of VIEW) view[key] = this.eased[key].value;
      this.place();
    } else if (news) this.point();

    // The ship: every frame, in the view the marks are in. North is up, so its bearing is its turn.
    const at = pointOn(view, x, z, this.frame, this.at);
    const half = this.frame.width / 2;
    const shipX = round(half + (at[0] ?? 0));
    const shipY = round(half + (at[1] ?? 0));
    const turn = Math.round(bearingOf(ship.heading));
    if (shipX !== this.shipX || shipY !== this.shipY || turn !== this.shipTurn) {
      this.shipX = shipX;
      this.shipY = shipY;
      this.shipTurn = turn;
      this.ship.setAttribute(
        'transform',
        `translate(${shipX} ${shipY})rotate(${turn})scale(${params.shipPx / 10})`,
      );
    }

    // The way that is left of a journey: from the ship, along the autopilot's own path, to its end.
    let line = '';
    if (journey) {
      const count = routePoints(journey.path, journey.index, params.routePoints, this.way);
      // (The first of them is the sample the ship has passed: the ship itself stands in for it.)
      for (let k = 1; k < count; k += 1) {
        const on = pointOn(view, this.way[2 * k] ?? 0, this.way[2 * k + 1] ?? 0, this.frame, at);
        line += ` ${round(half + (on[0] ?? 0))},${round(half + (on[1] ?? 0))}`;
      }
      if (line) line = `${shipX},${shipY}${line}`;
    }
    if (line === this.line) return;
    this.line = line;
    this.route.setAttribute('points', line);
  }

  /** The viewport changed: the plate is sized by its height (`--minimap-size`), and the face by it. */
  resize(): void {
    this.shape();
  }

  /**
   * Where the minimap is on the page, or null while it does not show: names keep off it. Its box,
   * and with it the two ends of a pill that reaches past the plate, as the pill of a long name
   * may by a rem on either side (the stylesheet centres it on the plate): no name lies under them.
   */
  box(): Readonly<ScreenBox> | null {
    const box = this.shows ? boxOf(this.root, this.area) : null;
    const past = box ? (this.pill.offsetWidth - box.width) / 2 : 0;
    if (box && past > 0) {
      box.left -= past;
      box.width += 2 * past;
    }
    return box;
  }

  dispose(): void {
    this.root.remove();
  }

  /**
   * The face is as big as the stylesheet makes it, and lies where the stylesheet puts it in the
   * instrument's box (under the pill, inside the plate's band): draw to that size, so that one
   * unit of the drawing is one CSS px, and note that place for the pointer. Reads layout, so
   * only where either can have changed.
   */
  private shape(): void {
    if (this.root.hidden) return;
    const face = this.map.getBoundingClientRect();
    const box = this.root.getBoundingClientRect();
    this.inX = face.left - box.left;
    this.inY = face.top - box.top;
    const size = round(face.width) || SIZE;
    if (size === this.frame.width && this.map.hasAttribute('viewBox')) return;
    this.frame.width = this.frame.height = size;
    this.map.setAttribute('viewBox', `0 0 ${size} ${size}`);
    // Everything is put in place again with the next frame, at once.
    this.awake = false;
  }

  /** Put every mark, and the circle it travels on, where it is in `view`. */
  private place(): void {
    const { options, screen, frame, view } = this;
    const { params, bodies, orbits, positions } = options;
    const perPx = unitsPerPx(view.span, frame);
    // Read on every pass, so that the dev panel's sliders work on it live.
    const sizes = this.scope === GALAXY ? params.minRadiusPx.galaxy : params.minRadiusPx.system;
    bodies.forEach((body, row) => (this.smallest[row] = sizes[body.kind]));
    displayScales(this.sized, perPx, 1, params, this.scales);
    projectMini(view, frame, positions, this.marked, this.scales, params, screen);
    const half = frame.width / 2;
    // North gives way to a pin that stands beside it: the two would read as one sign.
    flag(this.north, 'data-off', pinNear(screen, half, NORTH, NORTH_CLEAR));

    this.marks.forEach((mark, row) => {
      const depth = screen.depth[row] ?? 0;
      if (!mark) return;
      // A mark that is no longer drawn stays where it was, and fades (the stylesheet's doing).
      flag(mark, 'data-off', depth === 0);
      if (depth === 0) return;
      flag(mark, 'data-pin', depth === PIN_DEPTH);
      put(
        mark,
        'transform',
        `translate(${round(screen.x[row] ?? 0)} ${round(screen.y[row] ?? 0)})`,
      );
      const radius = round(screen.radius[row] ?? 0);
      const theme = bodies[row]?.theme;
      if (mark.tagName !== 'path') put(mark, 'r', `${radius}`);
      else if (theme) put(mark, 'd', glyphPath(theme, radius));
    });
    for (const { node, row } of this.paths) {
      const parent = orbits.parent[row] ?? -1;
      // Round its parent where that is drawn in its place, or round the middle of its system.
      const shown =
        (screen.depth[row] ?? 0) > 0 &&
        screen.depth[row] !== PIN_DEPTH &&
        screen.depth[parent] !== PIN_DEPTH;
      flag(node, 'data-off', !shown);
      if (!shown) continue;
      const at = pointOn(view, orbits.centerX[row] ?? 0, orbits.centerZ[row] ?? 0, frame, this.at);
      put(node, 'cx', `${round(parent < 0 ? half + (at[0] ?? 0) : (screen.x[parent] ?? 0))}`);
      put(node, 'cy', `${round(parent < 0 ? half + (at[1] ?? 0) : (screen.y[parent] ?? 0))}`);
      put(node, 'r', `${round((orbits.radius[row] ?? 0) / perPx)}`);
    }
    // "Here": round the body the ship is at or headed for, whatever this scale draws of it.
    this.ring(this.here, this.target, HERE_GAP);
    // The marks have moved under a pointer at rest: what it aims at may be another now.
    this.point();
  }

  /** Put `ring` round the mark of `row`, `gap` px off it; or away, for no row. */
  private ring(ring: SVGElement, row: number, gap: number): void {
    const { screen } = this;
    flag(ring, 'data-off', row < 0);
    if (row < 0) return;
    put(ring, 'cx', `${round(screen.x[row] ?? 0)}`);
    put(ring, 'cy', `${round(screen.y[row] ?? 0)}`);
    put(ring, 'r', `${round((screen.radius[row] ?? 0) + gap)}`);
  }

  /** The row of the mark under the pointer, leaving out row `ignore`; -1 for none. */
  private hit(ignore: number): number {
    const { options, px, py, coarse } = this;
    const { picking } = options;
    // (The plate reaches as far beyond the face as the face lies inside the instrument's box: a
    // finger on the plate beside a pin means the pin.)
    const edge = this.inX;
    const size = this.frame.width + edge;
    if (!this.over || px < -edge || py < -edge || px > size || py > size) return -1;
    const reach = coarse ? picking.touch : picking.mouse;
    return pickMini(this.screen, px, py, reach, coarse, options.params.ambiguityPx, ignore);
  }

  /** Which mark does the pointer aim at? Ring it, and say on the pill and the chip what matters now. */
  private point(): void {
    const { options } = this;
    const { bodies, systems } = options;
    // Never the body the ship is at, or is headed for: that one is "here".
    const row = this.hit(options.target());
    this.aimed = row;
    flag(this.root, 'data-pick', row >= 0);
    this.ring(this.aim, row, AIM_GAP);

    // The pill: the body aimed at, in its family; else where a journey is headed; else what
    // the scope is fitted to. The chip: the seconds that journey still takes; else how far the
    // face reaches from its middle, which is half of what the view spans.
    const body = bodies[row < 0 ? this.goal : row];
    const system = systems[this.scope];
    const text = body ? body.title : system ? system.name : 'Galaxy';
    const theme = body ? body.theme : system?.theme;
    const planned = body?.planned === true;
    const counting = Boolean(body) && row < 0 && this.eta < Infinity;
    // (Of the view it is HEADED for, not of the one easing there: the figure changes once when the
    // scope does, and holds still while the face closes in.)
    const [figures, unit] = counting ? [`${this.eta}`, 's'] : rangeShown(this.want.span / 2);
    const say = `${text} ${theme} ${planned} ${row} ${figures}${unit}`;
    if (say === this.said) return;
    this.said = say;
    this.name.data = text;
    this.word.textContent = counting ? 'ETA' : 'RANGE';
    this.figures.textContent = figures;
    this.unit.textContent = unit;
    flag(this.chip, 'data-eta', counting);
    if (theme) this.pill.dataset.theme = theme;
    else delete this.pill.dataset.theme;
    flag(this.pill, 'data-lit', Boolean(body));
    // "Planned" stands after the name, in a box of its own: a long name gives way, it does not.
    if (planned) this.label.after(this.note);
    else this.note.remove();
  }

  /**
   * The pointer is at this point of the window: aim from there, in px from the face's top left
   * corner. Measured against where the instrument RESTS: its place in the layout, whatever moves
   * it for the moment (its arrival, the drop of a pressed plate), and asked each time, since the
   * overlay's edge moves with the page's panel. (Where the face lies in it is `shape`'s to say.)
   */
  private follow(event: PointerEvent): void {
    const { root } = this;
    const box = this.options.overlay.getBoundingClientRect();
    this.over = true;
    this.coarse = event.pointerType === 'touch';
    this.px = event.clientX - box.left - root.offsetLeft - this.inX;
    this.py = event.clientY - box.top - root.offsetTop - this.inY;
    this.point();
  }

  private readonly onDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.press = { id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp };
    try {
      // The rest of the press is the map's, wherever it goes: it ends here, on a mark or on none.
      this.root.setPointerCapture?.(event.pointerId);
    } catch {
      // Already up (a synthetic event, or a race with the browser): nothing left to follow.
    }
    this.follow(event);
  };

  private readonly onMove = (event: PointerEvent): void => {
    // A mouse aims wherever it is; a finger, a pen, only while it is down.
    if (event.pointerType === 'mouse' || this.press?.id === event.pointerId) this.follow(event);
  };

  private readonly onUp = (event: PointerEvent): void => {
    const { press, options } = this;
    if (press?.id !== event.pointerId) return;
    this.press = null;
    this.follow(event);
    const row = this.aimed;
    // Nothing there at all? (On the mark of where the ship is, a press does nothing.)
    const sky = row < 0 && this.hit(-1) < 0;
    // A finger that has lifted aims at nothing any more.
    if (event.pointerType !== 'mouse') this.letGo();
    const seconds = (event.timeStamp - press.at) / 1000;
    if (row >= 0) options.onPick(row);
    else if (sky && isTap(press.x, press.y, event.clientX, event.clientY, seconds, options.picking))
      options.onMap();
  };

  private readonly onLeave = (): void => {
    // (A press that began here is still the map's, wherever the pointer has got to.)
    if (!this.press) this.letGo();
  };

  private readonly letGo = (): void => {
    this.press = null;
    this.over = false;
    this.point();
  };
}
