import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The star map's names over whole turns only (sweep.measure.ts explains it). Its file ends in
// .measure.ts, which the main vitest.config.ts never includes, so `npm test` and `npm run verify`
// stay fast: they run the samples (checks.ts).
export default defineConfig({
  test: {
    root: fileURLToPath(new URL('../..', import.meta.url)),
    environment: 'node', // The sweep opts in to happy-dom, as the samples do.
    include: ['tests/map-names/**/*.measure.ts'],
    // Whole turns: minutes, not seconds. A hang is still caught.
    testTimeout: 3_600_000,
    // Print as it goes, not only at the end.
    silent: false,
    reporters: ['default'],
    environmentOptions: {
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
            disableFallbackToSetURL: true,
          },
        },
      },
    },
  },
});
