import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The journey-time harness only (journeys.measure.ts explains it). Its files end in .measure.ts,
// which the main vitest.config.ts never includes, so `npm test` and `npm run verify` stay fast.
export default defineConfig({
  test: {
    root: fileURLToPath(new URL('../..', import.meta.url)),
    environment: 'node',
    include: ['scripts/journeys/**/*.measure.ts'],
    // Thousands of simulated journeys: minutes, not seconds. A hang is still caught.
    testTimeout: 3_600_000,
    // Print as it goes, not only at the end.
    silent: false,
    reporters: ['default'],
  },
});
