import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// "Thin Astro" (docs/PLAN.md §5.1): Astro pre-renders real HTML pages and owns the content
// layer. It does not own navigation, client code, or the engine. Keep this file boring.
export default defineConfig({
  site: 'https://allenkh.com',
  output: 'static',

  // Documented pairing; matches Cloudflare's auto-trailing-slash (/about -> 307 -> /about/).
  trailingSlash: 'always',
  build: {
    format: 'directory',
    // One predictable stylesheet <link> per page keeps the router's head sync trivial.
    inlineStylesheets: 'never',
  },

  // Explicit: the v7 default ('jsx') can glue words together across line breaks.
  compressHTML: true,

  integrations: [sitemap()],

  vite: {
    build: {
      // Never inline scripts or assets as data: keeps "one inline script" true for the CSP.
      assetsInlineLimit: 0,
      // The engine is ONE deliberate lazy chunk and three.js alone is ~530 kB before compression,
      // so Vite's 500 kB warning would cry wolf on every build. The real budgets are enforced
      // in gzip bytes by scripts/verify-dist.mjs.
      chunkSizeWarningLimit: 700,
    },
  },
});
