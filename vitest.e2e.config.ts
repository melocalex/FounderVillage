import { defineConfig } from 'vitest/config';

// Surfpool suites run one at a time, each owning its own embedded surfnet.
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
