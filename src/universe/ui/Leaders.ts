import type { System } from '../core/Engine';
import { limbPoint } from '../sim/landmarks';

/** A page's deck of cards, as much of it as a leader needs (api.ts, `Deck`). */
export interface LeaderDeck {
  readonly body: string | null;
  /** Where each card's leader begins: the middle of the inner edge of its title row, CSS px. */
  readonly cards: ReadonlyArray<{ readonly key: string; readonly x: number; readonly y: number }>;
  readonly open: string | null;
}

/** A body's disc on screen, CSS px. */
export interface Disc {
  x: number;
  y: number;
  radius: number;
}

export interface LeadersOptions {
  /** The engine's mount: under the page's content, and hidden from assistive technology. */
  mount: HTMLElement;
  /** What the page last said of its cards, or null: no deck (api.ts, `setDeck`). */
  deck(): LeaderDeck | null;
  /**
   * `body` as the orbit camera has it in the picture THIS frame, into `out`. False unless the
   * ship is docked at it and nothing is in the way: no star map, no change of camera under way.
   */
  framed(body: string, out: Disc): boolean;
  /** Where card `index`'s landmark is on screen this frame, CSS px. False: not in the picture. */
  landmark(body: string, index: number, out: { x: number; y: number }): boolean;
  /** How far the camera has closed in on what it faces, 0 to 1 (camera/OrbitCam.ts, `focus`). */
  focus(): number;
  /** The colour family a body wears: the leaders are its route lines. */
  themeOf(body: string): string | undefined;
  /** Read every frame, so the dev panel's slider shows at once. */
  params: { readonly stopRadiusPx: number };
}

const SVG = 'http://www.w3.org/2000/svg';
/** As many leaders as a page can have cards (src/shell/deck.ts, MAX_CARDS). */
const POOL = 8;

interface Lead {
  readonly group: SVGElement;
  readonly casing: SVGElement;
  readonly line: SVGElement;
  readonly stop: SVGElement;
  /** As last written, in tenths of a px: from the card (1) to the body (2). */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  on: boolean;
  open: boolean;
}

/**
 * THE LEADERS: a line from every card of the page's deck (src/shell/cards.ts) to the body the
 * cards stand round, drawn like a route line of the transit map that ends in a station. In the
 * overview every card has one, straight to the nearest point of the body's limb (lines to the
 * middle of a disc from all round it never cross). With a card open only its own remains, and as
 * the camera turns to that card's landmark and closes in (`focus`), the line's end leaves the
 * limb for the landmark itself, where its station turns butter: "here".
 *
 * It is decoration: one SVG in the engine's mount, which is hidden from assistive technology and
 * lies under the page's content, so a line seems to come out from under its card. Nothing here
 * decides WHERE anything is: every frame the body's disc and the landmark come from this frame's
 * picture (ui/BodiesOnScreen.ts, world/Galaxy.ts), which is how a line follows a planet that
 * turns and travels. What is written is rounded to tenths of a pixel and only written when it
 * changed, so a resting view writes nothing at all. The stylesheet says how it all looks
 * (`.leaders` in src/styles/global.css). Add it AFTER the labels: it needs this frame's picture.
 */
export class Leaders implements System {
  private readonly svg: SVGElement;
  private readonly leads: Lead[] = [];
  private readonly disc: Disc = { x: 0, y: 0, radius: 0 };
  private readonly end = { x: 0, y: 0 };
  private readonly mark = { x: 0, y: 0 };
  private shown = false;
  private body: string | null = null;
  private radius = Number.NaN;

  constructor(private readonly options: LeadersOptions) {
    const doc = options.mount.ownerDocument;
    const make = (name: string, className: string): SVGElement => {
      const element = doc.createElementNS(SVG, name);
      element.setAttribute('class', className);
      return element;
    };
    this.svg = make('svg', 'leaders');
    this.svg.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < POOL; i += 1) {
      const group = make('g', 'leader');
      // Its place among them: the stylesheet draws them in one after the other.
      group.style.setProperty('--i', String(i));
      const casing = make('path', 'leader__casing');
      const line = make('path', 'leader__line');
      // One unit long, whatever its length: a dash of 1 is the whole line.
      casing.setAttribute('pathLength', '1');
      line.setAttribute('pathLength', '1');
      const stop = make('circle', 'leader__stop');
      group.append(casing, line, stop);
      this.svg.append(group);
      this.leads.push({
        group,
        casing,
        line,
        stop,
        x1: Number.NaN,
        y1: Number.NaN,
        x2: Number.NaN,
        y2: Number.NaN,
        on: false,
        open: false,
      });
    }
    options.mount.append(this.svg);
  }

  frameUpdate(): void {
    const { options, disc, end, mark } = this;
    const deck = options.deck();
    const body = deck?.body ?? null;
    if (deck === null || body === null || !options.framed(body, disc)) {
      this.show(false);
      return;
    }
    if (body !== this.body) {
      this.body = body;
      const theme = options.themeOf(body);
      if (theme === undefined) this.svg.removeAttribute('data-theme');
      else this.svg.setAttribute('data-theme', theme);
    }
    const radius = options.params.stopRadiusPx;
    if (radius !== this.radius) {
      this.radius = radius;
      for (const lead of this.leads) lead.stop.setAttribute('r', String(radius));
    }
    const focus = deck.open === null ? 0 : options.focus();
    this.leads.forEach((lead, index) => {
      const card = deck.cards[index];
      const open = card !== undefined && card.key === deck.open;
      // In the overview every card has its line; with one open, that one alone.
      if (!card || (deck.open !== null && !open)) {
        this.set(lead, false, false);
        return;
      }
      limbPoint(disc.x, disc.y, disc.radius, card.x, card.y, end);
      if (open && focus > 0 && options.landmark(body, index, mark)) {
        end.x += (mark.x - end.x) * focus;
        end.y += (mark.y - end.y) * focus;
      }
      this.set(lead, true, open);
      const x1 = Math.round(card.x * 10);
      const y1 = Math.round(card.y * 10);
      const x2 = Math.round(end.x * 10);
      const y2 = Math.round(end.y * 10);
      if (x1 === lead.x1 && y1 === lead.y1 && x2 === lead.x2 && y2 === lead.y2) return;
      lead.x1 = x1;
      lead.y1 = y1;
      lead.x2 = x2;
      lead.y2 = y2;
      const d = `M${x1 / 10} ${y1 / 10}L${x2 / 10} ${y2 / 10}`;
      lead.casing.setAttribute('d', d);
      lead.line.setAttribute('d', d);
      lead.stop.setAttribute('cx', String(x2 / 10));
      lead.stop.setAttribute('cy', String(y2 / 10));
    });
    this.show(true);
  }

  dispose(): void {
    this.svg.remove();
  }

  private show(shown: boolean): void {
    if (shown === this.shown) return;
    this.shown = shown;
    this.svg.toggleAttribute('data-shown', shown);
  }

  private set(lead: Lead, on: boolean, open: boolean): void {
    if (on !== lead.on) {
      lead.on = on;
      lead.group.toggleAttribute('data-on', on);
    }
    if (open !== lead.open) {
      lead.open = open;
      lead.group.toggleAttribute('data-open', open);
    }
  }
}
