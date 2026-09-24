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
    const HUD_CONTROL =
      /\.(map-toggle|dock-prompt|body-label|touch-boost|mode-link|wordmark|panel-button|site-nav)\b/;
    const offenders: string[] = [];
    for (const [, selector = '', body = ''] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (HUD_CONTROL.test(selector) && /(^|;)\s*color:\s*var\(--color-ink-low\)/.test(body)) {
        offenders.push(selector.trim());
      }
    }
    expect(offenders).toEqual([]);
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
      // Route lines, stations, glyphs and the panel's band are marks: 3:1 against what they cross.
      expect(contrast(family.base, color.space[900])).toBeGreaterThanOrEqual(MARK);
      expect(contrast(family.base, color.surface.panel)).toBeGreaterThanOrEqual(MARK);
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
  });
});
