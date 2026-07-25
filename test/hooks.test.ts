import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/app';
import { autosyncCommand, DEFAULT_WATCH_GLOB } from '../src/autosync';
import { hookOfferAccepted } from '../src/commands/create';
import { run as hooks } from '../src/commands/hooks';
import { parseArgs } from '../src/dispatch';

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'plandrop-hooks-'));
  // The command works on process.cwd(); pinning it keeps the test off the
  // repo it runs in (which has a .plandrop of its own).
  vi.spyOn(process, 'cwd').mockReturnValue(workdir);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(workdir, { recursive: true, force: true });
});

interface Settings {
  hooks?: {
    PostToolUse?: { matcher?: string; hooks?: { command?: string; type?: string }[] }[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function writeHost(): void {
  writeFileSync(
    join(workdir, '.plandrop'),
    JSON.stringify({ domain: 'http://localhost:8083', host: 'abcdefgh12345678', passphrase: 'p' }),
  );
}

function settingsPath(): string {
  return join(workdir, '.claude', 'settings.json');
}

function readSettings(): Settings {
  return JSON.parse(readFileSync(settingsPath(), 'utf8')) as Settings;
}

/** Run the command, capturing what it told the user. */
function runHooks(params: string[] = []): { code: number; out: string; err: string } {
  const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const code = hooks({ command: 'hooks', hashOverride: undefined, params });
  const text = (spy: typeof out): string => spy.mock.calls.map((call) => String(call[0])).join('');
  const result = { code, out: text(out), err: text(err) };
  out.mockRestore();
  err.mockRestore();
  return result;
}

describe('plandrop hooks', () => {
  it('is short enough to parse as a command, not a hash', () => {
    expect(parseArgs(['hooks']).command).toBe('hooks');
    expect(parseArgs(['hooks']).hashOverride).toBeUndefined();
    expect(parseArgs(['hooks', 'plans']).params).toEqual(['plans']);
  });

  it('routes through main to the installed hook', async () => {
    writeHost();
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const code = await main(['hooks']);
    out.mockRestore();
    expect(code).toBe(0);
    expect(readSettings().hooks?.PostToolUse?.[0]?.hooks?.[0]?.command).toBe(
      autosyncCommand(DEFAULT_WATCH_GLOB),
    );
  });

  it('writes the default hook when no .claude exists', () => {
    writeHost();
    const { code, out } = runHooks();
    expect(code).toBe(0);
    expect(out).toContain(settingsPath());
    expect(out).toContain(DEFAULT_WATCH_GLOB);
    const entry = readSettings().hooks?.PostToolUse?.[0];
    expect(entry?.matcher).toBe('Write|Edit');
    expect(entry?.hooks?.[0]?.command).toBe(autosyncCommand(DEFAULT_WATCH_GLOB));
  });

  it('takes the watch path positionally or as --hook-path', () => {
    writeHost();
    expect(runHooks(['plans']).code).toBe(0);
    expect(readSettings().hooks?.PostToolUse?.[0]?.hooks?.[0]?.command).toBe(
      autosyncCommand('plans/**/*.html'),
    );

    rmSync(join(workdir, '.claude'), { recursive: true, force: true });
    expect(runHooks(['--hook-path', 'notes/*.html']).code).toBe(0);
    expect(readSettings().hooks?.PostToolUse?.[0]?.hooks?.[0]?.command).toBe(
      autosyncCommand('notes/*.html'),
    );
  });

  it('merges into an existing settings file without clobbering it', () => {
    writeHost();
    mkdirSync(join(workdir, '.claude'));
    writeFileSync(
      settingsPath(),
      JSON.stringify({
        model: 'opus',
        hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] },
      }),
    );
    expect(runHooks().code).toBe(0);
    const settings = readSettings();
    expect(settings.model).toBe('opus');
    const post = settings.hooks?.PostToolUse ?? [];
    expect(post).toHaveLength(2);
    expect(post[0]?.matcher).toBe('Bash');
    expect(post[1]?.hooks?.[0]?.command).toBe(autosyncCommand(DEFAULT_WATCH_GLOB));
  });

  it('changes nothing when an equivalent hook is already installed', () => {
    writeHost();
    expect(runHooks().code).toBe(0);
    const before = readFileSync(settingsPath(), 'utf8');
    const again = runHooks();
    expect(again.code).toBe(0);
    expect(again.out).toMatch(/equivalent hook/);
    expect(readFileSync(settingsPath(), 'utf8')).toBe(before);
  });

  it('says the host is missing rather than installing a hook that cannot publish', () => {
    const { code, err } = runHooks();
    expect(code).toBe(1);
    expect(err).toMatch(/plandrop create/);
    expect(() => readSettings()).toThrow();
  });

  it('treats a config-only .plandrop as no host', () => {
    writeFileSync(join(workdir, '.plandrop'), JSON.stringify({ domain: 'http://localhost:8083' }));
    expect(runHooks().code).toBe(1);
  });
});

describe('create hook offer', () => {
  it('opts in on a bare Enter', () => {
    expect(hookOfferAccepted('')).toBe(true);
    expect(hookOfferAccepted('  ')).toBe(true);
    expect(hookOfferAccepted('y')).toBe(true);
    expect(hookOfferAccepted('yes')).toBe(true);
  });

  it('declines on an explicit no, or on no answer at all', () => {
    expect(hookOfferAccepted('n')).toBe(false);
    expect(hookOfferAccepted('N')).toBe(false);
    expect(hookOfferAccepted('no')).toBe(false);
    expect(hookOfferAccepted(undefined)).toBe(false);
  });
});
