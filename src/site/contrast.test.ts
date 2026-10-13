import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEME_KEYS, tokens } from '../universe/design/tokens';
import { contrast, luminance, over } from './contrast';

// The colour pairings src/styles/global.css relies on, measured from the tokens. Change a colour
// and this says at once whether every pairing that uses it still passes WCAG AA: 4.5:1 for text,
// 3:1 for the edges and marks that make a control or a family visible. The plates' alphas are
// READ from the stylesheet's color-mix() percentages, so that thinning a plate is measured too;
// a plate over the 3D world is measured over white, the brightest thing it can sit on (a sun, a
// white peak, a pale ring).

const { color } = tokens;
const TEXT = 4.5;
const MARK = 3;
const WHITE = '#ffffff';

const CSS = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

/** How much of surface.panel a plate is, as the stylesheet mixes it (a share, 0 to 1). */
function plateAlpha(pattern: RegExp): number {
  const percent = CSS.match(pattern)?.[1];
  // A renamed property or a rewritten mix must fail here, not quietly measure an old number.
  if (percent === undefined) throw new Error(`global.css no longer matches ${pattern}`);
  return Number(percent) / 100;
}

const HUD_ALPHA = plateAlpha(/--hud: color-mix\(in srgb, var\(--color-surface-panel\) ([\d.]+)%/);
const PANEL_ALPHA = plateAlpha(
  /html\[data-mode='universe'\] \.panel \{[^}]*?background: color-mix\(in srgb, var\(--color-surface-panel\) ([\d.]+)%/,
);

/** --hud: the plate under every chip over the world. */
const HUD = over(color.surface.panel, HUD_ALPHA, WHITE);
/** The info panel over the world. */
const PANEL = over(color.surface.panel, PANEL_ALPHA, WHITE);
/** The solid surfaces text sits on, in either mode. */
const SURFACES = {
  'the page (space.900)': color.space[900],
  'a legend plate (surface.panel)': color.surface.panel,
  'a raised plate (surface.raised)': color.surface.raised,
  'the panel over white': PANEL,
};

describe('the maths', () => {
  it('matches WCAG at the ends and composites like a browser', () => {
    expect(contrast('#000000', WHITE)).toBeCloseTo(21, 5);
    expect(contrast(WHITE, WHITE)).toBe(1);
    expect(luminance('#000000')).toBe(0);
    expect(over('#000000', 0.5, WHITE)).toBe('#808080');
    expect(over(color.surface.panel, 1, WHITE)).toBe(color.surface.panel);
  });
});

describe('ink on every surface', () => {
  for (const [surface, hex] of Object.entries(SURFACES)) {
    it(`reads on ${surface}`, () => {
      expect(contrast(color.ink.high, hex)).toBeGreaterThanOrEqual(TEXT);
      expect(contrast(color.ink.mid, hex)).toBeGreaterThanOrEqual(TEXT);
      expect(contrast(color.ink.low, hex)).toBeGreaterThanOrEqual(TEXT);
      expect(contrast(color.accent, hex)).toBeGreaterThanOrEqual(TEXT);
    });
  }

  it('reads on the lit face of a raised key (surface.line)', () => {
    // The panel bar's Close and Expand, and the hint card's "Got it", under a mouse.
    expect(contrast(color.ink.high, color.surface.line)).toBeGreaterThanOrEqual(TEXT);
  });

  it('reads on the HUD plate over white: high, mid and butter', () => {
    expect(contrast(color.ink.high, HUD)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(color.ink.mid, HUD)).toBeGreaterThanOrEqual(TEXT);
    // The dock prompt's "Stop".
    expect(contrast(color.focus, HUD)).toBeGreaterThanOrEqual(TEXT);
  });

  it('is never ink.low on a chip over the world, while that falls short there', () => {
    if (contrast(color.ink.low, HUD) >= TEXT) return; // lightened enough: the rule may go
    // Every rule that styles something on the HUD plate (the engine's own controls, and the
    // page's controls that become chips over the world) must not set its text in ink.low.
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    // (The flight deck and the minimap's pill and chip are no controls, but they sit on the same
    // plate: the rule holds for them too. The minimap's ticks are ink.low, as marks: below.)
    // A block AND EVERY PART OF IT: `.minimap`, `.minimap__range small`, `.mode-link--to-plain`.
    // (`\b` alone stops at the block: no word ends between `minimap` and `__range`.)
    const HUD_CONTROL =
      /\.(map-toggle|dock-prompt|body-label|touch-boost|mode-link|wordmark|panel-button|site-nav|flight-deck|minimap)(\b|_)/;
    // Nor by another name: a property of its own that only hands ink.low on (the HUD plate's
    // edge, the minimap's ticks) is ink.low to this rule, wherever it is the colour of text.
    const handedOn = [...css.matchAll(/(--[\w-]+):\s*var\(--color-ink-low\)\s*;/g)].map(
      ([, name = '']) => name,
    );
    expect(handedOn).toContain('--minimap-tick');
    const INK_LOW = new RegExp(
      `(^|;)\\s*color:\\s*var\\((${['--color-ink-low', ...handedOn].join('|')})\\)`,
    );
    const offendersIn = (sheet: string): string[] => {
      const found: string[] = [];
      for (const [, selector = '', body = ''] of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (HUD_CONTROL.test(selector) && INK_LOW.test(body)) found.push(selector.trim());
      }
      return found;
    };
    expect(offendersIn(css)).toEqual([]);
    // And the rule bites: on a part of a block, by ink.low's own name and by one it is handed
    // on under; not on an edge in that colour, which is no text, nor on a class of another block.
    const tried = [
      '.minimap__range small { color: var(--color-ink-low); }',
      '.flight-deck__lamp { font-weight: 700; color: var(--minimap-tick); }',
      '.dock-prompt__note { border-color: var(--hud-edge); }',
      '.minimaps { color: var(--color-ink-low); }',
    ];
    expect(offendersIn(`${css}\n${tried.join('\n')}`)).toEqual([
      '.minimap__range small',
      '.flight-deck__lamp',
    ]);
  });

  it('reads on the cream "on" face of a toggle and on the butter of focus and targets', () => {
    expect(contrast(color.space[900], color.ink.high)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(color.space[900], color.focus)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(color.space[950], color.focus)).toBeGreaterThanOrEqual(TEXT);
  });
});

describe('every colour family', () => {
  for (const key of THEME_KEYS) {
    const family = color.system[key];
    it(`${key}: navy on its fills, its light on its tints, its marks on the navy`, () => {
      // The primary button (base) and its hover (light); the pressed boost pad is coral.
      expect(contrast(color.space[900], family.base)).toBeGreaterThanOrEqual(TEXT);
      expect(contrast(color.space[900], family.light)).toBeGreaterThanOrEqual(TEXT);
      // The route sign (10% tint on the page) and the tags (12% tint on a plate), in the family's
      // light; the facts' labels, in the same light, straight on the plate.
      expect(
        contrast(family.light, over(family.base, 0.1, color.space[900])),
      ).toBeGreaterThanOrEqual(TEXT);
      for (const plate of [color.surface.panel, color.surface.raised, PANEL]) {
        expect(contrast(family.light, over(family.base, 0.12, plate))).toBeGreaterThanOrEqual(TEXT);
        expect(contrast(family.light, plate)).toBeGreaterThanOrEqual(TEXT);
      }
      // Route lines, stations, glyphs and the panel's band are marks: 3:1 against what they cross,
      // on the page, on a plate, on the panel over the world, on a raised plate in the panel, and
      // on the HUD plate over the world (the glyph before a body's name, on its tag).
      for (const ground of [
        color.space[900],
        color.surface.panel,
        PANEL,
        color.surface.raised,
        HUD,
      ]) {
        expect(contrast(family.base, ground)).toBeGreaterThanOrEqual(MARK);
      }
    });
  }
});

describe('edges and rings', () => {
  it('outlines a secondary key plainly enough to see where it ends', () => {
    expect(contrast(color.ink.low, color.space[900])).toBeGreaterThanOrEqual(MARK);
    expect(contrast(color.ink.low, color.surface.panel)).toBeGreaterThanOrEqual(MARK);
  });

  it('draws the focus ring against the navy rim and the page', () => {
    expect(contrast(color.focus, color.space[950])).toBeGreaterThanOrEqual(MARK);
    expect(contrast(color.focus, color.space[900])).toBeGreaterThanOrEqual(MARK);
    expect(contrast(color.focus, HUD)).toBeGreaterThanOrEqual(MARK);
    // Round anything focusable in the panel, over the world and under prefers-contrast: more.
    expect(contrast(color.focus, PANEL)).toBeGreaterThanOrEqual(MARK);
    expect(contrast(color.focus, color.surface.panel)).toBeGreaterThanOrEqual(MARK);
  });

  it('draws a leader on a casing of its own, and its station as a ring on a disc', () => {
    // A leader crosses whatever the world shows, a white peak as well as the night sky: what its
    // line meets is its casing (space.950), in every family. So does the open card's butter dot.
    for (const key of THEME_KEYS) {
      expect(contrast(color.system[key].base, color.space[950])).toBeGreaterThanOrEqual(MARK);
    }
    expect(CSS).toMatch(/\.leader__casing \{[^}]*stroke: var\(--color-space-950\);/);
    // A station on the limb: a white ring round a navy disc. On the sky the ring is what shows,
    // on a pale ground the disc.
    expect(contrast(color.ink.high, color.space[900])).toBeGreaterThanOrEqual(MARK);
    expect(contrast(color.space[900], WHITE)).toBeGreaterThanOrEqual(MARK);
  });
});

describe('the flight deck', () => {
  // The ball is a globe of two solid halves, whatever is behind the plate: the sky half over the
  // ground half. What the stylesheet paints each with is READ from it, so that whichever two
  // navies it gives them are the ones measured (the sky is the lighter one, surface.line).
  const ramps: Record<string, Record<string, string>> = {
    space: color.space,
    surface: color.surface,
  };
  const face = (half: string): string => {
    const [, ramp = '', stop = ''] =
      CSS.match(
        new RegExp(`\\.flight-deck__${half} \\{\\s*fill: var\\(--color-(space|surface)-(\\w+)\\)`),
      ) ?? [];
    const hex = ramps[ramp]?.[stop];
    if (hex === undefined) throw new Error(`global.css no longer says what the ball's ${half} is`);
    return hex;
  };
  const HALVES = { sky: face('sky'), ground: face('ground') };

  for (const [half, hex] of Object.entries(HALVES)) {
    it(`draws every mark of the ball plainly on its ${half}`, () => {
      // N, E, S and W are letters; the nose, prograde and home are drawn in the same ink.
      expect(contrast(color.ink.high, hex)).toBeGreaterThanOrEqual(TEXT);
      // Meridians and the rim.
      expect(contrast(color.ink.low, hex)).toBeGreaterThanOrEqual(MARK);
      // The target, butter: "here".
      expect(contrast(color.focus, hex)).toBeGreaterThanOrEqual(MARK);
      // The horizon wears the family of the system the ship is in, and ink.mid between systems.
      for (const key of THEME_KEYS) {
        expect(contrast(color.system[key].base, hex), key).toBeGreaterThanOrEqual(MARK);
      }
      expect(contrast(color.ink.mid, hex)).toBeGreaterThanOrEqual(MARK);
    });
  }

  it('paints the sky lighter than the ground, and the horizon brighter than the hairlines', () => {
    expect(luminance(HALVES.sky)).toBeGreaterThan(luminance(HALVES.ground));
    expect(luminance(color.ink.mid)).toBeGreaterThan(luminance(color.ink.low));
    // (The stylesheet says which ink the horizon wears between systems.)
    expect(CSS).toMatch(/\.flight-deck__horizon \{\s*stroke: var\(--color-ink-mid\)/);
  });

  it('rims every mark in a navy darker than either half', () => {
    for (const hex of Object.values(HALVES)) {
      expect(luminance(color.space[950])).toBeLessThan(luminance(hex));
    }
    expect(contrast(color.ink.high, color.space[950])).toBeGreaterThanOrEqual(MARK);
    expect(contrast(color.focus, color.space[950])).toBeGreaterThanOrEqual(MARK);
  });

  it('reads its lamps, lit and off, and fills its arcs, on the plate over white', () => {
    // Off: ink.mid on the plate. Lit: navy on the cream face.
    expect(contrast(color.ink.mid, HUD)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(color.space[900], color.ink.high)).toBeGreaterThanOrEqual(TEXT);
    // The arcs' fill, and the throttle's coral while boosting.
    expect(contrast(color.ink.high, HUD)).toBeGreaterThanOrEqual(MARK);
    expect(contrast(color.system.coral.base, HUD)).toBeGreaterThanOrEqual(MARK);
  });
});

describe('the minimap', () => {
  // The face is a solid ground of its own, whatever is behind the plate. What the stylesheet
  // paints it with is READ from it, so that another ground would be measured too.
  const [, stop = ''] =
    CSS.match(/\.minimap__map \{[^}]*?background: var\(--color-space-(\w+)\)/) ?? [];
  const ground = (color.space as Record<string, string>)[stop];
  if (ground === undefined) throw new Error('global.css no longer says what the minimap lies on');

  it('draws every mark plainly on its ground', () => {
    // A sun, the home planet, a planet, a moon, a pin at the rim: each in its family.
    for (const key of THEME_KEYS) {
      expect(contrast(color.system[key].base, ground), key).toBeGreaterThanOrEqual(MARK);
    }
    // Planned work's dashed outline and the face's own rim; the ship, and the ring round what a
    // pointer aims at.
    expect(contrast(color.ink.low, ground)).toBeGreaterThanOrEqual(MARK);
    expect(contrast(color.ink.high, ground)).toBeGreaterThanOrEqual(MARK);
    // "Here": the ring round the body the ship is at or headed for, a journey's line, and its
    // clock on the rim.
    expect(contrast(color.focus, ground)).toBeGreaterThanOrEqual(MARK);
    // The navy rim under a mark is darker than the ground it parts the mark from.
    expect(luminance(color.space[950])).toBeLessThan(luminance(ground));
  });

  it('reads its N on the face', () => {
    // A letter, so held to what text is held to, in the ink the stylesheet gives it.
    expect(CSS).toMatch(/\.minimap__north \{\s*fill: var\(--color-ink-mid\)/);
    expect(contrast(color.ink.mid, ground)).toBeGreaterThanOrEqual(TEXT);
  });

  it('reads its pill and its chip on the plate over white', () => {
    // What the scope shows and the chip's word and unit (ink.mid), the body the pill names and
    // the chip's figures (ink.high), a journey's seconds (butter).
    expect(contrast(color.ink.mid, HUD)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(color.ink.high, HUD)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(color.focus, HUD)).toBeGreaterThanOrEqual(TEXT);
  });

  it('draws its ticks plainly on the plate over white', () => {
    // ink.low falls a hair short of text on this plate (above), and is never text on it; a tick
    // is a mark. The stylesheet hands it over as a colour of its own, not as `color`.
    expect(CSS).toMatch(/--minimap-tick: var\(--color-ink-low\)/);
    expect(contrast(color.ink.low, HUD)).toBeGreaterThanOrEqual(MARK);
  });
});

describe('primer, the clay of unbuilt work', () => {
  it('shows every lit stop but the sea as a shape against space, and keeps them in order', () => {
    // A planned body is carried by its lit side, its dashed ring and its crane; the sea stop is the
    // darkest lumps of clay on the far side, decorative (4.2:1). The rest are marks, 3:1 or more.
    const { primer } = color.biome;
    for (const stop of [primer.shore, primer.low, primer.high, primer.peak]) {
      expect(contrast(stop, color.space[900])).toBeGreaterThanOrEqual(MARK);
    }
    const ramp = [primer.sea, primer.shore, primer.low, primer.high, primer.peak].map(luminance);
    expect([...ramp].sort((a, b) => a - b)).toEqual(ramp);
    // Between ink.low and ink.mid, run a step darker and lighter: grey clay, never a family.
    expect(luminance(primer.low)).toBeGreaterThan(luminance(color.ink.low));
    expect(luminance(primer.high)).toBeLessThan(luminance(color.ink.mid));
  });
});
