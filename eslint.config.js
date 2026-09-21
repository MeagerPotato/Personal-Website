import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// Type-aware rules are deliberately off: `astro check` owns types. ESLint owns style and, more
// importantly, the ARCHITECTURE BOUNDARIES at the bottom (docs/PLAN.md §5.1, §5.3, §5.5).
//
// FLAT-CONFIG GOTCHA: when two blocks set the same rule for the same file, the later block
// REPLACES the earlier one; options are never merged. So every boundary block below lists the
// COMPLETE set of restrictions for its files, composed from these shared pieces, and blocks run
// from general to specific. tests/lint-boundaries.test.ts proves each boundary still bites.

const FRAMEWORK_IMPORTS = {
  group: ['astro', 'astro:*', 'astro/*', '@astrojs/*'],
  message: 'The engine must stay framework-free (docs/PLAN.md §5.5).',
};
const WEB_LAYER_IMPORTS = {
  group: ['**/shell/**', '**/site/**', '**/pages/**', '**/layouts/**', '**/components/**'],
  message: 'The engine must not import from the web layer. The web layer talks to it via api.ts.',
};
const THREE_IMPORTS = {
  group: ['three', 'three/*'],
  message: 'sim/ and data/ are plain math: no three.js.',
};
const ASTRO_VIRTUAL_IMPORTS = {
  group: ['astro:*'],
  message:
    'Keep client and site logic framework-neutral; astro:* belongs in pages/layouts/components.',
};

const HISTORY_WRITES = ['pushState', 'replaceState'].map((property) => ({
  object: 'history',
  property,
  message: 'Only the router owns history (docs/PLAN.md §5.3).',
}));
const NONDETERMINISM = [
  {
    object: 'Math',
    property: 'random',
    message: 'Use the seeded PRNG (sim/rng.ts) so layouts and sims are reproducible.',
  },
  { object: 'Date', property: 'now', message: 'Pure code must not read the clock.' },
];

export default defineConfig(
  globalIgnores([
    'dist/',
    '.astro/',
    '.wrangler/',
    'node_modules/',
    'coverage/',
    'playwright-report/',
  ]),

  js.configs.recommended,
  ...tseslint.configs.strict,
  ...astro.configs.recommended,
  ...astro.configs['jsx-a11y-recommended'],

  // --- Environments ----------------------------------------------------------------------------
  {
    files: ['src/shell/**', 'src/universe/**'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['scripts/**', '*.config.{js,mjs,ts}', '.prettierrc.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Shipped verbatim as the one inline <script>; written in ES5 on purpose so that even a
    // very old browser parses it and lands in plain mode instead of throwing.
    files: ['src/shell/mode.inline.js'],
    languageOptions: { ecmaVersion: 5, sourceType: 'script', globals: { ...globals.browser } },
    rules: {
      // ES5 has no optional catch binding: `catch (error)` must name a variable it never reads.
      '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'none' }],
    },
  },

  // --- Boundaries, general -> specific (see the gotcha above) -----------------------------------

  // Everywhere: only the router may write history.
  {
    files: ['src/**/*.ts'],
    ignores: ['src/shell/router.ts'],
    rules: { 'no-restricted-properties': ['error', ...HISTORY_WRITES] },
  },

  // Client and site logic stay framework-neutral ("thin Astro").
  {
    files: ['src/shell/**/*.ts', 'src/site/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [ASTRO_VIRTUAL_IMPORTS] }] },
  },

  // The engine is framework-free and knows nothing about the web layer.
  {
    files: ['src/universe/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [FRAMEWORK_IMPORTS, WEB_LAYER_IMPORTS] }],
    },
  },

  // data/ and sim/ are pure, deterministic, and headless: no DOM, no clock, no three.js.
  {
    files: ['src/universe/data/**/*.ts', 'src/universe/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [FRAMEWORK_IMPORTS, WEB_LAYER_IMPORTS, THREE_IMPORTS] },
      ],
      'no-restricted-properties': ['error', ...HISTORY_WRITES, ...NONDETERMINISM],
      'no-restricted-globals': [
        'error',
        { name: 'document', message: 'data/ and sim/ are pure: no DOM.' },
        { name: 'window', message: 'data/ and sim/ are pure: no DOM.' },
      ],
    },
  },

  prettier,
);
