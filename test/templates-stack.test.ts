import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { bootswatchThemes, customThemes } from '../scripts/gen-templates.mjs';
import { runCli } from './helpers/cli';
import { httpRequest } from './helpers/http';

const { ingressPort, apachePort, domain, proxyBase, proxy, proxyDomain, tenantA } =
  inject('stack');

const bootswatchDir = fileURLToPath(new URL('../node_modules/bootswatch', import.meta.url));
const customDir = fileURLToPath(new URL('../themes', import.meta.url));

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

  it('lists the full pinned Bootswatch set, the hand-authored themes and bootstrap5', async () => {
    const res = await httpRequest({
      port: ingressPort,
      method: 'GET',
      path: '/api/templates',
      hostHeader: domain,
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body.toString()) as TemplatesBody;
    const expected = [...bootswatchThemes(bootswatchDir), ...customThemes(customDir)];
    for (const theme of expected) {
      expect(body.templates).toContain(theme);
    }
    // The full set is the Bootswatch themes and the hand-authored ones plus the
    // bootstrap5 skeleton, plus any namespaced operator user/<name> templates
    // the harness drops in. The built-in count is therefore that set + 1;
    // user/* are extra.
    const builtins = body.templates.filter((name) => !name.startsWith('user/'));
    expect(builtins).toHaveLength(expected.length + 1);
  });
});

describe('ingress serves each generated theme starter', () => {
  it('serves template.html for a sample of generated themes', async () => {
    for (const theme of ['cerulean', 'darkly', 'zephyr', 'f1terminal']) {
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
    // self-update, the enhancer, and the override CSS are referenced by the
    // shared, theme-neutral paths, not per-theme.
    expect(html).toContain('.plandrop/shared/js/selfupdate.js');
    expect(html).toContain('.plandrop/shared/js/enhance.js');
    expect(html).toContain('.plandrop/shared/css/plandrop.css');
  });

  it('serves the hand-authored f1terminal starter with both appearances', async () => {
    const res = await httpRequest({
      port: ingressPort,
      method: 'GET',
      path: '/.plandrop/f1terminal/template.html',
      hostHeader: domain,
    });
    expect(res.status).toBe(200);
    const html = res.body.toString();
    // Dual-appearance: opens dark, carries the toggle button, and pulls the
    // shared toggle behaviour rather than an inlined copy of it. The button
    // states the scheme the theme opens in.
    expect(html).toContain('data-bs-theme="dark"');
    expect(html).toContain('data-bs-theme-toggle');
    expect(html).toContain('src="/.plandrop/shared/js/theme.js"');
    expect(html).toContain('aria-label="Toggle colour scheme, currently dark"');
    // Its own credit, not the Bootswatch one.
    expect(html).toContain('LGPL-3.0-only');
    expect(html).not.toContain('Bootswatch');

    // The assembled stylesheet resolves and carries both Bootstrap and the
    // theme's own layer, with a palette declared for each appearance.
    const css = await httpRequest({
      port: ingressPort,
      method: 'GET',
      path: '/.plandrop/f1terminal/css/bootstrap.min.css',
      hostHeader: domain,
    });
    expect(css.status).toBe(200);
    expect(css.headers['content-type']).toMatch(/text\/css/);
    const sheet = css.body.toString();
    expect(sheet).toContain('plandrop terminal theme');
    expect(sheet).toContain('[data-bs-theme="dark"]');
  });

  it('serves the shared, theme-neutral self-update JS once at /.plandrop/shared/', async () => {
    const res = await httpRequest({
      port: ingressPort,
      method: 'GET',
      path: '/.plandrop/shared/js/selfupdate.js',
      hostHeader: domain,
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    // The file:// guard ships with it (so static/local plans can carry it safely).
    expect(res.body.toString()).toContain('location.protocol');
  });

  it('serves the shared cross-theme override CSS once at /.plandrop/shared/', async () => {
    const res = await httpRequest({
      port: ingressPort,
      method: 'GET',
      path: '/.plandrop/shared/css/plandrop.css',
      hostHeader: domain,
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/css/);
    // The calm-green inline-code override rides on Bootstrap's custom property.
    expect(res.body.toString()).toContain('--bs-code-color');
  });

  it('serves the shared document enhancer and its vendored bundles', async () => {
    const enhancer = await httpRequest({
      port: ingressPort,
      method: 'GET',
      path: '/.plandrop/shared/js/enhance.js',
      hostHeader: domain,
    });
    expect(enhancer.status).toBe(200);
    expect(enhancer.headers['content-type']).toMatch(/javascript/);

    // The lazy-loaded vendor bundles resolve alongside it.
    for (const [path, type] of [
      ['/.plandrop/shared/vendor/mermaid/mermaid.min.js', /javascript/],
      ['/.plandrop/shared/vendor/highlight/highlight.min.js', /javascript/],
      ['/.plandrop/shared/vendor/highlight/styles/github.min.css', /text\/css/],
      ['/.plandrop/shared/vendor/highlight/styles/github-dark.min.css', /text\/css/],
    ] as const) {
      const res = await httpRequest({
        port: ingressPort,
        method: 'GET',
        path,
        hostHeader: domain,
      });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(type);
    }
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

// A document publishes at the subpath it occupies locally and links its theme
// relatively, so `.plandrop/` has to resolve from the document's own directory,
// not only from the host root — otherwise every document below the root renders
// unstyled and never self-updates.
describe('apache shared /.plandrop at any depth', () => {
  let tenantHost: string;
  let auth: { user: string; pass: string };

  beforeAll(async () => {
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
    tenantHost = `${host}.${domain}`;
    auth = { user: host, pass: passphrase };

    for (const dir of ['/plans/', '/plans/deep/']) {
      const mkcol = await httpRequest({
        port: apachePort,
        method: 'MKCOL',
        path: dir,
        hostHeader: tenantHost,
        auth,
      });
      expect(mkcol.status).toBe(201);
    }
    const put = await httpRequest({
      port: apachePort,
      method: 'PUT',
      path: '/plans/deep/x.html',
      hostHeader: tenantHost,
      auth,
      body: '<!DOCTYPE html><html><head>'
        + '<link rel="stylesheet" href=".plandrop/bootstrap5/css/bootstrap.min.css">'
        + '</head><body>deep</body></html>',
    });
    expect(put.status).toBe(201);
  });

  it('serves theme and shared assets relative to a nested document', async () => {
    const doc = await httpRequest({
      port: apachePort,
      method: 'GET',
      path: '/plans/deep/x.html',
      hostHeader: tenantHost,
    });
    expect(doc.status).toBe(200);

    for (const [path, type] of [
      ['/plans/deep/.plandrop/bootstrap5/css/bootstrap.min.css', /text\/css/],
      ['/plans/deep/.plandrop/shared/js/selfupdate.js', /javascript/],
      ['/plans/deep/.plandrop/shared/css/plandrop.css', /text\/css/],
      // One level down resolves the same way as three.
      ['/plans/.plandrop/f1terminal/css/bootstrap.min.css', /text\/css/],
    ] as const) {
      const res = await httpRequest({
        port: apachePort,
        method: 'GET',
        path,
        hostHeader: tenantHost,
      });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(type);
    }
  });

  it('still serves the namespace at the host root', async () => {
    const res = await httpRequest({
      port: apachePort,
      method: 'GET',
      path: '/.plandrop/bootstrap5/css/bootstrap.min.css',
      hostHeader: tenantHost,
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/css/);
  });

  it('404s an asset that does not exist, rather than reaching tenant content', async () => {
    const res = await httpRequest({
      port: apachePort,
      method: 'GET',
      path: '/plans/deep/.plandrop/nosuchtheme/css/bootstrap.min.css',
      hostHeader: tenantHost,
    });
    expect(res.status).toBe(404);
  });

  it('denies a tenant write anywhere in the .plandrop namespace', async () => {
    const put = await httpRequest({
      port: apachePort,
      method: 'PUT',
      path: '/plans/deep/.plandrop/evil.txt',
      hostHeader: tenantHost,
      auth,
      body: 'should not land',
    });
    expect(put.status).toBe(403);

    // Nothing landed: the path reads as the (read-only) theme tree, which has
    // no such file — the write did not fall through into the tenant tree.
    const check = await httpRequest({
      port: apachePort,
      method: 'GET',
      path: '/plans/deep/.plandrop/evil.txt',
      hostHeader: tenantHost,
    });
    expect(check.status).toBe(404);
  });

  it('denies a COPY or MOVE that lands in the namespace, leaving the source alone', async () => {
    const put = await httpRequest({
      port: apachePort,
      method: 'PUT',
      path: '/plans/src.txt',
      hostHeader: tenantHost,
      auth,
      body: 'movable',
    });
    expect(put.status).toBe(201);

    for (const method of ['MOVE', 'COPY']) {
      const res = await httpRequest({
        port: apachePort,
        method,
        path: '/plans/src.txt',
        hostHeader: tenantHost,
        auth,
        extraHeaders: { Destination: `http://${tenantHost}/plans/.plandrop/landed.txt` },
      });
      expect(res.status, method).toBe(403);
    }

    const source = await httpRequest({
      port: apachePort,
      method: 'GET',
      path: '/plans/src.txt',
      hostHeader: tenantHost,
    });
    expect(source.status).toBe(200);
  });

  it('denies MKCOL of a .plandrop collection, with or without its trailing slash', async () => {
    for (const path of ['/plans/.plandrop/', '/plans/.plandrop', '/.plandrop']) {
      const mkcol = await httpRequest({
        port: apachePort,
        method: 'MKCOL',
        path,
        hostHeader: tenantHost,
        auth,
      });
      expect(mkcol.status).toBe(403);
    }

    // The namespace still resolves to the theme tree afterwards.
    const asset = await httpRequest({
      port: apachePort,
      method: 'GET',
      path: '/plans/.plandrop/bootstrap5/css/bootstrap.min.css',
      hostHeader: tenantHost,
    });
    expect(asset.status).toBe(200);
  });
});

// `.plandrop` is the CLI's credential dotfile as well as the theme namespace.
// Everything a tenant publishes is world-readable, so a file of that name
// landing on a host would hand its passphrase — the write key — to every
// reader. Apache is the authoritative guard: it refuses every write method
// against that name at any depth, whatever route the request took to get there.
describe('apache refuses writes to the reserved .plandrop name', () => {
  let label: string;
  let tenantHost: string;
  let auth: { user: string; pass: string };

  beforeAll(async () => {
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
    label = host;
    tenantHost = `${host}.${domain}`;
    auth = { user: host, pass: passphrase };

    const mkcol = await httpRequest({
      port: apachePort,
      method: 'MKCOL',
      path: '/sub/',
      hostHeader: tenantHost,
      auth,
    });
    expect(mkcol.status).toBe(201);
  });

  // Direct to Apache and through the front proxy: the denial has to reach a
  // client whichever hop it came in on, since a proxy is the shape every real
  // deployment has. Apache's own guard is proven by the direct route; the
  // proxied route proves what a client actually sees.
  //
  // The two routes name the SAME tenant under DIFFERENT parent domains, because
  // the two hops select the vhost differently. Apache keys on the first host
  // label alone, so any parent works on the direct port. The front proxy routes
  // on the whole name and refuses one it has no route for, so a proxied request
  // has to sit under the proxy's own parent domain.
  const routes = [
    { name: 'apache', port: apachePort, connectHost: undefined, parent: domain },
    { name: 'front proxy', ...proxy, parent: proxyDomain },
  ] as const;

  describe.each(routes)('via $name', ({ port, connectHost, parent }) => {
    it.each(['PUT', 'DELETE', 'MKCOL', 'PROPPATCH', 'LOCK'])(
      'refuses %s of the bare name at the root and below',
      async (method) => {
        for (const path of ['/.plandrop', '/sub/.plandrop']) {
          const res = await httpRequest({
            port,
            connectHost,
            method,
            path,
            hostHeader: `${label}.${parent}`,
            auth,
            body: method === 'PUT' ? '{"passphrase":"leaked"}' : undefined,
          });
          expect(res.status, `${method} ${path}`).toBe(403);
        }
      },
    );

    it('refuses a COPY or MOVE landing on the name, leaving the source alone', async () => {
      const host = `${label}.${parent}`;
      const source = `/sub/movable-${port}.txt`;
      const put = await httpRequest({
        port,
        connectHost,
        method: 'PUT',
        path: source,
        hostHeader: host,
        auth,
        body: 'movable',
      });
      expect(put.status).toBe(201);

      for (const method of ['MOVE', 'COPY']) {
        for (const target of ['/.plandrop', '/sub/.plandrop']) {
          const res = await httpRequest({
            port,
            connectHost,
            method,
            path: source,
            hostHeader: host,
            auth,
            extraHeaders: { Destination: `http://${host}${target}` },
          });
          expect(res.status, `${method} -> ${target}`).toBe(403);
        }
      }

      const still = await httpRequest({
        port,
        connectHost,
        method: 'GET',
        path: source,
        hostHeader: host,
      });
      expect(still.status).toBe(200);
    });
  });

  it('leaves nothing of that name behind', async () => {
    for (const path of ['/.plandrop', '/sub/.plandrop']) {
      const res = await httpRequest({
        port: apachePort,
        method: 'GET',
        path,
        hostHeader: tenantHost,
      });
      // Neither write landed: /.plandrop is the shared theme mount (a directory
      // with no index), /sub/.plandrop simply does not exist.
      expect([403, 404]).toContain(res.status);
    }
  });

  // Apache's rule is on the exact segment, deliberately: the broad ban on
  // dotted paths belongs to the front proxy, which not every deployment has.
  it('reserves the exact segment only — a lookalike is an ordinary tenant write', async () => {
    for (const path of ['/.plandrop.bak', '/sub/x.plandrop', '/sub/plandrop']) {
      const put = await httpRequest({
        port: apachePort,
        method: 'PUT',
        path,
        hostHeader: tenantHost,
        auth,
        body: 'ordinary content',
      });
      expect(put.status, path).toBe(201);
    }
  });
});

// A dot-prefixed path segment is configuration or private data by convention,
// so the front proxy refuses one outright — every method, reads included —
// before a backend is troubled with it. The exceptions are the shared theme
// namespace in its `.plandrop/` form, and the two autoindex chrome names a
// tenant publishes on purpose.
describe('front proxy refuses hidden paths', () => {
  // Under the PROXY's parent domain, not the Apache-only one: the proxy routes
  // on the whole host name, so this is the name that reaches Apache through it.
  const tenantHost = `${tenantA.label}.${proxyDomain}`;

  function viaProxy(method: string, path: string, hostHeader = tenantHost) {
    return httpRequest({ ...proxy, method, path, hostHeader });
  }

  it('serves the theme namespace at the host root and at any depth', async () => {
    // The depth case is why the exception exists: a document whose asset links
    // are document-relative asks for them from its own directory.
    for (const path of [
      '/.plandrop/bootstrap5/css/bootstrap.min.css',
      '/plans/.plandrop/bootstrap5/css/bootstrap.min.css',
      '/plans/deep/.plandrop/shared/js/selfupdate.js',
    ]) {
      const res = await viaProxy('GET', path);
      expect(res.status, path).toBe(200);
    }
  });

  it('serves the theme namespace on the parent domain too', async () => {
    const res = await viaProxy('GET', '/.plandrop/bootstrap5/template.html', proxyDomain);
    expect(res.status).toBe(200);
  });

  it('refuses the bare name, which is the credential file and not the namespace', async () => {
    for (const path of ['/.plandrop', '/sub/.plandrop']) {
      const res = await viaProxy('GET', path);
      expect(res.status, path).toBe(403);
    }
  });

  it.each(['/.git/config', '/sub/.env', '/.ssh/id_rsa', '/plans/.plandrop/.evil'])(
    'refuses a read of %s',
    async (path) => {
      expect((await viaProxy('GET', path)).status).toBe(403);
    },
  );

  it.each(['PUT', 'DELETE', 'MKCOL', 'PROPFIND'])('refuses %s of a dotted path', async (method) => {
    expect((await viaProxy(method, '/sub/.env')).status).toBe(403);
  });

  it('leaves a name that merely contains a dot alone', async () => {
    for (const path of ['/x.plandrop', '/index.html', '/plandrop.html']) {
      const res = await viaProxy('GET', path);
      expect(res.status, path).not.toBe(403);
    }
  });

  // Without this exception a self-contained stack's own client could not
  // publish the chrome it is allowed to publish: the upload rides this proxy.
  it('passes the tenant autoindex chrome through, written and read, at any depth', async () => {
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
    const chromeHost = `${host}.${proxyDomain}`;
    const auth = { user: host, pass: passphrase };

    const mkcol = await httpRequest({
      ...proxy,
      method: 'MKCOL',
      path: '/sub/',
      hostHeader: chromeHost,
      auth,
    });
    expect(mkcol.status).toBe(201);

    for (const path of ['/.header.html', '/.footer.html', '/sub/.header.html', '/sub/.footer.html']) {
      const put = await httpRequest({
        ...proxy,
        method: 'PUT',
        path,
        hostHeader: chromeHost,
        auth,
        body: `<!-- chrome ${path} -->`,
      });
      expect(put.status, `PUT ${path}`).toBe(201);

      const get = await httpRequest({
        ...proxy,
        method: 'GET',
        path,
        hostHeader: chromeHost,
      });
      expect(get.status, `GET ${path}`).toBe(200);
      expect(get.body.toString()).toContain(`chrome ${path}`);
    }

    // The exception is the two whole basenames, nothing shaped like them, and
    // it buys the neighbouring dotted names nothing.
    for (const path of [
      '/.header.html.bak',
      '/sub/.footer.html~',
      '/.header.htm',
      '/.headers.html',
      '/sub/.env',
    ]) {
      const put = await httpRequest({
        ...proxy,
        method: 'PUT',
        path,
        hostHeader: chromeHost,
        auth,
        body: 'should not land',
      });
      expect(put.status, `PUT ${path}`).toBe(403);
      expect((await viaProxy('GET', path, chromeHost)).status, `GET ${path}`).toBe(403);
    }
  });

  it('is the proxy rule, not Apache: the same path reaching Apache directly is a plain 404', async () => {
    const res = await httpRequest({
      port: apachePort,
      method: 'GET',
      path: '/.git/config',
      hostHeader: tenantHost,
    });
    expect(res.status).toBe(404);
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

  it('serves styled chrome at any directory depth (absolute assets + marker class)', async () => {
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
    const auth = { user: host, pass: passphrase };

    // A file one level down: MKCOL the collection, then PUT into it.
    const mkcol = await httpRequest({
      port: apachePort,
      method: 'MKCOL',
      path: '/docs/',
      hostHeader: tenantHost,
      auth,
    });
    expect(mkcol.status).toBe(201);
    const put = await httpRequest({
      port: apachePort,
      method: 'PUT',
      path: '/docs/deep.txt',
      hostHeader: tenantHost,
      auth,
      body: 'hello from below',
    });
    expect(put.status).toBe(201);

    // The subdirectory listing must carry the default chrome with ABSOLUTE
    // asset links — a relative .plandrop/… resolves against /docs/ and 404s,
    // rendering the listing unstyled — plus the marker class the shared
    // stylesheet scopes the listing table styling on.
    const listing = await httpRequest({
      port: apachePort,
      method: 'GET',
      path: '/docs/',
      hostHeader: tenantHost,
    });
    expect(listing.status).toBe(200);
    const html = listing.body.toString();
    expect(html).toContain('deep.txt');
    expect(html).toContain('href="/.plandrop/');
    expect(html).not.toContain('href=".plandrop/');
    expect(html).toContain('class="plandrop-autoindex"');
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

  it('scaffolds from --domain with no .plandrop (template-server mode)', () => {
    // No `create`, so no dotfile: newdoc resolves the template server straight
    // from --domain. This is how `newdoc --domain plandrop.dev` works against the
    // static, publish-less template host.
    expect(existsSync(join(cwd, '.plandrop'))).toBe(false);
    const made = runCli(['newdoc', 'nodot.html', '--domain', proxyBase], { cwd, env: env() });
    expect(made.status).toBe(0);
    const doc = readFileSync(join(cwd, 'nodot.html'), 'utf8');
    expect(doc).toContain('.plandrop/bootstrap5/css/bootstrap.min.css');
    // Still no dotfile written — newdoc only scaffolds a file.
    expect(existsSync(join(cwd, '.plandrop'))).toBe(false);
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

  it('scaffolds from a hand-authored theme like any other', () => {
    expect(runCli(['create', '--domain', proxyBase], { cwd, env: env() }).status).toBe(0);
    expect(
      runCli(['newdoc', 'term.html', '--template', 'f1terminal'], { cwd, env: env() }).status,
    ).toBe(0);
    const doc = readFileSync(join(cwd, 'term.html'), 'utf8');
    expect(doc).toContain('.plandrop/f1terminal/css/bootstrap.min.css');
    expect(doc).toContain('data-plandrop-theme="f1terminal"');
    // The enhancers ship with it exactly as they do with every other theme.
    expect(doc).toContain('.plandrop/shared/js/enhance.js');
    expect(doc).toContain('.plandrop/shared/js/selfupdate.js');
    expect(doc).not.toContain('.plandrop/bootstrap5/');
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

  it('every asset the written doc references resolves at the host root when published at a subpath, without the depth alias', async () => {
    expect(runCli(['create', '--domain', proxyBase], { cwd, env: env() }).status).toBe(0);
    expect(runCli(['newdoc', 'plan.html'], { cwd, env: env() }).status).toBe(0);

    const dotfile = JSON.parse(readFileSync(join(cwd, '.plandrop'), 'utf8')) as {
      host: string;
      passphrase: string;
    };
    const tenantHost = `${dotfile.host}.${domain}`;
    const auth = { user: dotfile.host, pass: dotfile.passphrase };
    const doc = readFileSync(join(cwd, 'plan.html'), 'utf8');

    // Every asset ref the scaffold ships with names the template server
    // outright — never document-relative — so it survives being published at
    // any subpath, and resolves on disk before the document is published at all.
    const refs = [...doc.matchAll(/(?:href|src)="([^"]*\.plandrop\/[^"]+)"/g)]
      .map((m) => m[1])
      .filter((ref): ref is string => ref !== undefined);
    expect(refs.length).toBeGreaterThan(2);
    for (const ref of refs) {
      expect(ref.startsWith(`${proxyBase}/.plandrop/`)).toBe(true);
    }

    // Publish it two levels down, where `upload plans` puts a document kept in
    // ./plans/deep/.
    for (const dir of ['/plans/', '/plans/deep/']) {
      const mkcol = await httpRequest({
        port: apachePort,
        method: 'MKCOL',
        path: dir,
        hostHeader: tenantHost,
        auth,
      });
      expect(mkcol.status).toBe(201);
    }
    const put = await httpRequest({
      port: apachePort,
      method: 'PUT',
      path: '/plans/deep/plan.html',
      hostHeader: tenantHost,
      auth,
      body: doc,
    });
    expect(put.status).toBe(201);

    // Every ref answers at the origin it names — the template server, which is
    // where a browser will actually fetch it from, on disk or published.
    for (const ref of refs) {
      const url = new URL(ref);
      const res = await httpRequest({
        ...proxy,
        method: 'GET',
        path: url.pathname,
        // Ask for exactly the host the ref names — the bare parent domain, which
        // the proxy routes to the ingress. The connection itself goes to ::1,
        // where the front proxy publishes.
        hostHeader: url.hostname,
      });
      expect(res.status, ref).toBe(200);
    }

    // And the same path resolves straight off the HOST ROOT (not
    // "/plans/deep" + ref), so a document published below the root renders
    // without leaning on any depth alias.
    for (const ref of refs) {
      const res = await httpRequest({
        port: apachePort,
        method: 'GET',
        path: new URL(ref).pathname,
        hostHeader: tenantHost,
      });
      expect(res.status, ref).toBe(200);
    }
  });
});

// `upload .` is run from the very directory the credential dotfile lives in —
// the ordinary case, and the one that would leak the host's passphrase if the
// walker published everything it found.
describe('upload leaves hidden files behind (CLI -> proxy -> apache)', () => {
  let cwd: string;
  let configHome: string;

  beforeEach(() => {
    // A hidden working directory on purpose: `upload .` names the cwd, whose
    // own basename is incidental, so the hidden-name refusal must not fire on it.
    cwd = mkdtempSync(join(tmpdir(), '.plandrop-upload-'));
    configHome = mkdtempSync(join(tmpdir(), 'plandrop-cfg-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(configHome, { recursive: true, force: true });
  });

  function env(): NodeJS.ProcessEnv {
    return { ...process.env, XDG_CONFIG_HOME: configHome, PLANDROP_DOMAIN: '' };
  }

  it('publishes the tree without them, says so, and lands nothing hidden on the host', async () => {
    expect(runCli(['create', '--domain', proxyBase], { cwd, env: env() }).status).toBe(0);

    const dotfile = JSON.parse(readFileSync(join(cwd, '.plandrop'), 'utf8')) as {
      host: string;
      passphrase: string;
    };
    const tenantHost = `${dotfile.host}.${domain}`;

    // A tree that looks like real work: a document, a subdirectory, a nested
    // project carrying a second credential dotfile, an .env, and a repo.
    writeFileSync(join(cwd, 'index.html'), '<h1>plan</h1>');
    writeFileSync(join(cwd, '.env'), 'API_KEY=secret');
    // The tenant's own listing chrome: hidden, but published on purpose.
    writeFileSync(join(cwd, '.header.html'), '<header>MY-CHROME</header>');
    writeFileSync(join(cwd, '.footer.html'), '<footer>MY-CHROME</footer>');
    mkdirSync(join(cwd, 'sub'), { recursive: true });
    writeFileSync(join(cwd, 'sub', 'note.txt'), 'notes');
    writeFileSync(join(cwd, 'sub', '.plandrop'), '{"passphrase":"nested-secret"}');
    mkdirSync(join(cwd, '.git', 'objects', 'ab'), { recursive: true });
    writeFileSync(join(cwd, '.git', 'config'), 'url = private');
    writeFileSync(join(cwd, '.git', 'objects', 'ab', 'cdef'), 'blob');

    const uploaded = runCli(['upload', '.'], { cwd, env: env() });
    expect(uploaded.status).toBe(0);
    expect(uploaded.stdout).toContain('index.html');
    expect(uploaded.stdout).toContain('sub/note.txt');
    // One visible line per omission, at both depths, naming the credential
    // family as such and the rest as merely hidden.
    expect(uploaded.stdout).toMatch(/^skipped \.plandrop \(plandrop credential file\)$/m);
    expect(uploaded.stdout).toMatch(/^skipped sub[/\\]\.plandrop \(plandrop credential file\)$/m);
    expect(uploaded.stdout).toMatch(/^skipped \.env \(hidden\)$/m);
    // The repo is one line, not one per object, and nothing inside it is named.
    expect(uploaded.stdout).toMatch(/^skipped \.git[/\\] \(hidden\)$/m);
    expect(uploaded.stdout).not.toContain('cdef');
    // The passphrase is never even named as uploaded.
    expect(uploaded.stdout).not.toContain(dotfile.passphrase);

    // The chrome went, silently and without a skip line, like ordinary content.
    expect(uploaded.stdout).not.toMatch(/^skipped .*\.(header|footer)\.html/m);

    for (const path of ['/index.html', '/sub/note.txt', '/.header.html', '/.footer.html']) {
      const res = await httpRequest({
        port: apachePort,
        method: 'GET',
        path,
        hostHeader: tenantHost,
      });
      expect(res.status, path).toBe(200);
    }

    // Nothing hidden reached the host, at any depth.
    for (const path of ['/sub/.plandrop', '/.env', '/.git/config']) {
      const res = await httpRequest({
        port: apachePort,
        method: 'GET',
        path,
        hostHeader: tenantHost,
      });
      expect(res.status, path).toBe(404);
    }

    // The local hidden files are untouched — skipped, not consumed.
    expect(existsSync(join(cwd, '.plandrop'))).toBe(true);
    expect(existsSync(join(cwd, 'sub', '.plandrop'))).toBe(true);
    expect(existsSync(join(cwd, '.git', 'config'))).toBe(true);
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
