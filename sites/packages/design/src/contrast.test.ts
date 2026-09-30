import { describe, expect, it } from 'vitest';
// The main site's WCAG helper: one implementation of the maths for every site.
import { contrast } from '../../../../src/site/contrast';
import { FAMILY_KEYS, themes } from './tokens.ts';

// Every colour pairing the stylesheets rely on, in both themes: 4.5:1 for text (WCAG AA), 3:1 for
// the marks and edges that carry meaning (a focus rim, an input's border). Change a colour and
// this says at once whether everything that uses it still reads.

const TEXT = 4.5;
const MARK = 3;

describe.each(Object.entries(themes))('the %s theme', (_name, theme) => {
  const surfaces = {
    bg: theme.bg,
    sunken: theme.sunken,
    raised: theme.raised,
    hover: theme.hover,
  };

  it.each(Object.entries(surfaces))('text of every weight reads on %s', (_surface, surface) => {
    expect(contrast(theme.ink.high, surface)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(theme.ink.mid, surface)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(theme.ink.low, surface)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(theme.accent, surface)).toBeGreaterThanOrEqual(TEXT);
  });

  it('the focus rim stands out from every surface', () => {
    for (const surface of Object.values(surfaces)) {
      expect(
        contrast(theme.focusRim, surface) >= MARK || contrast(theme.focus, surface) >= MARK,
      ).toBe(true);
    }
  });

  it('a strong line is visible against the page', () => {
    // Not a WCAG requirement for decoration, but inputs and table grids must be findable.
    expect(contrast(theme.lineStrong, theme.bg)).toBeGreaterThanOrEqual(1.4);
  });

  it.each(FAMILY_KEYS)('%s: its ink reads on the page and on its own tint', (key) => {
    const family = theme.family[key];
    expect(contrast(family.ink, theme.bg)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(family.ink, family.tint)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(theme.ink.high, family.tint)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(theme.ink.mid, family.tint)).toBeGreaterThanOrEqual(TEXT);
  });

  it.each(FAMILY_KEYS)(
    '%s: its ink reads as code on a code block (highlighting, inline code)',
    (key) => {
      expect(contrast(theme.family[key].ink, theme.sunken)).toBeGreaterThanOrEqual(TEXT);
    },
  );

  it.each(FAMILY_KEYS)('%s: a face drawn on its base colour reads', (key) => {
    expect(contrast(theme.onFamily, theme.family[key].base)).toBeGreaterThanOrEqual(TEXT);
  });

  it('selected text stays readable', () => {
    expect(contrast(theme.ink.high, theme.selection)).toBeGreaterThanOrEqual(TEXT);
  });
});
