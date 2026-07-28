import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { hashSync } from 'bcryptjs';
import type { TestProject } from 'vitest/node';

// public/ — the compose file lives here, and bind paths resolve relative to it.
const pkgRoot = fileURLToPath(new URL('../../', import.meta.url));

const DOMAIN = 'plandrop.test';
const APACHE_PORT = 8788;
const PROXY_PORT = 8790;
// The CLI's parent domain is `localhost`; *.localhost tenant hosts resolve to
// both loopback families with ::1 offered first, so the proxy is published
// there and traffic that connects by name reaches it. Traffic that names an
// address must name this one: there is no IPv4 socket to fall back to, unlike
// apache and the ingress. Stated once and used for the compose publish, the
// readiness probe and the endpoint handed to tests, so the three can never
// disagree.
const PROXY_BIND = '::1';
// The parent domain the front proxy routes on: the bare name reaches the
// ingress, `*.<name>` reaches apache, and every other Host is refused with 421.
// It is NOT the same value as DOMAIN above: DOMAIN is only ever an Apache
// mod_vhost_alias selector on the direct-to-apache port, and the proxy has no
// route for it. A proxied request must name a host under this domain.
const PROXY_DOMAIN = 'localhost';
// The ingress is the only published control entrypoint: it serves the
// template statics and reverse-proxies /api/* to the (unpublished) control plane.
const INGRESS_PORT = 8791;
const PROJECT = 'plandrop-stack-test';
const TENANT_A = { label: 'tenanta', pass: 'passphraseaaaa' };
const TENANT_B = { label: 'tenantb', pass: 'passphrasebbbb' };
// A user-template fixture dropped into the operator user mount (separate from the
// fresh-seeded built-in volume). Proves enumeration as user/<name>, static
// serving, and that it survives an ingress re-seed.
const USER_TEMPLATE = 'house';

export interface Tenant {
  label: string;
  pass: string;
}

export interface Stack {
  apachePort: number;
  /**
   * Port for direct control-plane API calls. The control plane does not
   * publish a port; this is the ingress port, which proxies /api/* to it — so
   * every control test exercises the real front door.
   */
  controlPort: number;
  /** The ingress published port (template statics + /api proxy). */
  ingressPort: number;
  domain: string;
  dataDir: string;
  authFile: string;
  /** Base URI of the in-process host-router: localhost -> ingress, *.localhost -> apache. */
  proxyBase: string;
  /**
   * The front proxy endpoint, for requests aimed at it directly. Port and
   * connect address travel as ONE value so a caller spreads both or neither:
   * the proxy publishes on ::1 (where *.localhost resolves) while apache and
   * the ingress publish on 127.0.0.1, and a request that takes the port
   * without the address is refused outright.
   */
  proxy: { port: number; connectHost: string };
  /**
   * The parent domain the front proxy routes on. A proxied request names either
   * this domain (-> ingress) or a subdomain of it (-> apache); anything else is
   * refused with 421, `domain` above included.
   */
  proxyDomain: string;
  /** Pre-seeded fixture tenants for the Apache matrix. */
  tenantA: Tenant;
  tenantB: Tenant;
  /** Name of the operator user-template fixture (listed as user/<name>). */
  userTemplate: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    stack: Stack;
  }
}

function compose(args: string[], env: NodeJS.ProcessEnv): void {
  execFileSync('docker', ['compose', '-p', PROJECT, ...args], {
    cwd: pkgRoot,
    env,
    stdio: 'pipe',
  });
}

function probe(port: number, path: string, hostHeader: string, host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host, port, method: 'GET', path, headers: { Host: hostHeader } },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function waitFor(
  label: string,
  check: () => Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await check()) {
        return;
      }
    } catch {
      // service not accepting connections yet
    }
    if (Date.now() > deadline) {
      throw new Error(`${label} did not become ready in time`);
    }
    await sleep(500);
  }
}

export default async function setup(project: TestProject): Promise<() => void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'plandrop-stack-'));
  const hostsDir = join(dataDir, 'hosts');
  const authDir = join(dataDir, 'auth');
  const authFile = join(authDir, 'htpasswd');

  for (const tenant of [TENANT_A, TENANT_B]) {
    const www = join(hostsDir, tenant.label, 'www');
    mkdirSync(www, { recursive: true });
    writeFileSync(join(www, 'index.html'), `<h1>${tenant.label}</h1>\n`);
  }
  mkdirSync(authDir, { recursive: true });
  // bcryptjs $2b$ hashes authenticate directly against Apache mod_authn_file.
  const htpasswd =
    [TENANT_A, TENANT_B].map((t) => `${t.label}:${hashSync(t.pass, 10)}`).join('\n') + '\n';
  writeFileSync(authFile, htpasswd);

  // Operator user-templates mount (separate from the seeded built-in volume).
  // A single fixture template with a self-identifying template.html so tests can
  // assert enumeration (user/<name>), static serving, and survival across a
  // re-seed. It lives under the data dir, bind-mounted read-only via
  // PLANDROP_USER_TEMPLATES below.
  const userTemplatesDir = join(dataDir, 'user-templates');
  mkdirSync(join(userTemplatesDir, USER_TEMPLATE), { recursive: true });
  writeFileSync(
    join(userTemplatesDir, USER_TEMPLATE, 'template.html'),
    `<!DOCTYPE html>\n<html><head><title>house</title></head>\n<body><main>user template ${USER_TEMPLATE}</main></body></html>\n`,
  );

  // Run the containers as this host user so writes land as an owner of the
  // host-created data tree.
  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PLANDROP_DATA: dataDir,
    PLANDROP_APACHE_PORT: String(APACHE_PORT),
    PLANDROP_INGRESS_PORT: String(INGRESS_PORT),
    PLANDROP_PROXY_PORT: String(PROXY_PORT),
    PLANDROP_USER_TEMPLATES: userTemplatesDir,
    // The parent localhost resolves to ::1 too, so both the bare and the tenant
    // hops reach this one container.
    PLANDROP_PROXY_DOMAIN: PROXY_DOMAIN,
    PLANDROP_PROXY_BIND: PROXY_BIND,
    PLANDROP_UID: String(uid),
    PLANDROP_GID: String(gid),
  };

  // dist/server.js must exist for the control image build.
  execFileSync('pnpm', ['run', 'build'], { cwd: pkgRoot, stdio: 'pipe' });
  // The full dev stack: ingress seeds the theme volume + proxies /api to the
  // (unpublished) control plane; apache serves tenants + the shared /.plandrop;
  // proxy (the `testproxy` profile) is the front proxy the CLI targets — the
  // SAME nginx routing config manual browser testing uses. The control plane is
  // brought up implicitly as ingress depends on it.
  compose(['--profile', 'testproxy', 'up', '-d', '--build', 'ingress', 'apache', 'control', 'proxy'], env);

  await waitFor(
    'apache',
    async () => (await probe(APACHE_PORT, '/index.html', `${TENANT_A.label}.${DOMAIN}`)) === 200,
    60_000,
  );
  // Ingress serving the seeded starter means the theme volume is populated.
  await waitFor(
    'ingress',
    async () => (await probe(INGRESS_PORT, '/.plandrop/bootstrap5/template.html', DOMAIN)) === 200,
    60_000,
  );
  // The control plane is reachable only via the ingress proxy; a 200 from
  // /api/templates proves both the proxy hop and the control plane are up.
  await waitFor(
    'control (via ingress)',
    async () => (await probe(INGRESS_PORT, '/api/templates', DOMAIN)) === 200,
    60_000,
  );

  // The front-proxy container shares the harness's nginx routing config. The
  // path is deliberately one only the ingress can answer: the shared
  // /.plandrop/ tree is served by BOTH backends, so a 200 on it would say the
  // proxy is up without saying which way it routed.
  await waitFor(
    'proxy',
    async () => (await probe(PROXY_PORT, '/api/templates', PROXY_DOMAIN, PROXY_BIND)) === 200,
    30_000,
  );

  project.provide('stack', {
    apachePort: APACHE_PORT,
    // Control API calls route through the ingress (control is unpublished).
    controlPort: INGRESS_PORT,
    ingressPort: INGRESS_PORT,
    domain: DOMAIN,
    dataDir,
    authFile,
    proxyBase: `http://${PROXY_DOMAIN}:${PROXY_PORT}`,
    proxy: { port: PROXY_PORT, connectHost: PROXY_BIND },
    proxyDomain: PROXY_DOMAIN,
    tenantA: TENANT_A,
    tenantB: TENANT_B,
    userTemplate: USER_TEMPLATE,
  });

  return () => {
    try {
      compose(['--profile', 'testproxy', 'down', '-v'], env);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  };
}
