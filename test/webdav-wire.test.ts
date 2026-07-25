import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from 'webdav';
import { makeClient, makeDir, OffEndpointRedirectError, putFile } from '../src/webdav';

/**
 * What the client puts on the wire, against a loopback server that answers the
 * way Apache does: a collection URL carrying its trailing slash is served,
 * while a redirect names an origin the client never addressed.
 */
let server: http.Server;
let port = 0;
const seen: string[] = [];

beforeAll(async () => {
  // Building a client installs the redirect guard into the webdav patcher.
  makeClient('http://127.0.0.1:1', 'x', 'y');
  server = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (req.url === '/off/') {
      res.writeHead(301, { location: 'http://127.0.0.1:9/off/' });
      res.end();
      return;
    }
    res.writeHead(201);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(() => {
  server.close();
});

describe('webdav wire behaviour', () => {
  it('MKCOLs ancestors top-down as collections, then PUTs the file', async () => {
    const client = createClient(`http://127.0.0.1:${port}`);
    await makeDir(client, '/docs/plans');
    await putFile(client, '/docs/plans/x.html', Buffer.from('x'));
    expect(seen).toEqual(['MKCOL /docs/', 'MKCOL /docs/plans/', 'PUT /docs/plans/x.html']);
  });

  it('refuses a redirect that leaves the endpoint', async () => {
    const client = createClient(`http://127.0.0.1:${port}`);
    await expect(makeDir(client, '/off')).rejects.toBeInstanceOf(OffEndpointRedirectError);
  });
});
