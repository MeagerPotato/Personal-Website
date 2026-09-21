import { defineConfig } from 'vitest/config';

// Deliberately plain `vitest/config`, NOT Astro's getViteConfig(): if a test for engine or
// site logic ever needs Astro to run, that code has broken the framework-free boundary.
export default defineConfig({
  test: {
    environment: 'node', // DOM tests opt in per file: // @vitest-environment happy-dom
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // Some tests are honest work (200 simulated journeys, 10,000 steps of a random pilot, ESLint
    // over a fixture): 1.6 s on a laptop, and past the default 5 s on a CI runner having a slow
    // day, which failed a required check for no reason. Everything here is deterministic and
    // CPU-bound, so the timeout only exists to catch a hang, and a hang is still caught.
    testTimeout: 30_000,
    environmentOptions: {
      // For the files that opt in. A test must never touch the network or leave its page, so the
      // simulated browser fetches no stylesheets or scripts and follows no links by itself.
      happyDOM: {
        url: 'https://allenkh.com/',
        settings: {
          disableCSSFileLoading: true,
          disableJavaScriptFileLoading: true,
          disableIframePageLoading: true,
          handleDisabledFileLoadingAsSuccess: true,
          navigation: {
            disableMainFrameNavigation: true,
            disableChildFrameNavigation: true,
            disableChildPageNavigation: true,
            // With navigation disabled, happy-dom would still rewrite location: not that either.
            disableFallbackToSetURL: true,
          },
        },
      },
    },
  },
});
