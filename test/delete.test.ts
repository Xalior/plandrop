import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run as del } from '../src/commands/delete';
import { commandText, usageLine } from '../src/usage';

/**
 * Argument handling only — reaching a real host is covered at the wire level
 * (test/webdav-wire.test.ts, test/webdav-map.test.ts) and in the stack suite.
 * Every case here returns before the command would touch the network.
 */

function captureStdout(): { text: () => string } {
  const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  return {
    text: () => {
      const written = spy.mock.calls.map((call) => String(call[0])).join('');
      spy.mockRestore();
      return written;
    },
  };
}

function captureStderr(): { text: () => string } {
  const spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  return {
    text: () => {
      const written = spy.mock.calls.map((call) => String(call[0])).join('');
      spy.mockRestore();
      return written;
    },
  };
}

describe('delete argument handling', () => {
  it('prints usage and exits 2 with no path given', async () => {
    const { text } = captureStderr();
    const code = await del({ command: 'delete', hashOverride: undefined, params: [] });
    expect(text()).toBe(`${usageLine('delete')}\n`);
    expect(code).toBe(2);
  });

  it('short-circuits on --help, printing the command usage', async () => {
    const { text } = captureStdout();
    const code = await del({ command: 'delete', hashOverride: undefined, params: ['--help'] });
    expect(text()).toBe(commandText('delete'));
    expect(code).toBe(0);
  });

  describe('with no .plandrop anywhere above the cwd', () => {
    let root: string;
    let cwd: string;

    beforeEach(() => {
      cwd = process.cwd();
      // realpath: macOS hands out a symlinked temp path, and findDotfile walks
      // up from the resolved cwd.
      root = realpathSync(mkdtempSync(join(tmpdir(), 'plandrop-delete-')));
      process.chdir(root);
    });

    afterEach(() => {
      process.chdir(cwd);
      rmSync(root, { recursive: true, force: true });
    });

    it('errors clearly instead of attempting a network call', async () => {
      const { text } = captureStderr();
      const code = await del({ command: 'delete', hashOverride: undefined, params: ['stale.html'] });
      expect(code).toBe(1);
      expect(text()).toMatch(/no \.plandrop found/);
    });
  });
});
