// @ts-check
// JavaScript on purpose. Astro imports a .mjs config with Node itself (Node 24 runs the design
// package's TypeScript as it is), but a .ts config through a Vite of its own, which reads the
// tsconfig nearest each file: for the two files the design package imports from the main site,
// the repository root's. That one extends Astro's, which is not installed where only sites/ is
// (CI, Workers Builds), so the build would fail there and nowhere else.
import cloudflare from '@astrojs/cloudflare';
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';
import { appIcons } from '@allenkh/design/pwa';
import { designTokens } from '@allenkh/design/vite';

// The repository root: the design tokens import the main site's palette from there.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

// blog.allenkh.com: every page is rendered by the Worker from D1 (src/worker.ts puts the API and
// the media in front of Astro). No islands: the studio is one React app started by an ordinary
// bundled script, so the pages carry no inline script and the CSP needs no exceptions.
export default defineConfig({
  site: 'https://blog.allenkh.com',
  output: 'server',
  adapter: cloudflare({
    // Images are the studio's uploads in R2, sized on the device (src/server/media.ts): Astro's
    // own image pipeline has nothing to do, and would want an Images binding.
    imageService: 'passthrough',
  }),
  // No Astro sessions (the studio has its own, in D1): so no KV namespace to provision.
  session: false,
  trailingSlash: 'always',
  build: {
    format: 'directory',
    // Stylesheets as files, never inlined: the CSP allows no inline style (style-src 'self').
    inlineStylesheets: 'never',
  },
  devToolbar: { enabled: false },
  // 4321 is the main site's dev server; .dev.vars.example's ORIGIN names this one.
  server: { port: 4322 },
  vite: {
    // Every file compiles with this app's tsconfig, including the two the design package imports
    // from the main site (see journal/vite.config.ts for why).
    tsconfig: 'tsconfig.json',
    plugins: [
      designTokens(),
      appIcons({
        mark: 'blog',
        name: 'Allen Hsieh',
        shortName: 'Blog',
        description: 'Allen’s blog.',
      }),
    ],
    build: {
      // Scripts as files too, however small (script-src 'self').
      assetsInlineLimit: 0,
    },
    server: {
      fs: { allow: [repoRoot] },
    },
  },
});
