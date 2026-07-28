import { describe, expect, inject, it } from 'vitest';
import { httpRequest } from './helpers/http';

const { domain, proxy, proxyDomain, tenantA } = inject('stack');

/**
 * The front proxy is the single published port of the self-contained stack, and
 * the `Host` header is the only thing that decides which backend a request
 * reaches: the bare parent domain goes to the ingress (the control entrypoint),
 * a subdomain goes to Apache (the tenant vhosts), and nothing else is routed at
 * all.
 *
 * Proving that needs paths each backend answers DIFFERENTLY. The shared
 * `/.plandrop/` theme tree is served by both, so a 200 on it says a backend
 * answered without saying which one — the trap that let a catch-all proxy look
 * correct. `/api/*` exists only on the ingress, and a tenant's own document
 * exists only on Apache.
 */
describe('front proxy routes by Host', () => {
  const tenantHost = `${tenantA.label}.${proxyDomain}`;

  it('sends the bare parent domain to the ingress', async () => {
    const res = await httpRequest({
      ...proxy,
      method: 'GET',
      path: '/api/templates',
      hostHeader: proxyDomain,
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    const body = JSON.parse(res.body.toString()) as { default: string };
    expect(body.default).toBe('bootstrap5');
  });

  it('sends a tenant subdomain to apache, and not to the ingress', async () => {
    const page = await httpRequest({
      ...proxy,
      method: 'GET',
      path: '/index.html',
      hostHeader: tenantHost,
    });
    expect(page.status).toBe(200);
    expect(page.body.toString()).toContain(tenantA.label);

    // The same path that answers on the parent domain has no answer here: the
    // control API lives on the ingress alone, and this request never met it.
    const api = await httpRequest({
      ...proxy,
      method: 'GET',
      path: '/api/templates',
      hostHeader: tenantHost,
    });
    expect(api.status).toBe(404);
  });

  // The wildcard matches at any depth, deliberately: Apache selects the docroot
  // from the FIRST host label, so a deeper name is the same tenant and refusing
  // it at the proxy would disagree with the backend it fronts.
  it('sends a deeper subdomain to the same tenant', async () => {
    const res = await httpRequest({
      ...proxy,
      method: 'GET',
      path: '/index.html',
      hostHeader: `${tenantA.label}.extra.${proxyDomain}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.toString()).toContain(tenantA.label);
  });

  // The other half of the same rule, and the one that matters to anyone running
  // this stack: a Host with no route is answered by the proxy, never forwarded.
  describe('refuses a Host it has no route for', () => {
    // `domain` is the harness's Apache-only vhost selector — a name that is real
    // to the backend and meaningless to the proxy, which is exactly the case a
    // catch-all made invisible. The rest are the shapes a stray request takes:
    // an unrelated public name, the host's own address, and an IPv6 literal.
    const strangers = [domain, 'example.com', '127.0.0.1', '[::1]'];

    it.each(strangers)('answers 421 for Host: %s', async (hostHeader) => {
      const res = await httpRequest({
        ...proxy,
        method: 'GET',
        path: '/',
        hostHeader,
      });
      expect(res.status).toBe(421);
    });

    it('refuses even a path both backends would have served', async () => {
      const res = await httpRequest({
        ...proxy,
        method: 'GET',
        path: '/.plandrop/bootstrap5/template.html',
        hostHeader: domain,
      });
      expect(res.status).toBe(421);
    });

    it('refuses a write, so no unrouted Host can reach WebDAV', async () => {
      const res = await httpRequest({
        ...proxy,
        method: 'PUT',
        path: '/planted.html',
        hostHeader: domain,
        auth: { user: tenantA.label, pass: tenantA.pass },
        body: '<h1>planted</h1>',
      });
      expect(res.status).toBe(421);

      // And nothing landed: the tenant those credentials belong to is untouched.
      const check = await httpRequest({
        ...proxy,
        method: 'GET',
        path: '/planted.html',
        hostHeader: tenantHost,
      });
      expect(check.status).toBe(404);
    });

    it('says what happened in plain text, without echoing the Host back', async () => {
      const res = await httpRequest({
        ...proxy,
        method: 'GET',
        path: '/',
        hostHeader: 'stray.example.net',
      });
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      const body = res.body.toString();
      // Enough to act on: which domain this stack does serve, and the setting
      // that changes it.
      expect(body).toContain(proxyDomain);
      expect(body).toContain('PLANDROP_PROXY_DOMAIN');
      // The Host is caller-controlled and this body goes back to the caller.
      expect(body).not.toContain('stray.example.net');
    });
  });
});
