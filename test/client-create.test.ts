import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { runCli } from './helpers/cli';
import { httpRequest } from './helpers/http';

const { controlPort, apachePort, domain } = inject('stack');
const controlAddr = `http://127.0.0.1:${controlPort}`;

let cwd: string;
let configHome: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'plandrop-cwd-'));
  configHome = mkdtempSync(join(tmpdir(), 'plandrop-cfg-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  rmSync(configHome, { recursive: true, force: true });
});

// Isolated env: no leaked PLANDROP_DOMAIN, no real user config.
function env(): NodeJS.ProcessEnv {
  return { ...process.env, XDG_CONFIG_HOME: configHome, PLANDROP_DOMAIN: '' };
}

interface Dotfile {
  domain: string;
  host: string;
  passphrase: string;
  template?: string;
  hookWatch?: string;
  hookPublish?: string;
  localRoot?: string;
  version?: string;
}

function readDotfile(): Dotfile {
  return JSON.parse(readFileSync(join(cwd, '.plandrop'), 'utf8')) as Dotfile;
}

describe('client create', () => {
  it('writes a 0600 dotfile whose creds authorize a WebDAV PUT to Apache', async () => {
    const result = runCli(['create', '--domain', controlAddr], { cwd, env: env() });
    expect(result.status).toBe(0);

    const dotfile = readDotfile();
    expect(dotfile.domain).toBe(controlAddr);
    expect(dotfile.host).toMatch(/^[a-z2-7]{16}$/);
    expect(dotfile.passphrase).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const put = await httpRequest({
      port: apachePort,
      method: 'PUT',
      path: '/index.html',
      hostHeader: `${dotfile.host}.${domain}`,
      auth: { user: dotfile.host, pass: dotfile.passphrase },
      body: '<h1>from client</h1>',
    });
    expect(put.status).toBe(201);
  });

  it('refuses without --force, replaces with --force', async () => {
    expect(runCli(['create', '--domain', controlAddr], { cwd, env: env() }).status).toBe(0);
    const first = readDotfile();

    const refused = runCli(['create', '--domain', controlAddr], { cwd, env: env() });
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toMatch(/--force/);
    expect(readDotfile()).toEqual(first);

    const forced = runCli(['create', '--force', '--domain', controlAddr], { cwd, env: env() });
    expect(forced.status).toBe(0);
    expect(readDotfile().host).not.toBe(first.host);
  });

  it('writes no dotfile when the control plane is unreachable', () => {
    const result = runCli(['create', '--domain', 'http://127.0.0.1:1'], { cwd, env: env() });
    expect(result.status).not.toBe(0);
    expect(existsSync(join(cwd, '.plandrop'))).toBe(false);
  });

  it('consumes a domain piped to stdin', () => {
    const piped = runCli(['create'], { cwd, env: env(), input: `${controlAddr}\n` });
    expect(piped.status).toBe(0);
    expect(readDotfile().domain).toBe(controlAddr);
  });

  it('errors when no domain is set and stdin is closed', () => {
    const closed = runCli(['create'], { cwd, env: env(), input: '' });
    expect(closed.status).not.toBe(0);
    expect(existsSync(join(cwd, '.plandrop'))).toBe(false);
  });

  it('stores the default alias in the dotfile when no --template flag', () => {
    expect(runCli(['create', '--domain', controlAddr], { cwd, env: env() }).status).toBe(0);
    expect(readDotfile().template).toBe('default');
  });

  it('stores the chosen template name with --template', () => {
    expect(
      runCli(['create', '--domain', controlAddr, '--template', 'darkly'], { cwd, env: env() })
        .status,
    ).toBe(0);
    expect(readDotfile().template).toBe('darkly');
  });

  it('fills in a config-only .plandrop from init --local without --force', () => {
    // init --local records preferences only (no host); create must fill the
    // host in — not demand --force — and keep the recorded template.
    expect(
      runCli(['init', '--yes', '--local', '--domain', controlAddr, '--template', 'darkly'], {
        cwd,
        env: env(),
      }).status,
    ).toBe(0);
    expect(readDotfile().host).toBeUndefined();

    const created = runCli(['create'], { cwd, env: env() });
    expect(created.status).toBe(0);
    const dotfile = readDotfile();
    expect(dotfile.domain).toBe(controlAddr);
    expect(dotfile.host).toMatch(/^[a-z2-7]{16}$/);
    expect(dotfile.template).toBe('darkly');
  });

  it('scaffolds the autosync hook with --hook, none without', () => {
    // Non-interactive create sets up no hook unless asked, and --no-hook
    // declines it however create is run.
    expect(runCli(['create', '--domain', controlAddr], { cwd, env: env() }).status).toBe(0);
    expect(existsSync(join(cwd, '.claude', 'settings.json'))).toBe(false);

    expect(
      runCli(['create', '--force', '--domain', controlAddr, '--no-hook'], { cwd, env: env() })
        .status,
    ).toBe(0);
    expect(existsSync(join(cwd, '.claude', 'settings.json'))).toBe(false);

    const hooked = runCli(
      ['create', '--force', '--domain', controlAddr, '--hook', '--hook-path', 'plans/*.html'],
      { cwd, env: env() },
    );
    expect(hooked.status).toBe(0);
    const settings = JSON.parse(readFileSync(join(cwd, '.claude', 'settings.json'), 'utf8')) as {
      hooks: { PostToolUse: { matcher: string; hooks: { command: string }[] }[] };
    };
    expect(settings.hooks.PostToolUse[0]?.matcher).toBe('Write|Edit');
    // The saved file publishes at its project-relative path, not a flattened
    // basename under the watched directory.
    expect(settings.hooks.PostToolUse[0]?.hooks[0]?.command).toContain('case "$f" in */plans/*.html)');
    expect(settings.hooks.PostToolUse[0]?.hooks[0]?.command).toContain(
      'plandrop upload "${f#"$PWD"/}"',
    );
  });

  it('records the watch glob, publish mode, and client version into .plandrop when it scaffolds the hook', () => {
    expect(
      runCli(
        ['create', '--domain', controlAddr, '--hook', '--hook-path', 'docs/**/*.html', '--local-root', 'docs'],
        { cwd, env: env() },
      ).status,
    ).toBe(0);
    const dotfile = readDotfile();
    expect(dotfile.hookWatch).toBe('docs/**/*.html');
    expect(dotfile.hookPublish).toBe('root');
    expect(dotfile.localRoot).toBe('docs');
    expect(dotfile.version).toBe(__PLANDROP_VERSION__);
  });

  it('--hook-flat alone implies the hook, like --local-root and --hook-path do', () => {
    expect(
      runCli(['create', '--domain', controlAddr, '--hook-flat'], { cwd, env: env() }).status,
    ).toBe(0);
    const settings = JSON.parse(readFileSync(join(cwd, '.claude', 'settings.json'), 'utf8')) as {
      hooks: { PostToolUse: { hooks: { command: string }[] }[] };
    };
    expect(settings.hooks.PostToolUse[0]?.hooks[0]?.command).toContain('cd "$(dirname "$f")"');
    expect(readDotfile().hookPublish).toBe('flat');
  });

  it('rejects --local-root and --hook-flat together, without minting a host', () => {
    const result = runCli(
      ['create', '--domain', controlAddr, '--local-root', 'docs', '--hook-flat'],
      { cwd, env: env() },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/mutually exclusive/);
    expect(existsSync(join(cwd, '.plandrop'))).toBe(false);
  });

  it('--hook-flat cds into the saved file\'s own directory', () => {
    expect(
      runCli(['create', '--domain', controlAddr, '--hook', '--hook-flat'], { cwd, env: env() }).status,
    ).toBe(0);
    const settings = JSON.parse(readFileSync(join(cwd, '.claude', 'settings.json'), 'utf8')) as {
      hooks: { PostToolUse: { hooks: { command: string }[] }[] };
    };
    expect(settings.hooks.PostToolUse[0]?.hooks[0]?.command).toContain('cd "$(dirname "$f")"');
  });
});
