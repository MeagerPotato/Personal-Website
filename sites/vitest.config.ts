import { defineConfig } from 'vitest/config';

// One test run for the whole workspace, in Node: crypto, sync, rendering, tokens, and the Workers'
// APIs against a local D1 and R2. What needs a real browser is in each app's Playwright tests.
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'packages/*/src/**/*.test.{ts,tsx}',
      'blog/src/**/*.test.{ts,tsx}',
      'journal/src/**/*.test.{ts,tsx}',
      'journal/worker/**/*.test.ts',
    ],
    testTimeout: 30_000,
  },
});
