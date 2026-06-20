import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The npx PoC test builds + packs in a hook and shells out to npx.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
