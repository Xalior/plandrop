import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { bootswatchThemes } from '../scripts/gen-templates.mjs';
import { runCli } from './helpers/cli';
import { httpRequest } from './helpers/http';

const { ingressPort, apachePort, domain, proxyBase, tenantA } = inject('stack');

const bootswatchDir = fileURLToPath(new URL('../node_modules/bootswatch', import.meta.url));

interface TemplatesBody {
  default: string;
  templates: string[];
}

describe('ingress /api/templates (proxied, dynamic)', () => {
  it('returns the default and a list containing bootstrap5', async () => {
    const res = await httpRequest({
      port: ingressPort,
      method: 'GET',
      path: '/api/templates',
      hostHeader: domain,
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    const body = JSON.parse(res.body.toString()) as TemplatesBody;
    expect(body.default).toBe('bootstrap5');
    expect(body.templates).toContain('bootstrap5');
  });

  it('lists the full pinned Bootswatch set plus bootstrap5', async () => {
    const res = await httpRequest({
      port: ingressPort,
      method: 'GET',
      path: '/api/templates',
      hostHeader: domain,
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body.toString()) as TemplatesBody;
    const expected = bootswatchThemes(bootswatchDir);
    for (const theme of expected) {
      expect(body.templates).toContain(theme);
    }
    // The full set is the Bootswatch themes plus the bootstrap5 skeleton.
    expect(body.templates).toHaveLength(expected.length + 1);
  });
});

describe('ingress serves each generated theme starter', () => {
  it('serves template.html for a sample of generated themes', async () => {
    for (const theme of ['cerulean', 'darkly', 'zephyr']) {
      const res = await httpRequest({
        port: ingressPort,
        method: 'GET',
        path: `/.plandrop/${theme}/template.html`,
        hostHeader: domain,
      });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.body.toString()).toContain(`.plandrop/${theme}/css/bootstrap.min.css`);
    }
  });
});

describe('ingress static template serving', () => {
  it('serves the assembled bootstrap5 starter as text/html', async () => {
    const res = await httpRequest({
      port: ingressPort,
      method: 'GET',
      path: '/.plandrop/bootstrap5/template.html',
      hostHeader: domain,
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    const html = res.body.toString();
    expect(html.trimStart().startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('.plandrop/bootstrap5/css/bootstrap.min.css');
  });
});

describe('apache shared /.plandrop serving', () => {
  const tenantHost = `${tenantA.label}.${domain}`;

  it('serves a shared template asset for a tenant', async () => {
    const res = await httpRequest({
      port: apachePort,
      method: 'GET',
      path: '/.plandrop/bootstrap5/css/bootstrap.min.css',
      hostHeader: tenantHost,
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/css/);
  });

  it('denies a PUT under /.plandrop/ (read-only shared tree)', async () => {
    const res = await httpRequest({
      port: apachePort,
      method: 'PUT',
      path: '/.plandrop/bootstrap5/evil.txt',
      hostHeader: tenantHost,
      auth: { user: tenantA.label, pass: tenantA.pass },
      body: 'should not land',
    });
    // The shared tree is not a DAV collection and is read-only: a write is
    // forbidden outright (403), and the file is never created.
    expect(res.status).toBe(403);
    const check = await httpRequest({
      port: apachePort,
      method: 'GET',
      path: '/.plandrop/bootstrap5/evil.txt',
      hostHeader: tenantHost,
    });
    expect(check.status).toBe(404);
  });
});

describe('apache autoindex', () => {
  // A fresh tenant whose www has files but no index.html -> directory listing.
  it('lists a directory with no index.html as text/html', async () => {
    const created = await httpRequest({
      port: ingressPort,
      method: 'POST',
      path: '/api/hosts',
      hostHeader: domain,
    });
    expect(created.status).toBe(201);
    const { host, passphrase } = JSON.parse(created.body.toString()) as {
      host: string;
      passphrase: string;
    };
    const tenantHost = `${host}.${domain}`;

    // Upload a non-index file so the dir exists with content but no index.html.
    const put = await httpRequest({
      port: apachePort,
      method: 'PUT',
      path: '/notes.txt',
      hostHeader: tenantHost,
      auth: { user: host, pass: passphrase },
      body: 'hello',
    });
    expect(put.status).toBe(201);

    const listing = await httpRequest({
      port: apachePort,
      method: 'GET',
      path: '/',
      hostHeader: tenantHost,
    });
    expect(listing.status).toBe(200);
    expect(listing.headers['content-type']).toMatch(/text\/html/);
    expect(listing.body.toString()).toContain('notes.txt');
  });
});

describe('newdoc end-to-end (CLI -> ingress -> local file -> published)', () => {
  let cwd: string;
  let configHome: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'plandrop-newdoc-'));
    configHome = mkdtempSync(join(tmpdir(), 'plandrop-cfg-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(configHome, { recursive: true, force: true });
  });

  function env(): NodeJS.ProcessEnv {
    return { ...process.env, XDG_CONFIG_HOME: configHome, PLANDROP_DOMAIN: '' };
  }

  it('writes a bootstrap5 starter, refuses overwrite without --force, then forces', async () => {
    // A .plandrop is needed so the CLI knows which ingress to target.
    expect(runCli(['create', '--domain', proxyBase], { cwd, env: env() }).status).toBe(0);

    const made = runCli(['newdoc', 'foo.html'], { cwd, env: env() });
    expect(made.status).toBe(0);
    const docPath = join(cwd, 'foo.html');
    expect(existsSync(docPath)).toBe(true);
    const doc = readFileSync(docPath, 'utf8');
    expect(doc).toContain('.plandrop/bootstrap5/css/bootstrap.min.css');
    expect(doc).not.toContain('.plandrop/default/');

    // Refuses to overwrite without --force; the file is unchanged.
    const before = readFileSync(docPath, 'utf8');
    const refused = runCli(['newdoc', 'foo.html'], { cwd, env: env() });
    expect(refused.status).not.toBe(0);
    expect(readFileSync(docPath, 'utf8')).toBe(before);

    // --force overwrites.
    const forced = runCli(['newdoc', 'foo.html', '--force'], { cwd, env: env() });
    expect(forced.status).toBe(0);

    // Errors clearly on an unknown template.
    const bad = runCli(['newdoc', 'bar.html', '--template', 'nope'], { cwd, env: env() });
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain('bootstrap5');
  });

  it('uses the dotfile template by default and lets --template override it', () => {
    // Pin a theme at create time; newdoc with no flag honours it.
    expect(
      runCli(['create', '--domain', proxyBase, '--template', 'darkly'], { cwd, env: env() }).status,
    ).toBe(0);

    expect(runCli(['newdoc', 'pinned.html'], { cwd, env: env() }).status).toBe(0);
    const pinned = readFileSync(join(cwd, 'pinned.html'), 'utf8');
    expect(pinned).toContain('.plandrop/darkly/css/bootstrap.min.css');
    expect(pinned).not.toContain('.plandrop/bootstrap5/');

    // An explicit flag overrides the dotfile default.
    expect(
      runCli(['newdoc', 'over.html', '--template', 'cerulean'], { cwd, env: env() }).status,
    ).toBe(0);
    const over = readFileSync(join(cwd, 'over.html'), 'utf8');
    expect(over).toContain('.plandrop/cerulean/css/bootstrap.min.css');
    expect(over).not.toContain('.plandrop/darkly/');
  });

  it('the written doc renders its assets when published via Apache', async () => {
    expect(runCli(['create', '--domain', proxyBase], { cwd, env: env() }).status).toBe(0);
    expect(runCli(['newdoc', 'index.html'], { cwd, env: env() }).status).toBe(0);

    const dotfile = JSON.parse(readFileSync(join(cwd, '.plandrop'), 'utf8')) as {
      host: string;
      passphrase: string;
    };
    const tenantHost = `${dotfile.host}.${domain}`;

    // Publish the generated doc, then fetch it + a referenced asset same-origin.
    const put = await httpRequest({
      port: apachePort,
      method: 'PUT',
      path: '/index.html',
      hostHeader: tenantHost,
      auth: { user: dotfile.host, pass: dotfile.passphrase },
      body: readFileSync(join(cwd, 'index.html')),
    });
    expect(put.status).toBe(201);

    const page = await httpRequest({
      port: apachePort,
      method: 'GET',
      path: '/index.html',
      hostHeader: tenantHost,
    });
    expect(page.status).toBe(200);

    const asset = await httpRequest({
      port: apachePort,
      method: 'GET',
      path: '/.plandrop/bootstrap5/css/bootstrap.min.css',
      hostHeader: tenantHost,
    });
    expect(asset.status).toBe(200);
  });
});

// The theme volume is seeded fresh on ingress boot: a stale entry from a prior
// boot does not survive, and the built-ins are re-seeded. Exercised on a
// throwaway ingress container with its own volume so it never disrupts the
// shared stack (other test files run concurrently against it).
describe('fresh-seed on ingress boot', () => {
  it('wipes a stale entry and re-seeds the built-ins on a fresh boot', () => {
    const image = 'plandrop-stack-test-ingress';
    const name = `plandrop-seed-probe-${process.pid}`;
    const vol = `plandrop-seed-vol-${process.pid}`;
    const docker = (args: string[]): string =>
      execFileSync('docker', args, { encoding: 'utf8' });
    const tryDocker = (args: string[]): void => {
      try {
        docker(args);
      } catch {
        // best-effort cleanup
      }
    };

    try {
      docker(['volume', 'create', vol]);

      // First boot: seed the volume, then plant a stale marker in it.
      docker(['run', '-d', '--name', name, '-v', `${vol}:/srv/templates`, image]);
      waitForSeed(docker, name);
      docker(['exec', name, 'sh', '-c', 'echo x > /srv/templates/stale.txt']);
      docker(['rm', '-f', name]);

      // Second boot on the same volume: the entrypoint re-seeds fresh.
      docker(['run', '-d', '--name', name, '-v', `${vol}:/srv/templates`, image]);
      waitForSeed(docker, name);
      const after = docker(['exec', name, 'ls', '/srv/templates']);
      expect(after).not.toContain('stale.txt');
      expect(after).toContain('bootstrap5');
    } finally {
      tryDocker(['rm', '-f', name]);
      tryDocker(['volume', 'rm', vol]);
    }
  });
});

function waitForSeed(docker: (args: string[]) => string, name: string): void {
  for (let i = 0; i < 30; i += 1) {
    try {
      docker(['exec', name, 'test', '-f', '/srv/templates/bootstrap5/template.html']);
      return;
    } catch {
      execFileSync('sleep', ['1']);
    }
  }
  throw new Error('ingress did not seed the theme volume in time');
}

// Attribution ships in the built image (loud and proud): the Bootswatch MIT
// LICENSE and the Bootstrap NOTICE are bundled with the templates.
describe('attribution in the built ingress image', () => {
  it('bundles the Bootswatch LICENSE and Bootstrap NOTICE', () => {
    const image = 'plandrop-stack-test-ingress';
    const out = execFileSync(
      'docker',
      [
        'run',
        '--rm',
        '--entrypoint',
        'sh',
        image,
        '-c',
        'cat /usr/share/plandrop/templates/BOOTSWATCH-LICENSE /usr/share/plandrop/templates/bootstrap5/NOTICE',
      ],
      { encoding: 'utf8' },
    );
    expect(out).toContain('Thomas Park');
    expect(out).toContain('Bootstrap');
    expect(out).toContain('MIT');
  });
});
