import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareSync } from 'bcryptjs';
import { describe, expect, inject, it } from 'vitest';
import { httpRequest } from './helpers/http';

const { controlPort, apachePort, domain, dataDir, authFile } = inject('stack');

interface Created {
  host: string;
  passphrase: string;
}

async function create(): Promise<Created> {
  const res = await httpRequest({
    port: controlPort,
    method: 'POST',
    path: '/api/hosts',
    hostHeader: domain,
  });
  expect(res.status).toBe(201);
  return JSON.parse(res.body.toString()) as Created;
}

describe('control plane create', () => {
  it('mints a host + passphrase, makes the dir, and writes a verifiable entry', async () => {
    const { host, passphrase } = await create();

    expect(host).toMatch(/^[a-z2-7]{16}$/);
    expect(passphrase).toMatch(/^[A-Za-z0-9_-]{22}$/);

    expect(existsSync(join(dataDir, 'hosts', host, 'www'))).toBe(true);

    const entry = readFileSync(authFile, 'utf8')
      .split('\n')
      .find((line) => line.startsWith(`${host}:`));
    expect(entry).toBeDefined();
    const hash = entry?.slice(host.length + 1) ?? '';
    expect(hash.startsWith('$2b$')).toBe(true);
    expect(compareSync(passphrase, hash)).toBe(true);
  });

  it('yields distinct hosts on repeated create', async () => {
    const first = await create();
    const second = await create();
    expect(first.host).not.toBe(second.host);
  });

  it('end-to-end: the returned creds authorize a WebDAV PUT to Apache', async () => {
    const { host, passphrase } = await create();
    const put = await httpRequest({
      port: apachePort,
      method: 'PUT',
      path: '/index.html',
      hostHeader: `${host}.${domain}`,
      auth: { user: host, pass: passphrase },
      body: '<h1>end to end</h1>',
    });
    expect(put.status).toBe(201);
  });
});
