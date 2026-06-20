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

  it('rejects an unknown command', () => {
    expect(() => parseArgs(['frobnic'])).toThrow(UsageError);
  });

  it('rejects empty argv', () => {
    expect(() => parseArgs([])).toThrow(UsageError);
  });

  it('rejects a hash override with no following command', () => {
    expect(() => parseArgs(['abcdef123456'])).toThrow(UsageError);
  });
});

describe('main', () => {
  it.each([...COMMANDS])('runs %s and exits 0', (command) => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    expect(main([command])).toBe(0);
    out.mockRestore();
  });

  it('exits non-zero with usage text on an unknown command', () => {
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const code = main(['frobnic']);
    const written = err.mock.calls.map((call) => String(call[0])).join('');
    err.mockRestore();
    expect(code).toBe(2);
    expect(written).toMatch(/Usage:/);
  });
});
