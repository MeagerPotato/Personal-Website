import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import a11y from 'eslint-plugin-jsx-a11y-x';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Lint for everything under sites/. Type-aware rules stay off: `tsc` owns types (npm run
// typecheck). ESLint owns style and the boundaries listed at the bottom.
//
// FLAT-CONFIG GOTCHA (the same as the main site's): when two blocks set the same rule for the same
// file, the later block REPLACES the earlier one; options never merge.

export default defineConfig(
  globalIgnores([
    '**/dist/',
    '**/.astro/',
    '**/.wrangler/',
    '**/node_modules/',
    '**/coverage/',
    '**/playwright-report/',
    '**/test-results/',
    '**/worker-configuration.d.ts',
  ]),

  js.configs.recommended,
  ...tseslint.configs.strict,

  // --- React ------------------------------------------------------------------------------------
  // The rules of hooks, with the React Compiler's checks (they find components and hooks by name,
  // so they are safe everywhere), and accessibility wherever there is JSX.
  { files: ['**/*.{ts,tsx}'], ...reactHooks.configs.flat['recommended-latest'] },
  { files: ['**/*.tsx'], ...a11y.configs.recommended },

  // --- Environments -----------------------------------------------------------------------------
  // (TypeScript files need none: tsc knows their globals, and typescript-eslint turns no-undef off.)
  {
    files: ['**/*.config.{js,mjs,ts}', '.prettierrc.mjs', '**/scripts/**'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // The journal's service worker: plain JavaScript, copied into the build by its vite.config.ts.
    files: ['journal/sw/**'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },

  prettier,
);
