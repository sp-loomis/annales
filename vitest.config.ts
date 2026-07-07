import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Shared test DB + bucket — files must not interleave.
    fileParallelism: false,
    globalSetup: './tests/global-setup.ts',
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
