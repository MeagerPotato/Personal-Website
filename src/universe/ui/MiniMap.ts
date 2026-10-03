import { boxOf, flag, html, put, svg } from '../core/dom';
import type { Frame, System } from '../core/Engine';
import type { BodyKind } from '../data/types';
import type { ThemeKey } from '../design/tokens';
import type { ScreenBox } from '../sim/declutter';
import { bearingOf, type MiniSystem } from '../sim/instruments';
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
  projectMini,
  type MiniBodies,
  type MiniMapParams,
} from '../sim/minimap';
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
  /** Id of the body at its heart: the mark that stands for the system when it is off the frame. */
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
  /** Has the view room for it? (Where the deck has its full size: ui/FlightDeck.ts, `full`.) */
  room(): boolean;
  mapOpen(): boolean;
  /** The visitor pointed at the body in this row: the canvas's own call (main.ts, `pickRow`). */
  onPick(row: number): void;
  /** The visitor pressed the plate where nothing is: open the star map. */
  onMap(): void;
  params: MiniMapParams;
  /** A mouse's and a finger's reach, and what counts as a tap (tuning.picking). */
  picking: TapParams & { readonly mouse: PickParams; readonly touch: PickParams };
  reducedMotion: boolean;
}

/** px. The map where nothing can be measured (no layout: a unit test): its smallest, less its rim. */
const SIZE = 130;
/** px. The ring round the mark a pointer aims at stands this far off it. */
const AIM_GAP = 2.5;
/** The ship's chevron, 10 units from tip to tail, its nose up. */
const SHIP = 'M0-5.5 4 4.5 0 2.5-4 4.5Z';

/** A view is three numbers, and they ease as one. */
const VIEW = ['x', 'z', 'span'] as const;

/** To a tenth: finer than a screen shows, and coarse enough that a map at rest writes nothing. */
const round = (value: number): number => Math.round(value * 10) / 10;

/**
 * THE MINIMAP (sim/minimap.ts has the maths): the star map at another size, at the bottom right
 * of the view. It looks at the whole galaxy, or at the system the ship is in, north up; nobody
 * pans or zooms it. Every body a ship can dock at that has room at that scale is a mark (a sun
 * and the home planet as their family's glyph, the rest as discs), every other system is a pin
 * at the rim, and the ship is a chevron.
 *
 * ONE GESTURE FOR EVERY POINTER. Down, or a move, AIMS: the mark gets a ring and the caption
 * names it. Up on an aimed mark is `onPick(row)`, the very call the canvas makes for a planet
 * pointed at; a tap where nothing is opens the star map (`onMap`), of which this is the preview;
 * a drag that ends on nothing does nothing. The wheel is not touched: it reaches the overlay,
 * where scrolling out opens the map already (ui/StarMap.ts).
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
 *
 * A pointer is measured against where the plate RESTS: pressed, the plate drops onto its ledge,
 * and what was aimed at must not slip from under the pointer for it.
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
  private readonly aim: SVGElement;
  private readonly caption: HTMLElement;
  private readonly label: HTMLElement;
  private readonly name = document.createTextNode('');
  private readonly note = plannedNote('minimap');

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

  private scope = GALAXY;
  /** Does it show, as of the last frame? And was it drawn then (else the view starts afresh)? */
  private shows = false;
  private awake = false;
  private placedAt = -Infinity;
  /** What the caption last said, and where the ship was last drawn: written only when they change. */
  private said = '';
  private shipX = Number.NaN;
  private shipY = Number.NaN;
  private shipTurn = Number.NaN;
  /** The pointer over the map, from the map's top left corner; a finger only while it is down. */
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
    const map = (this.map = svg('svg', 'minimap__map', root));

    const depth = bodies.map((body, row) => (docks[row] === 0 ? 0 : markDepth(body.kind)));
    // The circles first, under every mark; then the marks, the smaller kinds last: where two lie
    // on each other the smaller is on top, as it is to a pointer (sim/minimap.ts, `markDepth`).
    const lines = svg('g', '', map);
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
    this.aim = svg('circle', 'minimap__aim', map);
    flag(this.aim, 'data-off', true);
    this.ship = svg('path', 'minimap__ship', map);
    this.ship.setAttribute('d', SHIP);

    this.caption = html('span', 'minimap__caption', root);
    html('i', '', this.caption);
    this.label = html('b', '', this.caption);
    this.label.append(this.name);

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
      this.awake = false;
      return;
    }

    // What it looks at: the system the ship is in, unless it is headed out of it; else the galaxy.
    const { x, z } = ship.position;
    const scope = miniScope(options.at(), options.bodies[options.target()]?.system ?? -1);
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
    // The marks: now and then, or with every frame while the view is on its way (a tenth of a px).
    if (
      !this.awake ||
      frame.elapsed - this.placedAt >= 1 / params.bodiesHz ||
      moved > unitsPerPx(view.span, this.frame) / 10
    ) {
      this.awake = true;
      this.placedAt = frame.elapsed;
      for (const key of VIEW) view[key] = this.eased[key].value;
      this.place();
    }

    // The ship: every frame, in the view the marks are in. North is up, so its bearing is its turn.
    const at = pointOn(view, x, z, this.frame, this.at);
    const half = this.frame.width / 2;
    const shipX = round(half + (at[0] ?? 0));
    const shipY = round(half + (at[1] ?? 0));
    const turn = Math.round(bearingOf(ship.heading));
    if (shipX === this.shipX && shipY === this.shipY && turn === this.shipTurn) return;
    this.shipX = shipX;
    this.shipY = shipY;
    this.shipTurn = turn;
    this.ship.setAttribute(
      'transform',
      `translate(${shipX} ${shipY})rotate(${turn})scale(${params.shipPx / 10})`,
    );
  }

  /** The viewport changed: the plate is sized by its height (`--minimap-size`). */
  resize(): void {
    this.shape();
  }

  /** Where the minimap is on the page, or null while it does not show: names keep off it. */
  box(): Readonly<ScreenBox> | null {
    return this.shows ? boxOf(this.root, this.area) : null;
  }

  dispose(): void {
    this.root.remove();
  }

  /**
   * The map is as big as the stylesheet makes it: draw to that size, so that one unit of the
   * drawing is one CSS px. Reads layout, so only where the size can have changed.
   */
  private shape(): void {
    if (this.root.hidden) return;
    const size = round(this.map.getBoundingClientRect().width) || SIZE;
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
    const half = frame.width / 2;
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
    // The marks have moved under a pointer at rest: what it aims at may be another now.
    this.point();
  }

  /** The row of the mark under the pointer, leaving out row `ignore`; -1 for none. */
  private hit(ignore: number): number {
    const { options, px, py, coarse } = this;
    const { picking } = options;
    const size = this.frame.width;
    if (!this.over || px < 0 || py < 0 || px > size || py > size) return -1;
    const reach = coarse ? picking.touch : picking.mouse;
    return pickMini(this.screen, px, py, reach, coarse, options.params.ambiguityPx, ignore);
  }

  /** Which mark does the pointer aim at? Ring it, say so, and name it in the caption. */
  private point(): void {
    const { options, screen } = this;
    const { bodies, systems } = options;
    // Never the body the ship is at, or is headed for: that one is "here".
    const row = this.hit(options.target());
    this.aimed = row;
    flag(this.root, 'data-pick', row >= 0);
    flag(this.aim, 'data-off', row < 0);
    if (row >= 0) {
      put(this.aim, 'cx', `${round(screen.x[row] ?? 0)}`);
      put(this.aim, 'cy', `${round(screen.y[row] ?? 0)}`);
      put(this.aim, 'r', `${round((screen.radius[row] ?? 0) + AIM_GAP)}`);
    }

    // The caption: the body aimed at, in its family; else what the map is fitted to.
    const body = bodies[row];
    const system = systems[this.scope];
    const text = body ? body.title : system ? system.name : 'Galaxy';
    const theme = body ? body.theme : system?.theme;
    const planned = body?.planned === true;
    const say = `${text} ${theme} ${planned} ${row}`;
    if (say === this.said) return;
    this.said = say;
    this.name.data = text;
    if (theme) this.caption.dataset.theme = theme;
    else delete this.caption.dataset.theme;
    flag(this.caption, 'data-aim', row >= 0);
    // "Planned" stands after the name, in a box of its own: a long name gives way, it does not.
    if (planned) this.label.after(this.note);
    else this.note.remove();
  }

  /**
   * The pointer is at this point of the window: aim from there. Measured against where the map
   * RESTS: its place in the layout, whatever moves it for the moment (its arrival, the drop of a
   * pressed plate), and asked each time, since the overlay's edge moves with the page's panel.
   */
  private follow(event: PointerEvent): void {
    const { root } = this;
    const box = this.options.overlay.getBoundingClientRect();
    this.over = true;
    this.coarse = event.pointerType === 'touch';
    this.px = event.clientX - box.left - root.offsetLeft - root.clientLeft;
    this.py = event.clientY - box.top - root.offsetTop - root.clientTop;
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
