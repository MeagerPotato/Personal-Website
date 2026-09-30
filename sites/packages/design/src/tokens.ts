/**
 * DESIGN TOKENS for the subdomain sites (blog.allenkh.com, journal.allenkh.com).
 *
 * The look is "Notion, in allenkh.com's colours": Notion's quiet layout and gray UI, set in
 * Outfit, with the main site's pastel families for tags, callouts and moods. Two themes share
 * every key:
 *
 *   day    warm paper with navy ink (the default)
 *   night  allenkh.com itself: navy space, cream ink (prefers-color-scheme: dark, or chosen)
 *
 * ONE PALETTE EVERYWHERE. Whatever the main site already defines is imported from its token file
 * (src/universe/design/tokens.ts), never copied: the families, the navy ramp, the inks of the
 * night theme, the typeface, the type scale, spacing, radii and motion. This file only adds what
 * the main site has no use for: the paper surfaces and the inks that read on them. A hex colour
 * anywhere else under sites/ is a bug.
 *
 * Values are free to change; keys are API (CSS reads them as custom properties, see css.ts).
 * contrast.test.ts measures every pairing the stylesheets rely on.
 */
import { tokens as site } from '../../../../src/universe/design/tokens.ts';

const { system } = site.color;

/** The five pastel families, in the order the site's legend lists them. */
export const FAMILY_KEYS = ['coral', 'butter', 'mint', 'sky', 'lilac'] as const;
export type FamilyKey = (typeof FAMILY_KEYS)[number];

/**
 * Per theme, per family:
 *   base  the family's own colour, for glyphs, dots, fills and chart marks (never text)
 *   tint  a quiet wash behind a tag, a callout or a selected row (text on it is `ink` or ink.high)
 *   ink   the family as TEXT on the theme's page and on its own tint (4.5:1 or more)
 */
interface Family {
  readonly base: string;
  readonly tint: string;
  readonly ink: string;
}

interface Theme {
  /** The page. */
  readonly bg: string;
  /** Recessed: the sidebar, code blocks, a plain callout, an input's well. */
  readonly sunken: string;
  /** Raised: menus, popovers, cards, the editor's toolbars. */
  readonly raised: string;
  /** Under the pointer, or the row a menu has selected. */
  readonly hover: string;
  /** Hairlines and dividers. */
  readonly line: string;
  /** Borders that must be seen: an input, a card's edge, a table's grid. */
  readonly lineStrong: string;
  readonly ink: {
    /** Titles, body text, anything read. */
    readonly high: string;
    /** Secondary text: dates, captions, properties. */
    readonly mid: string;
    /** Tertiary text and icons: placeholders, hints, counts. Still AA on the page. */
    readonly low: string;
    /** Never text: disabled marks, the track of an empty bar. */
    readonly faint: string;
  };
  /** Links and interactive text. */
  readonly accent: string;
  /** BUTTER MEANS "HERE" (docs/DESIGN.md): the focus halo, the current item, today. */
  readonly focus: string;
  /** The rim inside the focus halo, so the ring reads on any surface. */
  readonly focusRim: string;
  /** Text selection. */
  readonly selection: string;
  /** Glyphs and text drawn ON a family's base colour (a mood bean's face): navy in both themes. */
  readonly onFamily: string;
  readonly family: Readonly<Record<FamilyKey, Family>>;
}

const day: Theme = {
  bg: '#fcfbf8',
  sunken: '#f5f3ee',
  raised: '#ffffff',
  hover: '#efece5',
  line: '#e7e3da',
  lineStrong: '#cfc9bc',
  ink: {
    high: '#161c30',
    mid: '#454d66',
    low: '#626a84',
    faint: '#b9bdc9',
  },
  accent: '#2a6598',
  focus: system.butter.base,
  focusRim: '#161c30',
  selection: system.butter.light,
  onFamily: site.color.space[900],
  family: {
    coral: { base: system.coral.base, tint: '#fbe6e2', ink: '#a3463d' },
    butter: { base: system.butter.base, tint: '#fcf1d6', ink: '#7c5f0e' },
    mint: { base: system.mint.base, tint: '#e4f5e8', ink: '#2e7443' },
    sky: { base: system.sky.base, tint: '#e2eefb', ink: '#2a6598' },
    lilac: { base: system.lilac.base, tint: '#efe6f4', ink: '#6c4a82' },
  },
};

const night: Theme = {
  bg: site.color.space[900],
  sunken: site.color.space[950],
  raised: site.color.surface.panel,
  hover: site.color.surface.raised,
  line: '#1b2443',
  lineStrong: site.color.surface.line,
  ink: {
    high: site.color.ink.high,
    mid: site.color.ink.mid,
    low: site.color.ink.low,
    faint: '#3a4670',
  },
  accent: site.color.accent,
  focus: site.color.focus,
  focusRim: site.color.space[950],
  selection: '#3b3a2e',
  onFamily: site.color.space[900],
  family: {
    coral: { base: system.coral.base, tint: '#2c2231', ink: system.coral.light },
    butter: { base: system.butter.base, tint: '#2d2c2c', ink: system.butter.light },
    mint: { base: system.mint.base, tint: '#1f2e33', ink: system.mint.light },
    sky: { base: system.sky.base, tint: '#18284a', ink: system.sky.light },
    lilac: { base: system.lilac.base, tint: '#22203f', ink: system.lilac.light },
  },
};

export const themes = { day, night } as const;
export type ThemeKey = keyof typeof themes;

/** Everything that is the same in both themes, straight from the main site. */
export const shared = {
  font: {
    ...site.font,
    /** Long-form reading (posts, journal entries): the same face; one family keeps pages calm. */
    prose: site.font.body,
  },
  text: site.text,
  space: site.space,
  radius: site.radius,
  motion: site.motion,
  /**
   * Fixed sizes for app chrome and pages that work like Notion's (the journal, the blog's studio,
   * and the blog's reading column): an app does not scale its text with the window the way the
   * main site's pages do (their fluid scale is `text`).
   */
  ui: {
    xs: '0.75rem',
    sm: '0.875rem',
    base: '1rem',
    md: '1.0625rem',
    lg: '1.25rem',
    xl: '1.5rem',
    xxl: '1.875rem',
    title: '2.5rem',
  },
  /** Column widths. Notion's page is 708 px wide; ours breathes a little more for Outfit. */
  measure: {
    page: '45rem',
    wide: '62rem',
    full: '90rem',
  },
} as const;
