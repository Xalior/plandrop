import { beforeAll, describe, expect, inject, it } from 'vitest';
import { httpRequest } from './helpers/http';

const stack = inject('stack');
const { apachePort: port, domain, tenantA, tenantB } = stack;
const hostA = `${tenantA.label}.${domain}`;
const authA = { user: tenantA.label, pass: tenantA.pass };
const authB = { user: tenantB.label, pass: tenantB.pass };

// Asserts the mod_dav access matrix against the live container: open reads,
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

// Apache listens on an internal port behind an operator's TLS proxy, so a
// Location it builds from its own socket names an origin the client cannot
// reach — and tells anyone reading it where the backend lives. Every
// self-referential URL must instead name the origin the request arrived on.
describe('apache self-referential URLs', () => {
  const dir = '/origin-probe';

  beforeAll(async () => {
    const mkcol = await httpRequest({ port, method: 'MKCOL', path: `${dir}/`, hostHeader: hostA, auth: authA });
    expect(mkcol.status).toBe(201);
  });

  it('redirects a slashless directory URL to the requested origin', async () => {
    const res = await httpRequest({ port, method: 'GET', path: dir, hostHeader: hostA });
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(`http://${hostA}${dir}/`);
    expect(res.headers.location).not.toContain(`:${port}`);
  });

  it('honours the scheme a TLS-terminating proxy declares', async () => {
    const res = await httpRequest({
      port,
      method: 'GET',
      path: dir,
      hostHeader: hostA,
      extraHeaders: { 'X-Forwarded-Proto': 'https' },
    });
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(`https://${hostA}${dir}/`);
  });

  it('preserves a non-default port the client named in Host', async () => {
    const res = await httpRequest({
      port,
      method: 'GET',
      path: dir,
      hostHeader: `${hostA}:9443`,
      extraHeaders: { 'X-Forwarded-Proto': 'https' },
    });
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(`https://${hostA}:9443${dir}/`);
  });

  // The client's collection probes are PROPFINDs, and they hit the same
  // redirect — the failure that made every subdirectory upload unreachable.
  it('redirects a slashless PROPFIND the same way', async () => {
    const res = await httpRequest({
      port,
      method: 'PROPFIND',
      path: dir,
      hostHeader: hostA,
      auth: authA,
      extraHeaders: { Depth: '0', 'X-Forwarded-Proto': 'https' },
    });
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(`https://${hostA}${dir}/`);
  });

  it('leaves mod_dav 201 Location headers origin-free', async () => {
    const mkcol = await httpRequest({
      port,
      method: 'MKCOL',
      path: `${dir}/nested/`,
      hostHeader: hostA,
      auth: authA,
    });
    expect(mkcol.status).toBe(201);
    expect(mkcol.headers.location).toBe(`${dir}/nested/`);

    const put = await httpRequest({
      port,
      method: 'PUT',
      path: `${dir}/nested/file.txt`,
      hostHeader: hostA,
      auth: authA,
      body: 'origin-free',
    });
    expect(put.status).toBe(201);
    expect(put.headers.location).toBe(`${dir}/nested/file.txt`);
  });

  // PROPFIND hrefs are already document-relative paths; assert it, because a
  // multistatus body full of absolute backend URLs would leak just as widely.
  it('reports PROPFIND hrefs as paths, not absolute URLs', async () => {
    const res = await httpRequest({
      port,
      method: 'PROPFIND',
      path: `${dir}/`,
      hostHeader: hostA,
      auth: authA,
      extraHeaders: { Depth: '1' },
    });
    expect(res.status).toBe(207);
    const body = res.body.toString();
    expect(body).toContain(`<D:href>${dir}/</D:href>`);
    expect(body).not.toMatch(/<D:href>[a-z]+:\/\//);
  });
});
