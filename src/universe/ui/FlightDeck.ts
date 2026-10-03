import { boxOf, flag, html, svg } from '../core/dom';
import type { Frame, System, Viewport } from '../core/Engine';
import type { ThemeKey } from '../design/tokens';
import type { ScreenBox } from '../sim/declutter';
import {
  MERIDIANS,
  bearingOf,
  deckLayout,
  deckShows,
  gOf,
  isBehind,
  lampsOf,
  markerShare,
  meridians,
  offBearing,
  relativeBearing,
  warpTier,
  wholeBearing,
  type DeckLayout,
  type DeckMode,
  type InstrumentParams,
  type Lamps,
} from '../sim/instruments';
import { clamp } from '../sim/math';
import { createSpring, snapSpring, stepSpring } from '../sim/spring';
import type { FlightInput, ShipState } from '../sim/types';

/** What the deck reads of the ship (ship/ShipSystem.ts): this frame's pose, and the last step. */
export interface DeckShip {
  readonly position: { readonly x: number; readonly z: number };
  readonly velocity: { readonly x: number; readonly z: number };
  readonly heading: number;
  readonly speed: number;
  readonly bank: number;
  readonly pitch: number;
  readonly flown: Readonly<FlightInput>;
  readonly state: Readonly<ShipState>;
}

/** ...and of state/Navigator.ts. Nothing it could ask for: the deck only reads. */
export interface DeckNavigator {
  readonly state: { readonly mode: DeckMode; readonly target: string | null };
  readonly candidate: string | null;
  readonly halting: boolean;
  readonly guarding: boolean;
}

export interface FlightDeckOptions {
  /** Where the engine's own DOM goes. The deck is a picture there: hidden from assistive tech. */
  overlay: HTMLElement;
  ship: DeckShip;
  navigator: DeckNavigator;
  /** 0 to 1: how much of the flying the orbit assist did in the last step. */
  assistWeight(): number;
  /** Where every body is this frame: [x0, z0, x1, z1, ...], by row. */
  positions: Float64Array;
  /** The row of a body, or -1. */
  rowOf(id: string): number;
  /** The row of the home planet, or -1. */
  home: number;
  /** The colour family of the system the ship is in, or null between systems. */
  theme(): ThemeKey | null;
  mapOpen(): boolean;
  params: InstrumentParams;
  reducedMotion: boolean;
}

const DEG_PER_RAD = 180 / Math.PI;
/** px. The plate where nothing can be measured (no layout: a unit test): 7rem, and the strip's 2.25rem. */
const PLATE = 112;
const STRIP_PLATE = 36;
/** The ball's radius in that plate. The marks are drawn for it, and shrink with a smaller ball... */
const BALL = 42;
/** ...down to this share of their size. */
const SMALLEST = 0.7;
/** px. A mark's middle keeps this far inside the rim, so that it is whole when pinned there. */
const INSET = 4;
/** The target's lane lies this share of the radius above the horizon, home's as far below. */
const LANE = 0.34;
/** The peg lights once the g arc is this full. */
const PEGGED = 0.95;
/** "Not drawn", where a number is kept of what was last written. */
const OFF = 1e9;

// One slot each for what was last written: a value that has not changed is not written again.
const LETTER = MERIDIANS;
const SQUASH = LETTER + 4;
const TARGET = SQUASH + 4;
const HOME = TARGET + 1;
const PROGRADE = HOME + 1;
const LEAN = PROGRADE + 1;
const NOD = LEAN + 1;
const THROTTLE = NOD + 1;
const G = THROTTLE + 1;
const SLOTS = G + 1;

/** To a tenth: finer than a screen shows, and coarse enough that a ship at rest writes nothing. */
const round = (value: number): number => Math.round(value * 10) / 10;

/** The same shape twice: a navy rim (the wider stroke, below) and the mark itself. */
function rimmed(tag: string, name: string, value: string, parent: Element): void {
  for (const className of ['flight-deck__under', 'flight-deck__over']) {
    svg(tag, className, parent).setAttribute(name, value);
  }
}

/**
 * THE FLIGHT DECK (sim/instruments.ts has the maths): Kerbal Space Program's cluster at the
 * bottom of the view, drawn flat. A ball that turns with the heading and leans with the ship,
 * the speed above it, the heading below, the throttle up its left side and the g up its right,
 * and a lamp on each shoulder.
 *
 * IT ONLY READS. No button, no shortcut, nothing to focus, nothing said aloud: the prompt is the
 * one thing out there that acts, and everything the deck shows is already said by a real control
 * or by the announcer. So the whole of it is `aria-hidden`. Whether it shows and how big it is
 * are `deckShows` and `deckLayout`, never a media query; how it looks is all in the stylesheet
 * (`.flight-deck` in src/styles/global.css), which is told by classes and data attributes:
 *
 *   hidden        no room for it
 *   data-layout   full | strip | off
 *   data-shown    the ship is under way and the sky is in view: it fades in and out by this
 *   data-seated   shown, at full size: the prompt steps beside it, the how-to-fly card above it
 *   data-theme    the family of the system the ship is in (the horizon wears it)
 *   data-warp     0 to 3 chevrons     data-boost, data-peg    the arcs' two lights
 *
 * THE STRIP is the same deck with less on it, for a view too small for the cluster: one pill in
 * the Map button's row. Its ball has the horizon, north, the nose and the target; beside it the
 * speed, over the heading or the name of the lamp that is lit (`.flight-deck__lit`). What the
 * strip does not show is not written while it is the strip.
 *
 * Geometry is written as attributes, to a tenth of a pixel, and only when it changed: at rest
 * the deck writes nothing at all.
 */
export class FlightDeck implements System {
  private readonly root: HTMLDivElement;
  private readonly plate: HTMLElement;
  private readonly dial: SVGElement;
  private readonly assist: HTMLElement;
  private readonly auto: HTMLElement;
  /** The strip's one lamp: the name of whichever is lit, or nothing. */
  private readonly lit: HTMLElement;
  private readonly speedText = document.createTextNode('');
  private readonly headingText = document.createTextNode('');
  /** What leans and nods as one: the globe (cut to the ball), and the marks on it (whole). */
  private readonly world: SVGElement;
  private readonly marks: SVGElement;
  private readonly clip: SVGElement;
  private readonly rim: SVGElement;
  private readonly nose: SVGElement;
  private readonly lines: SVGElement[] = [];
  private readonly letters: SVGElement[] = [];
  private readonly target: SVGElement;
  private readonly homeMark: SVGElement;
  private readonly prograde: SVGElement;
  /** Each arc: what a mouse can find, the track, and the fill. */
  private readonly throttleArc: SVGElement[];
  private readonly gArc: SVGElement[];
  private readonly peg: SVGElement;

  private readonly ellipses = new Float64Array(MERIDIANS * 2);
  private readonly last = new Float64Array(SLOTS).fill(Number.NaN);
  private readonly lamps: Lamps = { auto: false, assist: false };
  private readonly throttle = createSpring(0);
  private readonly g = createSpring(0);
  private readonly area: ScreenBox = { left: 0, top: 0, width: 0, height: 0 };

  private layout: DeckLayout = 'off';
  private width = 0;
  private height = 0;
  private right = 0;
  private bottom = 0;
  /** The plate's size, the ball's radius and the length of an arc, in px; the marks' scale. */
  private size = 0;
  private radius = 0;
  private arcLength = 0;
  private scale = 1;
  /** What the last simulation step pulled, in g, and the velocity it left the ship with. */
  private pull = 0;
  private lastVx: number;
  private lastVz: number;
  /** Is it on screen, as of the last frame? And was it drawn then (else the springs start afresh)? */
  private drawn = false;
  private awake = false;
  private speed = -1;
  private bearing = -1;
  private warp = -1;
  private digitsAt = -Infinity;
  private theme: ThemeKey | null = null;
  private litName = '';

  constructor(private readonly options: FlightDeckOptions) {
    const root = (this.root = document.createElement('div'));
    root.className = 'flight-deck';
    root.setAttribute('aria-hidden', 'true');
    root.dataset.layout = this.layout;
    root.hidden = true;

    this.assist = this.lamp('assist', 'Assist');
    const speed = html('span', 'flight-deck__speed', root);
    const warp = svg('svg', 'flight-deck__warp', speed);
    warp.setAttribute('viewBox', '0 0 18 10');
    for (const x of [1, 7, 13]) svg('path', '', warp).setAttribute('d', `M${x} 1l4 4-4 4`);
    html('b', '', speed).append(this.speedText);
    html('small', '', speed).textContent = 'm/s';
    this.auto = this.lamp('auto', 'Auto');

    this.plate = html('span', 'flight-deck__plate', root);
    const dial = (this.dial = svg('svg', 'flight-deck__dial', this.plate));
    const clip = svg('clipPath', '', svg('defs', '', dial));
    clip.id = 'flight-deck-globe';
    this.clip = svg('circle', '', clip);
    const globe = svg('g', 'flight-deck__globe', dial);
    globe.setAttribute('clip-path', `url(#${clip.id})`);
    svg('title', '', globe).textContent = 'Compass';
    const world = (this.world = svg('g', '', globe));
    // The two halves and the horizon are far bigger than the ball: they are cut to it, however
    // the globe leans.
    svg('path', 'flight-deck__sky', world).setAttribute('d', 'M-200-200h400v200h-400z');
    svg('path', 'flight-deck__ground', world).setAttribute('d', 'M-200 0h400v200h-400z');
    for (let k = 0; k < MERIDIANS; k += 1) this.lines.push(svg('path', 'flight-deck__line', world));
    // North first: the one meridian the strip keeps.
    this.lines[0]?.setAttribute('data-north', '');
    for (const name of 'NESW') {
      const letter = svg('text', 'flight-deck__letter', world);
      letter.textContent = name;
      // (Half the height of a capital: the letter's middle is where it is put.)
      letter.setAttribute('dy', '0.35em');
      this.letters.push(letter);
    }
    svg('path', 'flight-deck__horizon', world).setAttribute('d', 'M-200 0H200');
    this.rim = svg('circle', 'flight-deck__rim', dial);

    // The marks ride the globe but are not cut to it: one pinned at the rim is still a whole
    // mark. The lower lane first, the target last: where two meet, the target is on top.
    this.marks = svg('g', '', dial);
    this.homeMark = this.mark('home');
    rimmed('path', 'd', 'M-4.5 4.5v-5.5l4.5-4 4.5 4v5.5z', this.homeMark);
    this.prograde = this.mark('prograde');
    rimmed('circle', 'r', '5', this.prograde);
    svg('circle', 'flight-deck__dot', this.prograde).setAttribute('r', '1.5');
    this.target = this.mark('target');
    rimmed('circle', 'r', '6.5', this.target);
    svg('circle', 'flight-deck__dot', this.target).setAttribute('r', '3');
    // The nose: fixed, whatever the globe does behind it.
    this.nose = svg('g', 'flight-deck__nose', dial);
    rimmed('path', 'd', 'M-14 0h8l6 6 6-6h8', this.nose);

    this.throttleArc = this.arc('throttle', 'Throttle');
    this.gArc = this.arc('g', 'G-force');
    this.peg = svg('circle', 'flight-deck__peg', dial);
    this.peg.setAttribute('r', '2.5');

    const heading = html('span', 'flight-deck__hdg', root);
    html('small', '', heading).textContent = 'HDG';
    html('b', '', heading).append(this.headingText);
    this.lit = html('span', 'flight-deck__lit', root);

    const { vx, vz } = options.ship.state;
    this.lastVx = vx;
    this.lastVz = vz;
    // Last in the overlay: nothing in it takes the focus, so the order of what does is unchanged.
    options.overlay.append(root);
  }

  /** The g is a matter of the SIMULATION: what each step did to the velocity. */
  fixedUpdate(dt: number): void {
    const { vx, vz } = this.options.ship.state;
    this.pull = gOf(vx - this.lastVx, vz - this.lastVz, dt, this.options.params);
    this.lastVx = vx;
    this.lastVz = vz;
  }

  frameUpdate(frame: Frame): void {
    const { navigator, mapOpen, ship } = this.options;
    const shown = deckShows(navigator.state.mode === 'docked', mapOpen());
    flag(this.root, 'data-shown', shown);
    flag(this.root, 'data-seated', shown && this.layout === 'full');
    this.drawn = shown && !this.root.hidden;
    if (!this.drawn) {
      this.awake = false;
      return;
    }
    if (!this.awake) {
      // Back in view: the arcs and the digits say what is true now, without easing in from then.
      this.awake = true;
      snapSpring(this.throttle, ship.flown.thrust);
      snapSpring(this.g, this.pull);
      this.digitsAt = -Infinity;
    }
    this.draw(frame);
  }

  /** The viewport changed: the engine says so, as to every system. */
  resize(viewport: Viewport): void {
    this.width = viewport.width;
    this.height = viewport.height;
    this.fit();
  }

  /** How much of the viewport the info panel covers, from the right and from the bottom (CSS px). */
  setRoom(right: number, bottom: number): void {
    this.right = right;
    this.bottom = bottom;
    this.fit();
  }

  /** Where the deck is on the page, or null while it does not show: names keep off it. */
  box(): Readonly<ScreenBox> | null {
    return this.drawn ? boxOf(this.root, this.area) : null;
  }

  /**
   * Has the free view room for the whole cluster? The minimap, which is only there beside it
   * (ui/MiniMap.ts), asks here: "how big" has one answer, `deckLayout`'s.
   */
  get full(): boolean {
    return this.layout === 'full';
  }

  dispose(): void {
    this.root.remove();
  }

  private lamp(name: string, text: string): HTMLElement {
    const lamp = html('span', 'flight-deck__lamp', this.root);
    lamp.dataset.lamp = name;
    lamp.textContent = text;
    return lamp;
  }

  private mark(name: string): SVGElement {
    const mark = svg('g', 'flight-deck__mark', this.marks);
    mark.dataset.mark = name;
    mark.setAttribute('data-off', '');
    return mark;
  }

  private arc(name: string, title: string): SVGElement[] {
    const arc = svg('g', 'flight-deck__arc', this.dial);
    arc.dataset.arc = name;
    svg('title', '', arc).textContent = title;
    return ['hit', 'track', 'fill'].map((part) => svg('path', `flight-deck__${part}`, arc));
  }

  /** How big may the deck be in the view the panel leaves free? (R2: this, and no media query.) */
  private fit(): void {
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const layout = deckLayout(
      this.width - this.right,
      this.height - this.bottom,
      this.bottom > 0,
      rem,
      this.options.params,
    );
    if (layout !== this.layout) {
      this.layout = layout;
      this.root.dataset.layout = layout;
      this.root.hidden = layout === 'off';
    }
    if (!this.root.hidden) this.shape();
  }

  /**
   * The plate is as big as the stylesheet makes it (`--deck-size`, by the view's height; 2.25rem
   * in the strip): draw to that size, so that one unit of the drawing is one CSS px and its
   * letters are 12 px letters. Reads layout, so only where the size can have changed.
   */
  private shape(): void {
    const strip = this.layout === 'strip';
    const size = round(this.plate.getBoundingClientRect().width) || (strip ? STRIP_PLATE : PLATE);
    if (size === this.size) return;
    this.size = size;
    const half = size / 2;
    // The cluster's ball leaves room round it for the arcs; the strip's fills its plate.
    const r = (this.radius = strip ? half - 1 : half - 14);
    const arc = half - 8;
    this.dial.setAttribute('viewBox', `${-half} ${-half} ${size} ${size}`);
    this.clip.setAttribute('r', `${r}`);
    this.rim.setAttribute('r', `${r}`);
    // On a small ball the marks are smaller, or they would be all there is to see of it.
    this.scale = round(clamp(r / BALL, SMALLEST, 1));
    this.nose.setAttribute('transform', `scale(${this.scale})`);
    // A quarter of a circle up each side: the throttle from lower left, the g from lower right.
    const k = round(arc * Math.SQRT1_2);
    for (const path of this.throttleArc) {
      path.setAttribute('d', `M${-k} ${k}A${arc} ${arc} 0 0 1 ${-k} ${-k}`);
    }
    for (const path of this.gArc) {
      path.setAttribute('d', `M${k} ${k}A${arc} ${arc} 0 0 0 ${k} ${-k}`);
    }
    this.arcLength = (arc * Math.PI) / 2;
    // The peg: 8 px on from the top of the g arc.
    const at = Math.PI / 4 - 8 / arc;
    this.peg.setAttribute('cx', `${round(arc * Math.sin(at))}`);
    this.peg.setAttribute('cy', `${round(-arc * Math.cos(at))}`);
    // Everything else follows from the radius, and is written again with the next frame.
    this.last.fill(Number.NaN);
  }

  /** Is `value` news for this slot? (It is remembered either way.) */
  private changed(slot: number, value: number): boolean {
    if (this.last[slot] === value) return false;
    this.last[slot] = value;
    return true;
  }

  private draw(frame: Frame): void {
    const { ship, navigator, params, reducedMotion } = this.options;
    const { root, radius: r } = this;
    const { mode, target } = navigator.state;
    // The whole cluster, or the strip: its ball has north alone, no letters, and no arcs round it.
    const full = this.layout === 'full';

    // The ball turns with the heading: the frame's own, no easing on top.
    const bearing = bearingOf(ship.heading);
    meridians(bearing, r, this.ellipses);
    for (let k = 0; k < (full ? MERIDIANS : 1); k += 1) {
      // A meridian in view is half an ellipse from pole to pole; the one dead ahead a straight line.
      const side = this.ellipses[k * 2 + 1] ?? 0;
      const rx = round(this.ellipses[k * 2] ?? 0);
      if (!this.changed(k, side * (rx + 1))) continue;
      const d = side === 0 ? '' : `M0 ${-r}A${rx} ${r} 0 0 ${side > 0 ? 1 : 0} 0 ${r}`;
      this.lines[k]?.setAttribute('d', d);
    }
    for (let i = 0; full && i < this.letters.length; i += 1) {
      // N, E, S and W ride their meridians, and turn away as they near the rim, as anything
      // painted on a globe does: narrower and narrower, then gone.
      const off = offBearing(i * 90, bearing) / DEG_PER_RAD;
      const shown = Math.abs(off) < 1.4;
      const x = shown ? round(0.8 * r * Math.sin(off)) : OFF;
      const squash = shown ? Math.round(Math.cos(off) * 100) / 100 : OFF;
      const moved = this.changed(LETTER + i, x);
      const letter = this.letters[i];
      if (!letter || !(this.changed(SQUASH + i, squash) || moved)) continue;
      flag(letter, 'data-off', !shown);
      if (shown) {
        letter.setAttribute('transform', `translate(${x} ${round(-0.6 * r)})scale(${squash} 1)`);
      }
    }
    // It leans and nods as the ship on screen does (its looks, not its physics: flight is flat).
    if (!reducedMotion) {
      const lean = round(-ship.bank * DEG_PER_RAD);
      const nod = round(-ship.pitch * r);
      const leans = this.changed(LEAN, lean);
      if (this.changed(NOD, nod) || leans) {
        const pose = `rotate(${lean})translate(0 ${nod})`;
        this.world.setAttribute('transform', pose);
        this.marks.setAttribute('transform', pose);
      }
    }

    // The marks. The target: where a journey or an approach is locked on, else the body within
    // reach (press E). Home: not while it is the target. Prograde: where the ship is really going.
    const row = this.row(target ?? navigator.candidate);
    this.place(TARGET, this.target, -LANE, this.toward(row));
    flag(this.target, 'data-lock', mode === 'autopilot' || mode === 'approach');
    // The arcs follow what was flown, and what it did to the ship, whether they show or not: the
    // cluster that takes the strip's place (a panel closes) starts from what is true.
    stepSpring(this.throttle, ship.flown.thrust, params.throttleOmega, frame.dt);
    stepSpring(this.g, this.pull, params.gOmega, frame.dt);
    if (full) {
      const { home } = this.options;
      this.place(HOME, this.homeMark, LANE, home === row ? null : this.toward(home));
      const { x: vx, z: vz } = ship.velocity;
      const going = ship.speed >= params.progradeMinSpeed;
      this.place(
        PROGRADE,
        this.prograde,
        0,
        going ? relativeBearing(0, 0, ship.heading, vx, vz) : null,
      );
      const g = this.g.value / params.gFull;
      this.fill(THROTTLE, this.throttleArc, this.throttle.value);
      this.fill(G, this.gArc, g);
      flag(root, 'data-boost', ship.flown.boost && ship.flown.thrust > 0);
      flag(root, 'data-peg', g >= PEGGED);
    }

    const lamps = lampsOf(
      mode,
      navigator.halting,
      navigator.guarding,
      this.options.assistWeight(),
      params.assistOn,
      this.lamps,
    );
    flag(this.auto, 'data-on', lamps.auto);
    flag(this.assist, 'data-on', lamps.assist);
    // The strip has room for one lamp: the name of whichever is lit, where the heading was.
    const lit = lamps.auto ? 'Auto' : lamps.assist ? 'Assist' : '';
    if (lit !== this.litName) {
      this.litName = lit;
      this.lit.textContent = lit;
    }

    const theme = this.options.theme();
    if (theme !== this.theme) {
      this.theme = theme;
      if (theme) root.dataset.theme = theme;
      else delete root.dataset.theme;
    }

    // The digits: whole numbers, written when they change and no faster than a visitor can read.
    const hz = reducedMotion ? params.digitsHzReduced : params.digitsHz;
    if (frame.elapsed - this.digitsAt < 1 / hz) return;
    const speed = Math.round(ship.speed);
    const whole = wholeBearing(ship.heading);
    if (speed === this.speed && whole === this.bearing) return;
    this.digitsAt = frame.elapsed;
    if (speed !== this.speed) {
      this.speed = speed;
      this.speedText.data = `${speed}`;
      // One chevron for each of the autopilot's speeds it has reached.
      const warp = warpTier(speed, params.warpTiers);
      if (warp !== this.warp) {
        this.warp = warp;
        root.dataset.warp = `${warp}`;
      }
    }
    if (whole !== this.bearing) {
      this.bearing = whole;
      this.headingText.data = `${String(whole).padStart(3, '0')}°`;
    }
  }

  private row(id: string | null): number {
    return id === null ? -1 : this.options.rowOf(id);
  }

  /** Where the body in `row` lies off the nose, in radians (positive to the left), or null. */
  private toward(row: number): number | null {
    const { ship, positions } = this.options;
    const x = positions[row * 2];
    const z = positions[row * 2 + 1];
    if (row < 0 || x === undefined || z === undefined) return null;
    return relativeBearing(ship.position.x, ship.position.z, ship.heading, x, z);
  }

  /**
   * Put a mark on its lane (`lane`: a share of the radius below the horizon) at a relative
   * bearing: dead ahead in the middle, a quarter turn off at the rim, and pinned there for
   * everything behind the ship.
   */
  private place(slot: number, mark: SVGElement, lane: number, relative: number | null): void {
    flag(mark, 'data-off', relative === null);
    if (relative === null) return;
    flag(mark, 'data-behind', isBehind(relative));
    const y = lane * this.radius;
    const reach = Math.sqrt((this.radius - INSET) ** 2 - y * y);
    const x = round(reach * markerShare(relative));
    if (!this.changed(slot, x)) return;
    mark.setAttribute('transform', `translate(${x} ${round(y)})scale(${this.scale})`);
  }

  /** Fill an arc from its lower end up to `share` of its length. */
  private fill(slot: number, arc: SVGElement[], share: number): void {
    const length = round(clamp(share, 0, 1) * this.arcLength);
    if (!this.changed(slot, length)) return;
    arc[2]?.setAttribute('stroke-dasharray', `${length} ${Math.ceil(this.arcLength) + 9}`);
  }
}
