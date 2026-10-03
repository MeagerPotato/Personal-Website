// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Leaders, type Disc, type LeaderDeck } from './Leaders';

/** Three cards: one on the left of the body, two on the right. */
const CARDS = [
  { key: 'in-short', x: 355, y: 220 },
  { key: 'rockets', x: 925, y: 98 },
  { key: 'robots', x: 925, y: 420 },
];
const BODY = { x: 640, y: 400, radius: 120 };

function setup(over: { deck?: LeaderDeck | null; focus?: number } = {}) {
  document.body.innerHTML = '<div id="host"><canvas></canvas></div>';
  const mount = document.getElementById('host') as HTMLElement;
  const state = {
    deck: (over.deck === undefined
      ? { body: 'page/about', cards: CARDS, open: null }
      : over.deck) as LeaderDeck | null,
    framed: 'page/about' as string | null,
    disc: { ...BODY },
    focus: over.focus ?? 0,
    mark: { x: 700, y: 330 } as { x: number; y: number } | null,
    stop: 5,
  };
  const landmark = vi.fn((_body: string, index: number, out: { x: number; y: number }) => {
    if (!state.mark) return false;
    out.x = state.mark.x + index;
    out.y = state.mark.y;
    return true;
  });
  const leaders = new Leaders({
    mount,
    deck: () => state.deck,
    framed: (body, out: Disc) => {
      if (body !== state.framed) return false;
      Object.assign(out, state.disc);
      return true;
    },
    landmark,
    focus: () => state.focus,
    themeOf: (body) =>
      body === 'page/about' ? 'butter' : body === 'project/fishai' ? 'sky' : undefined,
    params: {
      get stopRadiusPx() {
        return state.stop;
      },
    },
  });
  const svg = mount.querySelector('svg.leaders') as SVGElement;
  /** The leaders that show: [path, the station's middle, whether it is the open card's]. */
  const drawn = () =>
    svg.hasAttribute('data-shown')
      ? [...svg.querySelectorAll('.leader[data-on]')].map((group) => ({
          d: group.querySelector('.leader__line')?.getAttribute('d') ?? '',
          casing: group.querySelector('.leader__casing')?.getAttribute('d') ?? '',
          stop: [
            Number(group.querySelector('.leader__stop')?.getAttribute('cx')),
            Number(group.querySelector('.leader__stop')?.getAttribute('cy')),
          ],
          open: group.hasAttribute('data-open'),
        }))
      : [];
  return { mount, state, leaders, svg, drawn, landmark };
}

/** The ends of a path "Mx1 y1Lx2 y2". */
function ends(d: string): [number, number, number, number] {
  const numbers = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  return [numbers[0] ?? NaN, numbers[1] ?? NaN, numbers[2] ?? NaN, numbers[3] ?? NaN];
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('the leaders', () => {
  it('are one picture in the mount, over the canvas, and nothing a screen reader hears', () => {
    const { mount, svg } = setup();
    expect(mount.lastElementChild).toBe(svg);
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    // Room for a line from each of as many cards as a page can have, and nothing shows yet.
    expect(svg.querySelectorAll('.leader')).toHaveLength(8);
    expect(svg.hasAttribute('data-shown')).toBe(false);
    expect(svg.querySelectorAll('button, a, [tabindex]')).toHaveLength(0);
    // What the stylesheet draws them in with: each line and its rim one unit long, whatever
    // their length on screen (a dash of 1 is the whole of it), and each group's place in the row.
    const groups = [...svg.querySelectorAll<SVGElement>('.leader')];
    expect(groups.map((group) => group.style.getPropertyValue('--i'))).toEqual(
      groups.map((_, place) => String(place)),
    );
    for (const stroke of svg.querySelectorAll('.leader__line, .leader__casing')) {
      expect(stroke.getAttribute('pathLength')).toBe('1');
    }
    expect(svg.querySelectorAll('.leader__line, .leader__casing')).toHaveLength(16);
  });

  it('draw a line from every card to the nearest point of the body’s limb, in the overview', () => {
    const { leaders, drawn, svg } = setup();
    leaders.frameUpdate();
    const lines = drawn();
    expect(lines).toHaveLength(3);
    lines.forEach((line, i) => {
      const [x1, y1, x2, y2] = ends(line.d);
      // From the card's own anchor...
      expect([x1, y1]).toEqual([CARDS[i]?.x, CARDS[i]?.y]);
      // ...to the edge of the disc, on the straight line to its middle...
      expect(Math.hypot(x2 - BODY.x, y2 - BODY.y)).toBeCloseTo(BODY.radius, 1);
      expect(Math.sign(x2 - BODY.x)).toBe(Math.sign(x1 - BODY.x));
      // ...where its station is; and the dark rim runs under the same line.
      expect(line.stop).toEqual([x2, y2]);
      expect(line.casing).toBe(line.d);
      expect(line.open).toBe(false);
    });
    expect(svg.getAttribute('data-theme')).toBe('butter');
    expect(svg.querySelector('.leader__stop')?.getAttribute('r')).toBe('5');
  });

  it('keep to the limb in the overview while the camera is still easing back out', () => {
    // A card was closed a moment ago: the camera has not yet let go of what that card pointed at.
    const { leaders, drawn, landmark } = setup({ focus: 0.6 });
    leaders.frameUpdate();
    const lines = drawn();
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      const [, , x2, y2] = ends(line.d);
      expect(Math.hypot(x2 - BODY.x, y2 - BODY.y)).toBeCloseTo(BODY.radius, 1);
    }
    expect(landmark).not.toHaveBeenCalled();
  });

  it('leave the open card its line alone, ending on the limb until the camera has closed in', () => {
    const { leaders, drawn, state, landmark } = setup({
      deck: { body: 'page/about', cards: CARDS, open: 'rockets' },
    });
    leaders.frameUpdate();
    /** The one line that shows: where it begins, and where it ends. */
    const line = () => {
      const lines = drawn();
      expect(lines).toHaveLength(1);
      const [x1, y1, x2, y2] = ends(lines[0]?.d ?? '');
      return {
        from: [x1, y1],
        to: [x2, y2],
        far: Math.hypot(x2 - BODY.x, y2 - BODY.y),
        ...lines[0],
      };
    };
    const first = line();
    expect(first.open).toBe(true);
    expect(first.from).toEqual([925, 98]);
    expect(first.far).toBeCloseTo(BODY.radius, 1);
    // Nobody is asked where the landmark is while the camera has not begun to close in.
    expect(landmark).not.toHaveBeenCalled();

    // Halfway in, the end is halfway from the limb to the landmark...
    state.focus = 0.5;
    leaders.frameUpdate();
    const half = line();
    expect(half.to[0]).toBeCloseTo(((first.to[0] ?? 0) + 701) / 2, 1);
    expect(half.to[1]).toBeCloseTo(((first.to[1] ?? 0) + 330) / 2, 1);
    // ...(card 1's own landmark was asked for, of this body)...
    expect(landmark).toHaveBeenLastCalledWith('page/about', 1, expect.anything());
    // ...and all the way in, on it: inside the disc, with its station.
    state.focus = 1;
    leaders.frameUpdate();
    const there = line();
    expect(there.to).toEqual([701, 330]);
    expect(there.stop).toEqual([701, 330]);
    expect(there.far).toBeLessThan(BODY.radius);
    expect(there.from).toEqual([925, 98]);

    // A landmark that is not in the picture leaves the line on the limb.
    state.mark = null;
    leaders.frameUpdate();
    expect(line().far).toBeCloseTo(BODY.radius, 1);

    // Closed again: every card has its line back, and none is the open one's.
    state.deck = { body: 'page/about', cards: CARDS, open: null };
    leaders.frameUpdate();
    expect(drawn().map((line) => line.open)).toEqual([false, false, false]);
  });

  it('show nothing unless the deck’s body is the one framed: not docked, the map, another body', () => {
    const { leaders, drawn, state, svg } = setup();
    leaders.frameUpdate();
    expect(drawn()).toHaveLength(3);

    // The ship left, or the star map is up, or the camera is on its way: nothing is framed.
    state.framed = null;
    leaders.frameUpdate();
    expect(drawn()).toHaveLength(0);
    expect(svg.hasAttribute('data-shown')).toBe(false);
    // Docked somewhere else than the page's body.
    state.framed = 'project/fishai';
    leaders.frameUpdate();
    expect(drawn()).toHaveLength(0);
    // Back at it.
    state.framed = 'page/about';
    leaders.frameUpdate();
    expect(drawn()).toHaveLength(3);

    // No deck (a panel, a sheet, the home page), or a page that belongs to no body.
    state.deck = null;
    leaders.frameUpdate();
    expect(drawn()).toHaveLength(0);
    state.deck = { body: null, cards: CARDS, open: null };
    leaders.frameUpdate();
    expect(drawn()).toHaveLength(0);
  });

  it('follow the body and the cards, and wear the family of the body they lead to', () => {
    const { leaders, drawn, state, svg } = setup();
    leaders.frameUpdate();
    const before = drawn().map((line) => line.d);
    // The view slides over (a card opened): the body is elsewhere on screen.
    state.disc.x = 700;
    leaders.frameUpdate();
    const after = drawn().map((line) => line.d);
    expect(after).not.toEqual(before);
    for (const d of after) {
      const [, , x2, y2] = ends(d);
      expect(Math.hypot(x2 - 700, y2 - BODY.y)).toBeCloseTo(BODY.radius, 1);
    }
    // A card moves straight toward the body (its column grew narrower): the line ends where it
    // did, and begins where the card now is.
    const [, , endX, endY] = ends(after[2] ?? '');
    state.deck = {
      body: 'page/about',
      cards: [...CARDS.slice(0, 2), { key: 'robots', x: (925 + endX) / 2, y: (420 + endY) / 2 }],
      open: null,
    };
    leaders.frameUpdate();
    const nearer = ends(drawn()[2]?.d ?? '');
    expect(nearer[0]).toBeCloseTo((925 + endX) / 2, 1);
    expect(nearer[1]).toBeCloseTo((420 + endY) / 2, 1);
    expect(nearer[2]).toBeCloseTo(endX, 1);
    expect(nearer[3]).toBeCloseTo(endY, 1);
    // Another page, another body, fewer cards: the lines left over are put away.
    state.framed = 'project/fishai';
    state.deck = { body: 'project/fishai', cards: CARDS.slice(0, 2), open: null };
    leaders.frameUpdate();
    expect(drawn()).toHaveLength(2);
    expect(svg.getAttribute('data-theme')).toBe('sky');
    // A body with no family of its own wears none (the stylesheet's default).
    state.framed = 'link/github';
    state.deck = { body: 'link/github', cards: CARDS, open: null };
    leaders.frameUpdate();
    expect(svg.hasAttribute('data-theme')).toBe(false);
  });

  it('write nothing while nothing moves, and in tenths of a pixel when something does', () => {
    const { leaders, state, svg } = setup();
    leaders.frameUpdate();
    const spies = [
      vi.spyOn(Element.prototype, 'setAttribute'),
      vi.spyOn(Element.prototype, 'toggleAttribute'),
      vi.spyOn(Element.prototype, 'removeAttribute'),
    ];
    /** How many attributes were written since the last time anyone asked. */
    const writes = (): number => {
      const count = spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
      for (const spy of spies) spy.mockClear();
      return count;
    };

    // A resting view: frame after frame, not one attribute is touched.
    for (let i = 0; i < 5; i += 1) leaders.frameUpdate();
    expect(writes()).toBe(0);
    // The body shivers by a thousandth of a pixel, far less than is ever written: still nothing.
    state.disc.x += 0.001;
    leaders.frameUpdate();
    expect(writes()).toBe(0);
    // It moves by a pixel: every line is written again (its two paths, its station), rounded
    // to tenths.
    state.disc.x += 1.234;
    leaders.frameUpdate();
    expect(writes()).toBe(3 * 4);
    for (const path of svg.querySelectorAll('.leader[data-on] .leader__line')) {
      for (const value of ends(path.getAttribute('d') ?? '')) {
        expect(Math.abs(value * 10 - Math.round(value * 10))).toBeLessThan(1e-6);
      }
    }
    // The station's size is the design's, live: a slider in the dev panel shows at once.
    state.stop = 7;
    leaders.frameUpdate();
    expect(svg.querySelector('.leader__stop')?.getAttribute('r')).toBe('7');
  });

  it('take their picture with them when the engine goes', () => {
    const { leaders, mount } = setup();
    leaders.frameUpdate();
    leaders.dispose();
    expect(mount.querySelector('svg')).toBeNull();
    expect(mount.querySelector('canvas')).not.toBeNull();
  });
});

describe('how the leaders look (global.css)', () => {
  const css = readFileSync(path.resolve('src/styles/global.css'), 'utf8');

  it('hides what the engine has not switched on, and takes no pointer', () => {
    expect(css).toMatch(/\.leaders:not\(\[data-shown\]\),\s*\.leader:not\(\[data-on\]\) \{/);
    expect(css).toMatch(/\.leaders \{[^}]*pointer-events: none;/);
  });

  it('draws a line in its body’s family and fills only the open card’s station with butter', () => {
    expect(css).toMatch(/\.leader__line \{[^}]*stroke: var\(--theme-base\);/);
    expect(css).toMatch(/\.leader\[data-open\] \.leader__stop \{\s*fill: var\(--color-focus\);/);
    // Whatever the world shows under them, the line and the butter dot meet the dark: a casing
    // under the line, and a rim round the dot that is painted before it.
    expect(css).toMatch(/\.leader__casing \{[^}]*stroke: var\(--color-space-950\);/);
    expect(css).toMatch(
      /\.leader\[data-open\] \.leader__stop \{[^}]*stroke: var\(--color-space-950\);[^}]*paint-order: stroke;/,
    );
    // Every class the engine writes has a rule: a renamed one would draw black hairlines.
    for (const name of ['leaders', 'leader', 'leader__casing', 'leader__line', 'leader__stop']) {
      expect(css).toContain(`.${name}`);
    }
  });
});
