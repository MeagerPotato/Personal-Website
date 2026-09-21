import { defineConfig } from 'vitest/config';

// Deliberately plain `vitest/config`, NOT Astro's getViteConfig(): if a test for engine or
// site logic ever needs Astro to run, that code has broken the framework-free boundary.
export default defineConfig({
  test: {
    environment: 'node', // DOM tests opt in per file: // @vitest-environment happy-dom
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
