import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import type { TestProject } from 'vitest/node';

// public/ — the compose file lives here, and bind paths resolve relative to it.
const pkgRoot = fileURLToPath(new URL('../../', import.meta.url));

const DOMAIN = 'plandrop.test';
const PORT = 8788;
const PROJECT = 'plandrop-apache-test';
const TENANT_A = { label: 'tenanta', pass: 'passphraseaaaa' };
const TENANT_B = { label: 'tenantb', pass: 'passphrasebbbb' };

export interface Tenant {
  label: string;
  pass: string;
}

export interface ApacheFixture {
  port: number;
  domain: string;
  tenantA: Tenant;
  tenantB: Tenant;
}

declare module 'vitest' {
  export interface ProvidedContext {
    apache: ApacheFixture;
  }
}

/** Generate a bcrypt htpasswd line using the image's own htpasswd tool. */
function htpasswdLine(tenant: Tenant): string {
  const out = execFileSync(
    'docker',
    ['run', '--rm', 'httpd:2.4', 'htpasswd', '-nbB', tenant.label, tenant.pass],
    { encoding: 'utf8' },
  );
  return out.trim();
}

function compose(args: string[], env: NodeJS.ProcessEnv): void {
  execFileSync('docker', ['compose', '-p', PROJECT, ...args], {
    cwd: pkgRoot,
    env,
    stdio: 'pipe',
  });
}

function get(path: string, hostHeader: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, method: 'GET', path, headers: { Host: hostHeader } },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function waitForReady(hostHeader: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const status = await get('/index.html', hostHeader);
      if (status === 200) {
        return;
      }
    } catch {
      // container not accepting connections yet
    }
    if (Date.now() > deadline) {
      throw new Error('apache container did not become ready in time');
    }
    await sleep(500);
  }
}

export default async function setup(project: TestProject): Promise<() => void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'plandrop-apache-'));
  const hostsDir = join(dataDir, 'hosts');
  const authDir = join(dataDir, 'auth');

  for (const tenant of [TENANT_A, TENANT_B]) {
    const www = join(hostsDir, tenant.label, 'www');
    mkdirSync(www, { recursive: true });
    writeFileSync(join(www, 'index.html'), `<h1>${tenant.label}</h1>\n`);
  }
  mkdirSync(authDir, { recursive: true });
  const htpasswd = [TENANT_A, TENANT_B].map(htpasswdLine).join('\n') + '\n';
  writeFileSync(join(authDir, 'htpasswd'), htpasswd);

  // Run the container as this host user so DAV writes land as an owner of the
  // (host-created) data tree — no world-writable hack needed.
  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PLANDROP_DATA: dataDir,
    PLANDROP_APACHE_PORT: String(PORT),
    PLANDROP_UID: String(uid),
    PLANDROP_GID: String(gid),
  };

  compose(['up', '-d', 'apache'], env);
  await waitForReady(`${TENANT_A.label}.${DOMAIN}`, 30_000);

  project.provide('apache', {
    port: PORT,
    domain: DOMAIN,
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
