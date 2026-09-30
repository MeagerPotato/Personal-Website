import { defineConfig, devices } from '@playwright/test';

// End-to-end tests (tests/e2e): real browsers against the REAL build, served the way Cloudflare
// will serve it (`wrangler dev` applies dist/_headers, so the CSP is part of what is tested).
//
//   npm run e2e            build, then every project
//   npx playwright test --project=webkit tests/e2e/router.spec.ts     one slice (build first)
//
// Not part of `npm run verify`: browsers are slow and occasionally flaky, and `verify` is the
// required check. CI runs this as its own, non-required job (.github/workflows/e2e.yml).

const PORT = 8799;
// HTTPS, with wrangler's self-signed certificate: the CSP says `upgrade-insecure-requests`, and
// WebKit honours that even on a loopback address, so over plain HTTP no stylesheet or script loads.
const ORIGIN = `https://127.0.0.1:${PORT}`;
const CI = Boolean(process.env.CI);

// Where the machine has a GPU, Chromium draws WebGL on it. Headless Chromium otherwise draws on
// the CPU (SwiftShader): one page of the universe kept about 7 cores busy at 14 frames a second,
// against a tenth of a core at 60 frames on the GPU (Windows, D3D11, measured 2026-09-30), and a
// local run starts a browser per worker. WebKit draws on the GPU already. CI has no GPU and keeps
// the software renderer, so every change is tested both ways; E2E_SOFTWARE_GL=1 does the same
// locally, to see what CI sees. Other platforms keep it too until someone measures them.
const GPU = !CI && !process.env.E2E_SOFTWARE_GL && process.platform === 'win32';
const chromiumOnGpu = GPU
  ? { launchOptions: { args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] } }
  : {};

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  // A CI runner has no GPU: every page renders WebGL on the CPU, and two at once is plenty.
  // Locally a quarter of the cores: on a 24-core machine drawing on the GPU, 6 workers ran the
  // whole suite in 76 s at 43% of the machine on average (peak 61%), where Playwright's default of
  // half the cores took 62 s at 70% (peak 97%) and more CPU time in all. The machine is also
  // someone's computer while it runs.
  workers: CI ? 2 : '25%',
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 90_000,
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
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        ...chromiumOnGpu,
      },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } },
    },
    // A phone: narrow, touch, coarse pointer. The bottom sheet instead of the side panel.
    { name: 'phone', use: { ...devices['Pixel 7'], ...chromiumOnGpu } },
  ],
  webServer: {
    // A server of its own, on a port of its own, started fresh: wrangler reads the asset manifest
    // once, so a server that was already running would serve the build before this one.
    command: `npx wrangler dev --port ${PORT} --ip 127.0.0.1 --local-protocol https --show-interactive-dev-session=false`,
    url: `${ORIGIN}/`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    // Silent unless asked: with a self-signed certificate workerd reports every connection a
    // browser opens as a TLS error, hundreds of lines that bury the test results. If the server
    // does not come up, run again with E2E_SERVER_LOG=1 to hear what it says.
    stdout: 'ignore',
    stderr: process.env.E2E_SERVER_LOG ? 'pipe' : 'ignore',
    timeout: 120_000,
    env: { WRANGLER_SEND_METRICS: 'false' },
  },
});
