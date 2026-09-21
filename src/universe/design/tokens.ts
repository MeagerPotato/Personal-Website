/**
 * DESIGN TOKENS: the single source of truth for colour, type, space and motion.
 *
 * Pure data with NO imports, so everything can read it: the engine, the Astro shell, the content
 * schemas, and tests. `src/site/tokens-css.ts` mirrors it into CSS custom properties
 * (`color.ink.high` -> `--color-ink-high`), so the 3D world and the DOM always share one palette.
 * The engine renders with NoToneMapping, so a fully lit facet shows EXACTLY the hex written here.
 *
 * DESIGN SURFACE (docs/PLAN.md §5.6): values are free to change. Keys are API: renaming one is a
 * logic change, and TypeScript will point at every user. All values are CSS-ready strings.
 */
export const tokens = {
  color: {
    /** Backdrop ramp, deepest to lightest. Space is navy, never pure black. */
    space: {
      950: '#060914',
      900: '#0a0f1f',
      800: '#0f1630',
      700: '#172042',
      600: '#222d57',
    },
    /**
     * Text on space/surface. Measured WCAG contrast on space.900: high 17.2, mid 10.6, low 6.0.
     * Worst case is `low` on surface.raised at 4.8, still above AA (4.5). Re-measure if you change
     * either side.
     */
    ink: {
      high: '#f1f3fb',
      mid: '#b9c1dc',
      low: '#8690b3',
    },
    /** Panels, cards, hairlines. */
    surface: {
      panel: '#121a36',
      raised: '#1a2447',
      line: '#2c3a6b',
    },
    /**
     * One pastel family per solar system (Mini Motorways: muted, slightly desaturated).
     * base = lit surfaces and labels, light = highlights, shade = the tinted shadow side.
     */
    system: {
      coral: { base: '#f2a097', light: '#f9cdc7', shade: '#c8766f' },
      butter: { base: '#f3d88a', light: '#f9ebbf', shade: '#c9ad5e' },
      mint: { base: '#9ed9c1', light: '#cdeee1', shade: '#6fb39a' },
      sky: { base: '#9ac4ee', light: '#cbe0f7', shade: '#6c9bcb' },
      lilac: { base: '#c3b0f0', light: '#e0d6f8', shade: '#9886c9' },
    },
    /**
     * Planet surfaces, lowest altitude to highest: sea, shore, low, high, peak. A project picks one
     * by name in its frontmatter (`planet.biome`). First-pass values; Astra's A2 pass refines them.
     */
    biome: {
      terra: { sea: '#7fb0dd', shore: '#f3e3b3', low: '#a8d8a0', high: '#7dbb8a', peak: '#f4f1ea' },
      tide: { sea: '#6c9bcb', shore: '#9ed9c1', low: '#cdeee1', high: '#f3d88a', peak: '#f9ebbf' },
      dune: { sea: '#c98f6b', shore: '#e0b184', low: '#f0cd9a', high: '#f6deb4', peak: '#fbeed2' },
      frost: { sea: '#8fb8e0', shore: '#b9d6f0', low: '#d9e9f7', high: '#eef5fb', peak: '#ffffff' },
      ember: { sea: '#f2a097', shore: '#c8766f', low: '#8a6a78', high: '#6f5a6e', peak: '#f9cdc7' },
      bloom: { sea: '#9886c9', shore: '#c3b0f0', low: '#e0d6f8', high: '#f9cdc7', peak: '#fff1d6' },
    },
    /**
     * How light falls in the 3D world. `shadow` MULTIPLIES a surface's colour on the side facing
     * away from its sun (white would mean no shading at all): cool and tinted, never black.
     */
    shading: {
      shadow: '#bbbfdd',
    },
    /** Interactive text and the keyboard focus ring. */
    accent: '#9ac4ee',
    focus: '#f3d88a',
    /** Starfield tints. */
    star: {
      warm: '#fff1d6',
      cool: '#d6e4ff',
      white: '#ffffff',
    },
  },

  font: {
    /**
     * ui-rounded gives SF Rounded on Apple devices for free. A1 chooses self-hosted faces: the
     * candidates are in public/fonts with an @font-face each (src/styles/global.css, section 0),
     * and a face is adopted by putting its family name FIRST in one of these stacks. A face that
     * no stack names is never downloaded.
     */
    body: "ui-rounded, 'SF Pro Rounded', 'Hiragino Maru Gothic ProN', 'Segoe UI', system-ui, sans-serif",
    /** Headings and the wordmark. The same as `body` until A1 decides otherwise. */
    display:
      "ui-rounded, 'SF Pro Rounded', 'Hiragino Maru Gothic ProN', 'Segoe UI', system-ui, sans-serif",
    mono: "ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace",
  },

  /** Fluid type scale: min at 360 px wide, max at ~1200 px. */
  text: {
    xs: 'clamp(0.75rem, 0.72rem + 0.12vw, 0.8125rem)',
    sm: 'clamp(0.875rem, 0.84rem + 0.15vw, 0.9375rem)',
    base: 'clamp(1rem, 0.96rem + 0.2vw, 1.125rem)',
    lg: 'clamp(1.25rem, 1.15rem + 0.45vw, 1.5rem)',
    xl: 'clamp(1.75rem, 1.5rem + 1.1vw, 2.5rem)',
    display: 'clamp(2.25rem, 1.8rem + 2.2vw, 3.75rem)',
  },

  /**
   * The narrow end of the scale above, for a column that stays narrow however wide the window is
   * (the info panel in universe mode). Keep each value equal to the first number of its clamp().
   */
  textNarrow: {
    xs: '0.75rem',
    sm: '0.875rem',
    base: '1rem',
    lg: '1.25rem',
    xl: '1.75rem',
    display: '2.25rem',
  },

  space: {
    1: '0.25rem',
    2: '0.5rem',
    3: '0.75rem',
    4: '1rem',
    6: '1.5rem',
    8: '2rem',
    12: '3rem',
    16: '4rem',
    24: '6rem',
  },

  radius: {
    sm: '0.375rem',
    md: '0.75rem',
    lg: '1.25rem',
    pill: '999px',
  },

  /** DOM motion only. Engine timings (camera blends, flight) live in tuning.ts, in seconds. */
  motion: {
    fast: '120ms',
    base: '240ms',
    slow: '480ms',
    easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
    easeInOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  },
} as const;

export type Tokens = typeof tokens;

/** Colour families a solar system can choose in its frontmatter (`theme:`). */
export type ThemeKey = keyof Tokens['color']['system'];
export const THEME_KEYS = Object.keys(tokens.color.system) as [ThemeKey, ...ThemeKey[]];

/** Planet surface palettes a project can choose in its frontmatter (`planet.biome`). */
export type BiomeKey = keyof Tokens['color']['biome'];
export const BIOME_KEYS = Object.keys(tokens.color.biome) as [BiomeKey, ...BiomeKey[]];
