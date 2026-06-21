import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { runCli } from './helpers/cli';
import { httpRequest } from './helpers/http';

const { controlPort, apachePort, domain } = inject('stack');
const controlAddr = `127.0.0.1:${controlPort}`;

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
    const result = runCli(['create', '--domain', '127.0.0.1:1'], { cwd, env: env() });
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
});
