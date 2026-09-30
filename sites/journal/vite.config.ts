import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { appIcons } from '@allenkh/design/pwa';
import { designTokens } from '@allenkh/design/vite';

// The repository root: the design tokens import the main site's palette from there.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/** Replaces a statement that must appear exactly once, so a moved placeholder fails the build. */
function replaceOnce(code: string, statement: string, replacement: string): string {
  const parts = code.split(statement);
  if (parts.length !== 2) throw new Error(`sw/sw.js must contain \`${statement}\` exactly once`);
  return parts.join(replacement);
}

/**
 * Emits sw.js with this build's file list written in (sw/sw.js explains the caching). The build
 * id is a hash of that list, so a new deploy is a new cache and an unchanged one is not.
 */
function serviceWorker(): Plugin {
  const source = fileURLToPath(new URL('./sw/sw.js', import.meta.url));
  return {
    name: 'journal-service-worker',
    enforce: 'post',
    applyToEnvironment: (environment) => environment.name === 'client',
    generateBundle(_options, bundle) {
      // Everything the host serves, except the page itself (cached as '/') and files it keeps to
      // itself (_headers; .assetsignore, which lists what is never uploaded): one missing file
      // and the whole install fails.
      const files = Object.keys(bundle)
        .filter(
          (file) => !file.endsWith('.map') && file !== 'index.html' && !/(^|\/)[._]/.test(file),
        )
        .map((file) => `/${file}`);
      const precache = ['/', ...files].sort();
      const build = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12);
      let code = readFileSync(source, 'utf8');
      code = replaceOnce(
        code,
        "const BUILD = '__BUILD__';",
        `const BUILD = ${JSON.stringify(build)};`,
      );
      code = replaceOnce(
        code,
        'const PRECACHE = /** @type {string[]} */ (self.__PRECACHE__);',
        `const PRECACHE = ${JSON.stringify(precache)};`,
      );
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: code });
    },
  };
}

export default defineConfig({
  // `vite dev` runs the Worker in workerd (Cloudflare's runtime) with local D1 and R2, so the
  // API behaves in development exactly as it will on journal.allenkh.com.
  plugins: [
    react(),
    cloudflare(),
    designTokens(),
    appIcons({
      mark: 'journal',
      name: 'Allen’s journal',
      shortName: 'Journal',
      description: 'A private, end-to-end encrypted journal.',
      manifest: true,
    }),
    serviceWorker(),
  ],
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [repoRoot] },
  },
  build: {
    // Source maps would publish the source; the repository is public anyway, but the app should
    // not need them to run, and a smaller dist is easier to audit.
    sourcemap: false,
  },
});
