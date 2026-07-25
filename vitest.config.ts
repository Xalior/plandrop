import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  // Mirrors tsup's define (tsup.config.ts) so tests see the same
  // __PLANDROP_VERSION__ literal (src/version.d.ts) the built bundle carries,
  // without a real build step.
  define: { __PLANDROP_VERSION__: JSON.stringify(version) },
  test: {
    include: ['test/**/*.test.ts'],
    // Brings up the throwaway stack (Apache + control plane) over an ephemeral
    // data dir and tears it down after the run. Requires Docker.
    globalSetup: ['./test/setup/stack.ts'],
    // The npx PoC test builds + packs in a hook and shells out to npx; the
    // global setup pulls/starts a container.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
