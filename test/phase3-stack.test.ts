import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { runCli } from './helpers/cli';
import { httpRequest } from './helpers/http';

const { ingressPort, apachePort, domain, proxyBase, tenantA, userTemplate } = inject('stack');

interface TemplatesBody {
  default: string;
  templates: string[];
}

async function fetchTemplates(): Promise<TemplatesBody> {
  const res = await httpRequest({
    port: ingressPort,
    method: 'GET',
    path: '/api/templates',
    hostHeader: domain,
  });
  expect(res.status).toBe(200);
  return JSON.parse(res.body.toString()) as TemplatesBody;
}

// --- Deliverable 2: operator user-templates mount ---------------------------
describe('user-templates mount (namespaced user/<name>)', () => {
  const userName = `user/${userTemplate}`;

  it('lists the dropped-in template namespaced user/<name>', async () => {
    const body = await fetchTemplates();
    expect(body.templates).toContain(userName);
  });

  it('serves the user template.html via the ingress', async () => {
    const res = await httpRequest({
      port: ingressPort,
      method: 'GET',
      path: `/.plandrop/user/${userTemplate}/template.html`,
      hostHeader: domain,
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body.toString()).toContain(`user template ${userTemplate}`);
  });

  it('serves the user template.html via Apache for a tenant', async () => {
    const res = await httpRequest({
      port: apachePort,
      method: 'GET',
      path: `/.plandrop/user/${userTemplate}/template.html`,
      hostHeader: `${tenantA.label}.${domain}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.toString()).toContain(`user template ${userTemplate}`);
  });

  it('newdoc --template user/<name> writes that template', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'plandrop-userdoc-'));
    const configHome = mkdtempSync(join(tmpdir(), 'plandrop-cfg-'));
    const env = { ...process.env, XDG_CONFIG_HOME: configHome, PLANDROP_DOMAIN: '' };
    try {
      expect(runCli(['create', '--domain', proxyBase], { cwd, env }).status).toBe(0);
      const made = runCli(['newdoc', 'u.html', '--template', userName], { cwd, env });
      expect(made.status).toBe(0);
      expect(readFileSync(join(cwd, 'u.html'), 'utf8')).toContain(`user template ${userTemplate}`);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(configHome, { recursive: true, force: true });
    }
  });
});

// The user mount is a separate bind the fresh-seed never touches. Exercised on a
// throwaway ingress (its own volume + a temp user mount) so a reboot never
// disrupts the shared stack other test files run against concurrently.
describe('user templates survive an ingress re-seed', () => {
  const ingressImage = 'plandrop-stack-test-ingress';
  const name = `plandrop-userseed-${process.pid}`;
  const vol = `plandrop-userseed-vol-${process.pid}`;
  let userDir: string;
  const docker = (args: string[]): string => execFileSync('docker', args, { encoding: 'utf8' });
  const tryDocker = (args: string[]): void => {
    try {
      docker(args);
    } catch {
      // best-effort cleanup
    }
  };

  beforeEach(() => {
    userDir = mkdtempSync(join(tmpdir(), 'plandrop-userseed-mount-'));
    mkdirSync(join(userDir, 'house'));
    writeFileSync(join(userDir, 'house', 'template.html'), '<!DOCTYPE html><html></html>\n');
  });

  afterEach(() => {
    tryDocker(['rm', '-f', name]);
    tryDocker(['volume', 'rm', vol]);
    rmSync(userDir, { recursive: true, force: true });
  });

  it('re-seeds the built-ins fresh but leaves the user mount intact', () => {
    docker(['volume', 'create', vol]);
    const runArgs = [
      'run', '-d', '--name', name,
      '-v', `${vol}:/srv/templates`,
      '-v', `${userDir}:/srv/user-templates:ro`,
      ingressImage,
    ];

    // First boot: seed, then plant a stale built-in marker.
    docker(runArgs);
    waitForSeed(docker, name);
    docker(['exec', name, 'sh', '-c', 'echo x > /srv/templates/stale.txt']);
    // The user template is served before the reboot.
    expect(docker(['exec', name, 'cat', '/srv/user-templates/house/template.html'])).toContain(
      '<!DOCTYPE html>',
    );
    docker(['rm', '-f', name]);

    // Second boot on the same built-in volume + the same user mount.
    docker(runArgs);
    waitForSeed(docker, name);
    const builtins = docker(['exec', name, 'ls', '/srv/templates']);
    expect(builtins).not.toContain('stale.txt'); // built-ins re-seeded fresh
    expect(builtins).toContain('bootstrap5');
    // The separate user mount survived untouched.
    expect(docker(['exec', name, 'cat', '/srv/user-templates/house/template.html'])).toContain(
      '<!DOCTYPE html>',
    );
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

// --- Deliverable 1: configurable default (throwaway control + ingress) ------
// The shared stack runs with the built-in default (bootstrap5). Configuring a
// different default is a property of PLANDROP_DEFAULT_TEMPLATE at boot, so it is
// exercised on throwaway containers with their own volume, leaving the shared
// stack undisturbed.
describe('PLANDROP_DEFAULT_TEMPLATE configures the reported default', () => {
  const tag = `phase3-${process.pid}`;
  const vol = `plandrop-default-vol-${process.pid}`;
  const ingressName = `plandrop-default-ingress-${tag}`;
  const controlName = `plandrop-default-control-${tag}`;
  const net = `plandrop-default-net-${tag}`;
  const ingressImage = 'plandrop-stack-test-ingress';
  const controlImage = 'plandrop-stack-test-control';
  const docker = (args: string[]): string => execFileSync('docker', args, { encoding: 'utf8' });
  const tryDocker = (args: string[]): void => {
    try {
      docker(args);
    } catch {
      // best-effort cleanup
    }
  };

  afterEach(() => {
    tryDocker(['rm', '-f', ingressName]);
    tryDocker(['rm', '-f', controlName]);
    tryDocker(['volume', 'rm', vol]);
    tryDocker(['network', 'rm', net]);
  });

  it('reports default=<theme> and seeds default/ from it', () => {
    const theme = 'darkly';
    docker(['network', 'create', net]);
    docker(['volume', 'create', vol]);

    // Ingress: seeds the volume with PLANDROP_DEFAULT_TEMPLATE -> default/.
    docker([
      'run', '-d', '--name', ingressName, '--network', net,
      '-e', `PLANDROP_DEFAULT_TEMPLATE=${theme}`,
      '-e', 'PLANDROP_CONTROL_HOST=' + controlName,
      '-v', `${vol}:/srv/templates`,
      ingressImage,
    ]);
    // Control: enumerates the same volume, reports the configured default.
    docker([
      'run', '-d', '--name', controlName, '--network', net,
      '-e', `PLANDROP_DEFAULT_TEMPLATE=${theme}`,
      '-v', `${vol}:/srv/templates:ro`,
      controlImage,
    ]);

    // Wait for the seed, then for the control plane (queried via the ingress).
    for (let i = 0; i < 30; i += 1) {
      try {
        docker(['exec', ingressName, 'test', '-f', '/srv/templates/bootstrap5/template.html']);
        break;
      } catch {
        execFileSync('sleep', ['1']);
      }
    }
    // default/ is the configured theme's folder, copied at seed time.
    const defaultHeader = docker(['exec', ingressName, 'cat', '/srv/templates/default/header.html']);
    expect(defaultHeader).toContain(`.plandrop/${theme}/css/bootstrap.min.css`);

    let body = '';
    for (let i = 0; i < 30; i += 1) {
      try {
        body = docker([
          'exec', ingressName, 'sh', '-c',
          'wget -qO- http://127.0.0.1:80/api/templates || true',
        ]);
        if (body.includes('"default"')) {
          break;
        }
      } catch {
        // not ready
      }
      execFileSync('sleep', ['1']);
    }
    const parsed = JSON.parse(body) as TemplatesBody;
    expect(parsed.default).toBe(theme);
    // default/ is the chrome mirror, never advertised as a selectable template.
    expect(parsed.templates).not.toContain('default');
  });
});

// --- Deliverable 3: autoindex chrome ----------------------------------------
describe('autoindex chrome (default fallback + per-tenant override)', () => {
  // Mint a fresh tenant and give its www a file but no index.html, so a GET /
  // produces a directory listing.
  async function freshTenant(): Promise<{ host: string; passphrase: string }> {
    const created = await httpRequest({
      port: ingressPort,
      method: 'POST',
      path: '/api/hosts',
      hostHeader: domain,
    });
    expect(created.status).toBe(201);
    return JSON.parse(created.body.toString()) as { host: string; passphrase: string };
  }

  async function put(
    tenant: { host: string; passphrase: string },
    path: string,
    body: string,
  ): Promise<number> {
    const res = await httpRequest({
      port: apachePort,
      method: 'PUT',
      path,
      hostHeader: `${tenant.host}.${domain}`,
      auth: { user: tenant.host, pass: tenant.passphrase },
      body,
    });
    return res.status;
  }

  async function listing(host: string): Promise<{ status: number; body: string }> {
    const res = await httpRequest({
      port: apachePort,
      method: 'GET',
      path: '/',
      hostHeader: `${host}.${domain}`,
    });
    return { status: res.status, body: res.body.toString() };
  }

  it('wraps a tenant with no .header.html in the default chrome', async () => {
    const tenant = await freshTenant();
    expect(await put(tenant, '/notes.txt', 'hello')).toBe(201);

    const list = await listing(tenant.host);
    expect(list.status).toBe(200);
    // The default chrome (bootstrap5) supplies the document preamble itself; with
    // SuppressHTMLPreamble Apache does not emit its own, so the body opens with
    // the chrome's doctype and carries its navbar brand.
    expect(list.body.trimStart().startsWith('<!DOCTYPE html>')).toBe(true);
    expect(list.body).toContain('navbar-brand');
    // The listed file is present in the body.
    expect(list.body).toContain('notes.txt');
  });

  it('uses a tenant-uploaded .header.html/.footer.html, hidden from the listing', async () => {
    const tenant = await freshTenant();
    expect(await put(tenant, '/notes.txt', 'hello')).toBe(201);
    expect(
      await put(tenant, '/.header.html', '<!DOCTYPE html><html><body><h1>MY-OWN-HEADER</h1>'),
    ).toBe(201);
    expect(await put(tenant, '/.footer.html', '<footer>MY-OWN-FOOTER</footer></body></html>')).toBe(
      201,
    );

    const list = await listing(tenant.host);
    expect(list.status).toBe(200);
    // The tenant's own chrome is used, not the default bootstrap5 navbar.
    expect(list.body).toContain('MY-OWN-HEADER');
    expect(list.body).toContain('MY-OWN-FOOTER');
    expect(list.body).not.toContain('navbar-brand');
    // The dotfiles must not appear as entries in the visible listing.
    expect(list.body).not.toContain('.header.html');
    expect(list.body).not.toContain('.footer.html');
    // The real content file is still listed.
    expect(list.body).toContain('notes.txt');
  });
});
