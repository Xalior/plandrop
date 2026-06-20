import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Brings up a throwaway Apache mod_dav container over an ephemeral data dir
    // and tears it down after the run. Requires Docker.
    globalSetup: ['./test/setup/apache.ts'],
    // The npx PoC test builds + packs in a hook and shells out to npx; the
    // global setup pulls/starts a container.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
