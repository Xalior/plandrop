import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { hostBaseUri } from '../src/endpoint';
import { runCli } from './helpers/cli';
import { httpRequest } from './helpers/http';

const { proxyBase, apachePort, domain, dataDir, authFile } = inject('stack');

let cwd: string;
let configHome: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'plandrop-mng-'));
  configHome = mkdtempSync(join(tmpdir(), 'plandrop-cfg-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  rmSync(configHome, { recursive: true, force: true });
});

interface Dotfile {
  domain: string;
  host: string;
  passphrase: string;
  hookPublish?: string;
  localRoot?: string;
}

function env(): NodeJS.ProcessEnv {
  return { ...process.env, XDG_CONFIG_HOME: configHome, PLANDROP_DOMAIN: '' };
}

function readDotfile(): Dotfile {
  return JSON.parse(readFileSync(join(cwd, '.plandrop'), 'utf8')) as Dotfile;
}

function writeDotfile(data: Dotfile): void {
  writeFileSync(join(cwd, '.plandrop'), JSON.stringify(data));
}

/** Create a host (via the proxy ingress) so its dotfile lands in cwd. */
function createHost(): Dotfile {
  const result = runCli(['create', '--domain', proxyBase], { cwd, env: env() });
  expect(result.status).toBe(0);
  return readDotfile();
}

function davGet(host: string, path: string) {
  return httpRequest({ port: apachePort, method: 'GET', path, hostHeader: `${host}.${domain}` });
}

function davPut(host: string, pass: string, path: string) {
  return httpRequest({
    port: apachePort,
    method: 'PUT',
    path,
    hostHeader: `${host}.${domain}`,
    auth: { user: host, pass },
    body: 'x',
  });
}

describe('client upload', () => {
  it('uploads a file served at the host root via DirectoryIndex', async () => {
    const dotfile = createHost();
    writeFileSync(join(cwd, 'index.html'), '<h1>hi from upload</h1>');

    const result = runCli(['upload', 'index.html'], { cwd, env: env() });
    expect(result.status).toBe(0);
    // Every uploaded file reports its own URL.
    expect(result.stdout).toContain(
      `uploaded index.html → ${hostBaseUri(proxyBase, dotfile.host)}/index.html`,
    );

    const res = await davGet(dotfile.host, '/');
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toMatch(/text\/html/);
    expect(res.body.toString()).toContain('hi from upload');
  });

  it('publishes a nested file at its own path, creating the collections', async () => {
    const dotfile = createHost();
    mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
    writeFileSync(join(cwd, 'docs', 'plans', 'x.html'), 'nested plan');

    const result = runCli(['upload', join('docs', 'plans', 'x.html')], { cwd, env: env() });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `uploaded docs/plans/x.html → ${hostBaseUri(proxyBase, dotfile.host)}/docs/plans/x.html`,
    );
    expect((await davGet(dotfile.host, '/docs/plans/x.html')).body.toString()).toBe('nested plan');
  });

  it('anchors a no-remote upload at the recorded localRoot, from anywhere in the project', async () => {
    const dotfile = createHost();
    writeDotfile({ ...dotfile, hookPublish: 'root', localRoot: 'docs' });
    mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
    writeFileSync(join(cwd, 'docs', 'plans', 'x.html'), 'rooted plan');

    // From the project root…
    const fromRoot = runCli(['upload', join('docs', 'plans', 'x.html')], { cwd, env: env() });
    expect(fromRoot.status).toBe(0);
    expect(fromRoot.stdout).toContain(`→ ${hostBaseUri(proxyBase, dotfile.host)}/plans/x.html`);

    // …and from deep inside that root: same file, same remote path.
    const fromDeep = runCli(['upload', 'x.html'], {
      cwd: join(cwd, 'docs', 'plans'),
      env: env(),
    });
    expect(fromDeep.status).toBe(0);
    expect(fromDeep.stdout).toContain(`→ ${hostBaseUri(proxyBase, dotfile.host)}/plans/x.html`);

    expect((await davGet(dotfile.host, '/plans/x.html')).body.toString()).toBe('rooted plan');
  });

  it('reports the explicit remote path of a single-file upload', async () => {
    const dotfile = createHost();
    writeFileSync(join(cwd, 'plan.html'), 'renamed remote');

    const result = runCli(['upload', 'plan.html', 'published.html'], { cwd, env: env() });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `uploaded plan.html → ${hostBaseUri(proxyBase, dotfile.host)}/published.html`,
    );
    expect((await davGet(dotfile.host, '/published.html')).body.toString()).toBe('renamed remote');
  });

  it('uploads a directory under its own name, preserving structure', async () => {
    const dotfile = createHost();
    mkdirSync(join(cwd, 'site', 'sub'), { recursive: true });
    writeFileSync(join(cwd, 'site', 'index.html'), 'root page');
    writeFileSync(join(cwd, 'site', 'sub', 'a.txt'), 'nested bytes');

    const result = runCli(['upload', 'site'], { cwd, env: env() });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `uploaded site/index.html → ${hostBaseUri(proxyBase, dotfile.host)}/site/index.html`,
    );

    expect((await davGet(dotfile.host, '/site/index.html')).body.toString()).toBe('root page');
    expect((await davGet(dotfile.host, '/site/sub/a.txt')).body.toString()).toBe('nested bytes');
  });

  it('spills a directory into the host root when the remote base is `.`', async () => {
    const dotfile = createHost();
    mkdirSync(join(cwd, 'site', 'sub'), { recursive: true });
    writeFileSync(join(cwd, 'site', 'index.html'), 'root page');
    writeFileSync(join(cwd, 'site', 'sub', 'a.txt'), 'nested bytes');

    const result = runCli(['upload', 'site', '.'], { cwd, env: env() });
    expect(result.status).toBe(0);

    expect((await davGet(dotfile.host, '/index.html')).body.toString()).toBe('root page');
    expect((await davGet(dotfile.host, '/sub/a.txt')).body.toString()).toBe('nested bytes');
  });

  it('surfaces a mismatched passphrase as a wrong-tenant error', () => {
    const dotfile = createHost();
    writeDotfile({ ...dotfile, passphrase: 'wrongwrongwrongwrong12' });
    writeFileSync(join(cwd, 'index.html'), 'x');

    const result = runCli(['upload', 'index.html'], { cwd, env: env() });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/wrong tenant/i);
  });
});

describe('client rotate', () => {
  it('rotates the passphrase: old WebDAV creds fail, new ones work', async () => {
    const dotfile = createHost();

    expect(runCli(['rotate'], { cwd, env: env() }).status).toBe(0);
    const updated = readDotfile();
    expect(updated.passphrase).not.toBe(dotfile.passphrase);

    expect((await davPut(dotfile.host, dotfile.passphrase, '/old.txt')).status).toBe(401);
    expect((await davPut(dotfile.host, updated.passphrase, '/new.txt')).status).toBe(201);
  });
});

describe('client remove', () => {
  it('removes the host and deletes the local dotfile', async () => {
    const dotfile = createHost();

    expect(runCli(['remove'], { cwd, env: env() }).status).toBe(0);
    expect(existsSync(join(cwd, '.plandrop'))).toBe(false);

    expect((await davGet(dotfile.host, '/')).status).toBe(404);
    expect((await davPut(dotfile.host, dotfile.passphrase, '/z.txt')).status).toBe(401);
  });

  it('rejects wrong creds, leaving the host and dotfile intact', () => {
    const dotfile = createHost();
    writeDotfile({ ...dotfile, passphrase: 'wrongwrongwrongwrong12' });

    const result = runCli(['remove'], { cwd, env: env() });
    expect(result.status).not.toBe(0);
    expect(existsSync(join(cwd, '.plandrop'))).toBe(true);
    expect(readFileSync(authFile, 'utf8').includes(`${dotfile.host}:`)).toBe(true);
    expect(existsSync(join(dataDir, 'hosts', dotfile.host))).toBe(true);
  });
});
