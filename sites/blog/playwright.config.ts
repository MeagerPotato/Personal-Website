import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// End-to-end tests (tests/e2e): Chromium against the REAL build, served by `wrangler dev` the way
// Cloudflare will serve it (the Worker, D1 and R2 in workerd, the Worker's own headers), so the
// CSP is part of what is tested: the dev server drops it (src/worker.ts).
//
//   npm run e2e --workspace=blog      build, then the tests
//
// Chromium only: the studio's passkeys come from a virtual authenticator, a DevTools feature.
// Not part of `npm run verify`: CI runs it as a job of its own.

// 8790 is the journal's, 8791 the main site's preview.
const PORT = 8792;
// HTTPS (wrangler's self-signed certificate), like the real site: the session cookie is
// __Host- and Secure. And `localhost`, not 127.0.0.1: a passkey's relying party must be a name.
const ORIGIN = `https://localhost:${PORT}`;
const CI = Boolean(process.env.CI);
const vars = fileURLToPath(new URL('./tests/e2e/e2e.env', import.meta.url));

export default defineConfig({
  testDir: 'tests/e2e',
  // One blog per server, set up by the first test and used by the rest, in order.
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: ORIGIN,
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    // The build's own Worker config (the adapter points wrangler at dist/server/wrangler.json),
    // a fresh database and bucket every run (.wrangler/e2e), and the e2e values for the Worker's
    // variables (with --env-file, wrangler reads no .dev.vars). The upstream is the page's own
    // origin: wrangler's proxy rewrites the Origin header to it, and the Worker refuses a write
    // whose Origin is not ORIGIN.
    command: [
      `node -e "require('fs').rmSync('.wrangler/e2e',{recursive:true,force:true})"`,
      [
        `npx wrangler dev --port ${PORT} --ip 127.0.0.1 --local-protocol https`,
        `--local-upstream localhost:${PORT} --upstream-protocol https`,
        `--persist-to .wrangler/e2e --env-file "${vars}" --show-interactive-dev-session=false`,
      ].join(' '),
    ].join(' && '),
    // Asked of 127.0.0.1: Node may try ::1 first for "localhost", where nothing listens.
    url: `https://127.0.0.1:${PORT}/robots.txt`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: process.env.E2E_SERVER_LOG ? 'pipe' : 'ignore',
    timeout: 120_000,
    env: { WRANGLER_SEND_METRICS: 'false' },
  },
});
