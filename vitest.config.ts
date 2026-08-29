import { readFileSync } from 'node:fs';
import { defaultExclude, defineConfig } from 'vitest/config';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

/**
 * Mirrors tsup's define (tsup.config.ts) so tests see the same
 * __PLANDROP_VERSION__ literal (src/version.d.ts) the built bundle carries,
 * without a real build step.
 *
 * A project does not inherit the root config's define, and Vite resolves the
 * object it is given in place, so each project is handed a fresh one. Sharing
 * a single object between the two leaves whichever resolves second without the
 * literal, and its tests fail with a bare `__PLANDROP_VERSION__ is not defined`.
 */
const define = (): Record<string, string> => ({
  __PLANDROP_VERSION__: JSON.stringify(version),
});

/**
 * The test files that drive the throwaway Apache + ingress + control stack:
 * each one calls `inject()` for the fixture `test/setup/stack.ts` provides.
 * They are named here rather than matched by filename because the dependency
 * is on the fixture, not on what a file happens to be called.
 *
 * Everything not listed runs in the `unit` project, which has no globalSetup
 * and so needs no Docker. Adding a file here is what buys it the stack; a new
 * test that calls `inject()` without being listed fails on an absent fixture.
 */
const STACK_TESTS = [
  'test/apache.test.ts',
  'test/client-create.test.ts',
  'test/client-manage.test.ts',
  'test/control.test.ts',
  'test/phase3-stack.test.ts',
  'test/proxy-routing.test.ts',
  'test/templates-stack.test.ts',
];

export default defineConfig({
  test: {
    projects: [
      {
        define: define(),
        test: {
          name: 'unit',
          include: ['test/**/*.test.ts'],
          exclude: [...defaultExclude, ...STACK_TESTS],
          // The npx PoC test builds + packs in a hook and shells out to npx.
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
      {
        define: define(),
        test: {
          name: 'stack',
          include: STACK_TESTS,
          // Brings up the throwaway stack (Apache + ingress + control plane)
          // over an ephemeral data dir and tears it down after the run.
          // Requires Docker.
          globalSetup: ['./test/setup/stack.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
