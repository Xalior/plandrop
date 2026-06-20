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
const CONTROL_PORT = 8789;
const PROJECT = 'plandrop-stack-test';
const TENANT_A = { label: 'tenanta', pass: 'passphraseaaaa' };
const TENANT_B = { label: 'tenantb', pass: 'passphrasebbbb' };

export interface Tenant {
  label: string;
  pass: string;
}

export interface Stack {
  apachePort: number;
  controlPort: number;
  domain: string;
  dataDir: string;
  authFile: string;
  /** Pre-seeded fixture tenants for the Apache matrix. */
  tenantA: Tenant;
  tenantB: Tenant;
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

function probe(port: number, path: string, hostHeader: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: 'GET', path, headers: { Host: hostHeader } },
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

  // Run the containers as this host user so writes land as an owner of the
  // host-created data tree.
  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PLANDROP_DATA: dataDir,
    PLANDROP_APACHE_PORT: String(APACHE_PORT),
    PLANDROP_CONTROL_PORT: String(CONTROL_PORT),
    PLANDROP_UID: String(uid),
    PLANDROP_GID: String(gid),
  };

  // dist/server.js must exist for the control image build.
  execFileSync('pnpm', ['run', 'build'], { cwd: pkgRoot, stdio: 'pipe' });
  compose(['up', '-d', '--build', 'apache', 'control'], env);

  await waitFor(
    'apache',
    async () => (await probe(APACHE_PORT, '/index.html', `${TENANT_A.label}.${DOMAIN}`)) === 200,
    60_000,
  );
  // Any HTTP response means the control plane is listening (GET / -> 404).
  await waitFor('control', async () => (await probe(CONTROL_PORT, '/', DOMAIN)) > 0, 60_000);

  project.provide('stack', {
    apachePort: APACHE_PORT,
    controlPort: CONTROL_PORT,
    domain: DOMAIN,
    dataDir,
    authFile,
    tenantA: TENANT_A,
    tenantB: TENANT_B,
  });

  return () => {
    try {
      compose(['down', '-v'], env);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  };
}
