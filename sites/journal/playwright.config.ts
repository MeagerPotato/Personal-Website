import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// End-to-end tests (tests/e2e): Chromium against the REAL build, served by `wrangler dev` the way
// Cloudflare will serve it: the Worker, D1 and R2 in workerd, and public/_headers applied, so the
// CSP is part of what is tested (the Vite dev server applies no headers at all).
//
//   npm run e2e --workspace=journal      build, then the tests
//
// Chromium only: passkeys need a virtual authenticator with the PRF extension, which only the
// Chrome DevTools protocol offers. Safari's side is checked by hand on a real iPhone.
//
// Not part of `npm run verify`, like the main site's e2e: CI runs it as a job of its own.

const PORT = 8790;
// HTTPS (wrangler's self-signed certificate): the CSP says `upgrade-insecure-requests`. And
// `localhost`, not 127.0.0.1: a passkey's relying party must be a domain name, never an address.
const ORIGIN = `https://localhost:${PORT}`;
const CI = Boolean(process.env.CI);
const vars = fileURLToPath(new URL('./tests/e2e/e2e.env', import.meta.url));

export default defineConfig({
  testDir: 'tests/e2e',
  // One journal per server, set up by the first test and used by the rest, in order.
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
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        // ignoreHTTPSErrors lets pages load over wrangler's self-signed certificate, but Chrome
        // still refuses to register a service worker from it ("An SSL certificate error occurred
        // when fetching the script"). This flag is what lets the offline test install the app.
        launchOptions: { args: ['--ignore-certificate-errors'] },
      },
    },
  ],
  webServer: {
    // A fresh database and bucket every run (.wrangler/e2e), and the e2e values for the Worker's
    // variables (with --env-file, wrangler reads no .dev.vars). The upstream is the page's own
    // origin: wrangler's proxy rewrites the Origin header from its address to the upstream's, and
    // the Worker refuses a write whose Origin is not ORIGIN.
    command: [
      `node -e "require('fs').rmSync('.wrangler/e2e',{recursive:true,force:true})"`,
      [
        `npx wrangler dev --port ${PORT} --ip 127.0.0.1 --local-protocol https`,
        `--local-upstream localhost:${PORT} --upstream-protocol https`,
        `--persist-to .wrangler/e2e --env-file "${vars}" --show-interactive-dev-session=false`,
      ].join(' '),
    ].join(' && '),
    // Asked of 127.0.0.1: Node may try ::1 first for "localhost", where nothing listens.
    url: `https://127.0.0.1:${PORT}/`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: process.env.E2E_SERVER_LOG ? 'pipe' : 'ignore',
    timeout: 120_000,
    env: { WRANGLER_SEND_METRICS: 'false' },
  },
});
