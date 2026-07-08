import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run as init } from '../src/commands/init';
import { resolveDomain } from '../src/domain';
import type { Dispatch } from '../src/dispatch';

let workdir: string;
let configHome: string;
let savedXdg: string | undefined;
let savedCwd: string;
let out: ReturnType<typeof vi.spyOn>;
let err: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'plandrop-init-'));
  configHome = join(workdir, 'xdg');
  savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = configHome;
  savedCwd = process.cwd();
  out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});

afterEach(() => {
  out.mockRestore();
  err.mockRestore();
  process.chdir(savedCwd);
  if (savedXdg === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = savedXdg;
  }
  rmSync(workdir, { recursive: true, force: true });
});

function dispatch(params: string[]): Dispatch {
  return { command: 'init', hashOverride: undefined, params };
}

function stdout(): string {
  return out.mock.calls.map((call: unknown[]) => String(call[0])).join('');
}

function stderr(): string {
  return err.mock.calls.map((call: unknown[]) => String(call[0])).join('');
}

const userPath = () => join(configHome, 'plandrop', 'config.json');

describe('init --user', () => {
  it('writes the per-user config (0600) and prints its absolute path', async () => {
    const code = await init(
      dispatch(['--yes', '--user', '--domain', 'https://plandrop.example.com', '--template', 'darkly']),
    );
    expect(code).toBe(0);
    expect(statSync(userPath()).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(userPath(), 'utf8'))).toEqual({
      domain: 'https://plandrop.example.com',
      template: 'darkly',
    });
    expect(stdout()).toContain(`wrote ${resolve(userPath())}`);
  });

  it('defaults non-interactively to the public template host, user tier', async () => {
    const code = await init(dispatch(['--yes']));
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(userPath(), 'utf8'))).toEqual({
      domain: 'https://plandrop.dev',
    });
  });

  it('refuses to touch an existing user config without --force', async () => {
    expect(await init(dispatch(['--yes', '--domain', 'https://a.example']))).toBe(0);
    const refused = await init(dispatch(['--yes', '--domain', 'https://b.example']));
    expect(refused).toBe(1);
    expect(stderr()).toMatch(/--force/);
    expect(JSON.parse(readFileSync(userPath(), 'utf8')).domain).toBe('https://a.example');
  });

  it('updates with --force, merging over unrelated keys', async () => {
    expect(await init(dispatch(['--yes', '--domain', 'https://a.example']))).toBe(0);
    const raw = JSON.parse(readFileSync(userPath(), 'utf8')) as Record<string, unknown>;
    writeFileSync(userPath(), JSON.stringify({ ...raw, custom: 'kept' }));
    expect(await init(dispatch(['--yes', '--force', '--domain', 'https://b.example']))).toBe(0);
    expect(JSON.parse(readFileSync(userPath(), 'utf8'))).toEqual({
      domain: 'https://b.example',
      custom: 'kept',
    });
  });

  it('rejects an invalid domain', async () => {
    expect(await init(dispatch(['--yes', '--domain', 'http://']))).toBe(1);
    expect(stderr()).toMatch(/invalid domain/);
    expect(existsSync(userPath())).toBe(false);
  });

  it('rejects --local with --user', async () => {
    expect(await init(dispatch(['--local', '--user']))).toBe(2);
    expect(stderr()).toMatch(/mutually exclusive/);
  });
});

describe('init --local', () => {
  it('writes a cwd .plandrop and prints its absolute path', async () => {
    process.chdir(workdir);
    const code = await init(dispatch(['--yes', '--local', '--domain', 'https://plandrop.example.com']));
    expect(code).toBe(0);
    const path = join(workdir, '.plandrop');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ domain: 'https://plandrop.example.com' });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    // realpath: chdir resolves the tmpdir symlink (/var -> /private/var on macOS).
    expect(stdout()).toContain(`wrote ${realpathSync(path)}`);
  });

  it('merges into an existing .plandrop, preserving host and passphrase', async () => {
    process.chdir(workdir);
    writeFileSync(
      join(workdir, '.plandrop'),
      JSON.stringify({ domain: 'https://old.example', host: 'h123', passphrase: 'p456' }),
    );
    const code = await init(
      dispatch(['--yes', '--local', '--domain', 'https://new.example', '--template', 'darkly']),
    );
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(join(workdir, '.plandrop'), 'utf8'))).toEqual({
      domain: 'https://new.example',
      host: 'h123',
      passphrase: 'p456',
      template: 'darkly',
    });
  });
});

describe('init round-trip', () => {
  it('a written user config is honoured by resolveDomain', async () => {
    expect(await init(dispatch(['--yes', '--domain', 'https://round.example']))).toBe(0);
    const domain = await resolveDomain({
      flag: undefined,
      env: { XDG_CONFIG_DIRS: join(workdir, 'no-sys') },
      cwd: join(workdir, 'elsewhere'),
      configHome,
      home: homedir(),
      prompt: () => Promise.resolve(undefined),
    });
    expect(domain).toBe('https://round.example');
  });
});
