import { describe, expect, inject, it } from 'vitest';
import { httpRequest } from './helpers/http';

const stack = inject('stack');
const { apachePort: port, domain, tenantA, tenantB } = stack;
const hostA = `${tenantA.label}.${domain}`;
const authA = { user: tenantA.label, pass: tenantA.pass };
const authB = { user: tenantB.label, pass: tenantB.pass };

// Asserts the discovery PoC 1 matrix against the live container: open reads,
// per-tenant authed writes, cross-tenant + anonymous writes denied.
describe('apache mod_dav matrix', () => {
  it('anonymous GET of the seeded asset -> 200', async () => {
    const res = await httpRequest({ port, method: 'GET', path: '/index.html', hostHeader: hostA });
    expect(res.status).toBe(200);
    expect(res.body.toString()).toContain(tenantA.label);
  });

  it('PUT as correct tenant -> 201, readable back, anonymous GET -> 200', async () => {
    const put = await httpRequest({
      port,
      method: 'PUT',
      path: '/upload.txt',
      hostHeader: hostA,
      auth: authA,
      body: 'hello-from-tenant-a',
    });
    expect(put.status).toBe(201);

    const authed = await httpRequest({ port, method: 'GET', path: '/upload.txt', hostHeader: hostA });
    expect(authed.status).toBe(200);
    expect(authed.body.toString()).toBe('hello-from-tenant-a');

    const anon = await httpRequest({ port, method: 'GET', path: '/upload.txt', hostHeader: hostA });
    expect(anon.status).toBe(200);
  });

  it('MKCOL as correct tenant -> 201; DELETE own file -> 204', async () => {
    const mkcol = await httpRequest({ port, method: 'MKCOL', path: '/collection/', hostHeader: hostA, auth: authA });
    expect(mkcol.status).toBe(201);

    const del = await httpRequest({ port, method: 'DELETE', path: '/upload.txt', hostHeader: hostA, auth: authA });
    expect(del.status).toBe(204);
  });

  it('cross-tenant write -> 401, nothing written', async () => {
    const put = await httpRequest({
      port,
      method: 'PUT',
      path: '/cross.txt',
      hostHeader: hostA,
      auth: authB,
      body: 'should not land',
    });
    // Cross-tenant denial surfaces as 401 (AH01629), not 403.
    expect(put.status).toBe(401);

    const check = await httpRequest({ port, method: 'GET', path: '/cross.txt', hostHeader: hostA });
    expect(check.status).toBe(404);
  });

  it('anonymous write -> 401', async () => {
    const put = await httpRequest({ port, method: 'PUT', path: '/anon.txt', hostHeader: hostA, body: 'nope' });
    expect(put.status).toBe(401);
  });
});
