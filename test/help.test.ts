import { describe, expect, it, vi } from 'vitest';
import { main } from '../src/app';
import { run as create } from '../src/commands/create';
import { run as help } from '../src/commands/help';
import { run as init } from '../src/commands/init';
import { run as newdoc } from '../src/commands/newdoc';
import { run as remove } from '../src/commands/remove';
import { run as rotate } from '../src/commands/rotate';
import { run as server } from '../src/commands/server';
import { run as upload } from '../src/commands/upload';
import { COMMANDS } from '../src/dispatch';
import { COMMAND_USAGE, commandText, overviewText, usageLine } from '../src/usage';

// mockRestore clears the recorded calls, so the text must be read first.
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

describe('usage registry', () => {
  it.each([...COMMANDS])('carries a one-liner and examples for %s', (command) => {
    const usage = COMMAND_USAGE[command];
    expect(usage.summary.length).toBeGreaterThan(0);
    expect(usage.detail.length).toBeGreaterThan(0);
    expect(usage.examples.length).toBeGreaterThan(0);
  });

  it('lists every command with its one-liner in the overview', () => {
    const overview = overviewText();
    for (const command of COMMANDS) {
      expect(overview).toContain(command);
      expect(overview).toContain(COMMAND_USAGE[command].summary);
    }
  });

  it('composes the usage line from the synopsis', () => {
    expect(usageLine('upload')).toBe('usage: plandrop upload <path> [remote-path]');
    expect(usageLine('rotate')).toBe('usage: plandrop rotate');
  });

  it('includes the usage line and examples in a command text', () => {
    const text = commandText('newdoc');
    expect(text).toContain(usageLine('newdoc'));
    expect(text).toContain('examples:');
    expect(text).toContain('plandrop newdoc plan.html');
  });
});

describe('help command', () => {
  it('prints the overview with no topic, exit 0', () => {
    const { text } = captureStdout();
    const code = help({ command: 'help', hashOverride: undefined, params: [] });
    expect(text()).toBe(overviewText());
    expect(code).toBe(0);
  });

  it('prints a command\'s detailed usage with a topic, exit 0', () => {
    const { text } = captureStdout();
    const code = help({ command: 'help', hashOverride: undefined, params: ['upload'] });
    expect(text()).toBe(commandText('upload'));
    expect(code).toBe(0);
  });

  it('errors on an unknown topic', () => {
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const code = help({ command: 'help', hashOverride: undefined, params: ['frobnic'] });
    const written = err.mock.calls.map((call) => String(call[0])).join('');
    err.mockRestore();
    expect(code).toBe(2);
    expect(written).toMatch(/unknown command: frobnic/);
  });
});

describe('per-command --help', () => {
  // --help routes to the same text whether intercepted at dispatch or inside
  // the command; both must exit 0 without touching fs/network.
  it.each(['create', 'newdoc', 'upload', 'rotate', 'remove', 'init', 'server'] as const)(
    'plandrop %s --help prints usage and exits 0',
    async (command) => {
      const { text } = captureStdout();
      const code = await main([command, '--help']);
      expect(text()).toBe(commandText(command));
      expect(code).toBe(0);
    },
  );

  const handlers = { create, newdoc, upload, rotate, remove, init, server } as const;

  it.each(Object.keys(handlers) as (keyof typeof handlers)[])(
    '%s short-circuits on --help in its own params',
    async (command) => {
      const { text } = captureStdout();
      const code = await handlers[command]({ command, hashOverride: undefined, params: ['--help'] });
      expect(text()).toBe(commandText(command));
      expect(code).toBe(0);
    },
  );
});
