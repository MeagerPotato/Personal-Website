import { defineConfig } from 'vitest/config';

// One test run for the whole workspace. Pure logic (crypto, sync, rendering, tokens) runs in
// Node; a test that needs a DOM opts in per file with `// @vitest-environment happy-dom`.
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
