import { defineConfig } from 'vitest/config';

// Deliberately plain `vitest/config`, NOT Astro's getViteConfig(): if a test for engine or
// site logic ever needs Astro to run, that code has broken the framework-free boundary.
export default defineConfig({
  test: {
    environment: 'node', // DOM tests opt in per file: // @vitest-environment happy-dom
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
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
