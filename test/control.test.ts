import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareSync } from 'bcryptjs';
import { describe, expect, inject, it } from 'vitest';
import { httpRequest, type HttpResult } from './helpers/http';

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

function rotate(host: string, pass: string): Promise<HttpResult> {
  return httpRequest({
    port: controlPort,
    method: 'POST',
    path: `/api/hosts/${host}/rotate`,
    hostHeader: domain,
    auth: { user: host, pass },
  });
}

function remove(host: string, pass: string): Promise<HttpResult> {
  return httpRequest({
    port: controlPort,
    method: 'DELETE',
    path: `/api/hosts/${host}`,
    hostHeader: domain,
    auth: { user: host, pass },
  });
}

function davPut(host: string, pass: string): Promise<HttpResult> {
  return httpRequest({
    port: apachePort,
    method: 'PUT',
    path: '/index.html',
    hostHeader: `${host}.${domain}`,
    auth: { user: host, pass },
    body: '<h1>x</h1>',
  });
}

describe('control plane rotate', () => {
  it('issues a new passphrase; old WebDAV creds fail, new ones work (no reload)', async () => {
    const { host, passphrase: oldPass } = await create();

    const res = await rotate(host, oldPass);
    expect(res.status).toBe(200);
    const { passphrase: newPass } = JSON.parse(res.body.toString()) as { passphrase: string };
    expect(newPass).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(newPass).not.toBe(oldPass);

    // Apache re-reads htpasswd per request: the new passphrase authorizes
    // immediately and the old one is rejected, with no container reload.
    expect((await davPut(host, oldPass)).status).toBe(401);
    expect((await davPut(host, newPass)).status).toBe(201);
  });

  it('rejects a wrong passphrase with 401 and leaves htpasswd byte-identical', async () => {
    const { host, passphrase } = await create();
    const before = readFileSync(authFile);
    const res = await rotate(host, 'not-the-passphrase');
    expect(res.status).toBe(401);
    expect(readFileSync(authFile).equals(before)).toBe(true);
    // The real passphrase still works.
    expect(await verifyStillValid(host, passphrase)).toBe(true);
  });
});

describe('control plane remove', () => {
  it('deletes the host dir and entry on correct creds', async () => {
    const { host, passphrase } = await create();
    const res = await remove(host, passphrase);
    expect(res.status).toBe(204);
    expect(existsSync(join(dataDir, 'hosts', host))).toBe(false);
    expect(readFileSync(authFile, 'utf8').includes(`${host}:`)).toBe(false);
  });

  it('rejects wrong creds with 401 and removes nothing', async () => {
    const { host, passphrase } = await create();
    const res = await remove(host, 'not-the-passphrase');
    expect(res.status).toBe(401);
    expect(existsSync(join(dataDir, 'hosts', host, 'www'))).toBe(true);
    expect(readFileSync(authFile, 'utf8').includes(`${host}:`)).toBe(true);
    // Untouched: the real passphrase still authorizes.
    expect((await davPut(host, passphrase)).status).toBe(201);
  });
});

async function verifyStillValid(host: string, pass: string): Promise<boolean> {
  return (await rotate(host, pass)).status === 200;
}
