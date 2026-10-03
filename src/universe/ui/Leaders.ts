import type { Frame, System } from '../core/Engine';
import { tokens } from '../design/tokens';
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
  /** The visitor asked for less motion: no card travels, so no line waits for one. */
  reducedMotion: boolean;
}

const SVG = 'http://www.w3.org/2000/svg';
/** As many leaders as a page can have cards (src/shell/deck.ts, MAX_CARDS). */
const POOL = 8;
/**
 * How long the cards take from place to place, in seconds: the shell carries them there in the
 * stylesheet's `--motion-base` (src/shell/cards.ts, `carry`), and the lines are away meanwhile.
 */
const ASIDE_SEC = Number.parseFloat(tokens.motion.base) / 1000;

/**
 * Do the cards TRAVEL from deck `last` to deck `next`? Another one open, or other cards: the
 * shell carries them to their new places (src/shell/cards.ts, `carry`), and a new page's cards
 * arrive in as long. Not the same cards with the same one open, told again because they were
 * measured again (the window resized, the typeface arrived): those are where they are already.
 */
function travels(last: LeaderDeck | null, next: LeaderDeck): boolean {
  if (last === null || last.body !== next.body || last.open !== next.open) return true;
  if (last.cards.length !== next.cards.length) return true;
  for (let i = 0; i < next.cards.length; i += 1) {
    if (last.cards[i]?.key !== next.cards[i]?.key) return true;
  }
  return false;
}

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
 * changed, so a resting view writes nothing at all. The stylesheet says how it all looks, and
 * how it comes and goes (`.leaders` in src/styles/global.css): the lines are drawn in when they
 * appear (`data-shown`) and fade when they leave.
 *
 * WHEN THE CARDS TRAVEL (a card opens or closes, the page has other cards) the page tells its
 * deck again, with the places the cards are on their way to. The lines step aside meanwhile
 * (`data-aside`): they fade as they were, and are written anew, and shown again, once the cards
 * have arrived. A deck that is only measured again (a resize) is followed at once. Add it AFTER
 * the labels: it needs this frame's picture.
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
  /** The deck as the lines were last drawn for (the page hands over a new one when it changes). */
  private told: LeaderDeck | null = null;
  /** Seconds left of standing aside while the cards travel. */
  private away = 0;
  private aside = false;

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

  frameUpdate(frame: Pick<Frame, 'dt'>): void {
    const { options, disc, end, mark } = this;
    const deck = options.deck();
    const body = deck?.body ?? null;
    if (deck === null || body === null || !options.framed(body, disc)) {
      this.away = 0;
      this.show(false);
      this.stepAside(false);
      return;
    }
    // The cards are on their way to where the page now says they are: the lines that show wait
    // as they were, fading, and are drawn for the new places once the cards have arrived. A deck
    // that was only measured again begins no wait (and does not begin one again).
    if (deck !== this.told) {
      const journey = travels(this.told, deck);
      this.told = deck;
      if (journey && this.shown && !options.reducedMotion) this.away = ASIDE_SEC;
    }
    if (this.away > 0) {
      this.away -= frame.dt;
      this.stepAside(true);
      if (this.away > 0) return;
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
    // (A plain loop: this runs every frame, and a callback would be made anew for each.)
    for (let index = 0; index < this.leads.length; index += 1) {
      const lead = this.leads[index];
      if (!lead) continue;
      const card = deck.cards[index];
      const open = card !== undefined && card.key === deck.open;
      // In the overview every card has its line; with one open, that one alone.
      if (!card || (deck.open !== null && !open)) {
        this.set(lead, false, false);
        continue;
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
      if (x1 === lead.x1 && y1 === lead.y1 && x2 === lead.x2 && y2 === lead.y2) continue;
      lead.x1 = x1;
      lead.y1 = y1;
      lead.x2 = x2;
      lead.y2 = y2;
      const d = `M${x1 / 10} ${y1 / 10}L${x2 / 10} ${y2 / 10}`;
      lead.casing.setAttribute('d', d);
      lead.line.setAttribute('d', d);
      lead.stop.setAttribute('cx', String(x2 / 10));
      lead.stop.setAttribute('cy', String(y2 / 10));
    }
    this.show(true);
    this.stepAside(false);
  }

  dispose(): void {
    this.svg.remove();
  }

  private show(shown: boolean): void {
    if (shown === this.shown) return;
    this.shown = shown;
    this.svg.toggleAttribute('data-shown', shown);
  }

  private stepAside(aside: boolean): void {
    if (aside === this.aside) return;
    this.aside = aside;
    this.svg.toggleAttribute('data-aside', aside);
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
