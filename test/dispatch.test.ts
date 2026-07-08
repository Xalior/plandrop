import { describe, expect, it, vi } from 'vitest';
import { main } from '../src/app';
import { COMMANDS, parseArgs, UsageError } from '../src/dispatch';

describe('parseArgs', () => {
  it('treats a < 8-char arg 1 as the command (command path)', () => {
    const dispatch = parseArgs(['upload', 'file.html']);
    expect(dispatch.command).toBe('upload');
    expect(dispatch.hashOverride).toBeUndefined();
    expect(dispatch.params).toEqual(['file.html']);
  });

  it('treats a >= 8-char arg 1 as a hash override, command in arg 2', () => {
    const dispatch = parseArgs(['abcdef123456', 'upload', 'file.html']);
    expect(dispatch.hashOverride).toBe('abcdef123456');
    expect(dispatch.command).toBe('upload');
    expect(dispatch.params).toEqual(['file.html']);
  });

  it.each([...COMMANDS])('resolves %s to its handler key', (command) => {
    expect(parseArgs([command]).command).toBe(command);
  });

  it('rejects an unknown command, pointing at plandrop help', () => {
    expect(() => parseArgs(['frobnic'])).toThrow(UsageError);
    expect(() => parseArgs(['frobnic'])).toThrow(/plandrop help/);
  });

  it('resolves empty argv to the overview help', () => {
    expect(parseArgs([])).toEqual({ command: 'help', hashOverride: undefined, params: [] });
  });

  it('rejects a hash override with no following command', () => {
    expect(() => parseArgs(['abcdef123456'])).toThrow(UsageError);
  });

  it.each([
    [['-h']],
    [['--help']],
    [['--help', 'nonsense']],
  ])('routes %j to the overview help', (argv) => {
    expect(parseArgs(argv).command).toBe('help');
    expect(parseArgs(argv).params).toEqual([]);
  });

  it('routes -h/--help in any position to help with the command as topic', () => {
    expect(parseArgs(['newdoc', '--help'])).toEqual({
      command: 'help',
      hashOverride: undefined,
      params: ['newdoc'],
    });
    expect(parseArgs(['-h', 'upload'])).toEqual({
      command: 'help',
      hashOverride: undefined,
      params: ['upload'],
    });
    expect(parseArgs(['abcdef123456', 'upload', '--help']).params).toEqual(['upload']);
  });
});

describe('main', () => {
  // Every non-help command is a live fs/network command; routing is covered by
  // the parseArgs cases above and the per-command integration tests. Here we
  // assert the dispatch-level usage and help paths.
  it('exits non-zero pointing at plandrop help on an unknown command', async () => {
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const code = await main(['frobnic']);
    const written = err.mock.calls.map((call) => String(call[0])).join('');
    err.mockRestore();
    expect(code).toBe(2);
    expect(written).toMatch(/unknown command: frobnic/);
    expect(written).toMatch(/plandrop help/);
  });

  it('prints the overview help and exits 0 on a bare invocation', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const code = await main([]);
    const written = out.mock.calls.map((call) => String(call[0])).join('');
    out.mockRestore();
    expect(code).toBe(0);
    expect(written).toMatch(/Usage:/);
    expect(written).toMatch(/plandrop help <command>/);
  });
});
