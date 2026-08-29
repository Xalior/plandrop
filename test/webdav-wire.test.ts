import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from 'webdav';
import {
  deleteFile,
  isRemoteDirectory,
  makeClient,
  makeDir,
  OffEndpointRedirectError,
  putFile,
  RemoteNotFoundError,
} from '../src/webdav';

/**
 * What the client puts on the wire, against a loopback server that answers the
 * way Apache does: a collection URL carrying its trailing slash is served,
 * while a redirect names an origin the client never addressed.
 */
let server: http.Server;
let port = 0;
const seen: string[] = [];

/** A minimal PROPFIND multistatus response naming one resource's type. */
function statResponse(href: string, type: 'file' | 'directory'): string {
  const resourcetype = type === 'directory' ? '<D:resourcetype><D:collection/></D:resourcetype>' : '<D:resourcetype/>';
  return `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>${href}</D:href>
    <D:propstat>
      <D:prop>
        ${resourcetype}
        <D:getcontentlength>0</D:getcontentlength>
        <D:getlastmodified>Mon, 01 Jan 2024 00:00:00 GMT</D:getlastmodified>
        <D:getetag>"stub"</D:getetag>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
}

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
    // A directory named without its trailing slash. Apache's DirectorySlash
    // answers with a redirect to the slashed form, and behind a front proxy
    // that Location routinely names another origin (a dropped port, say).
    if (req.url === '/dir') {
      res.writeHead(301, { location: 'http://127.0.0.1:9/dir/' });
      res.end();
      return;
    }
    // A redirect off the endpoint that is NOT a trailing-slash correction.
    if (req.url === '/elsewhere.html') {
      res.writeHead(301, { location: 'http://127.0.0.1:9/somewhere/else.html' });
      res.end();
      return;
    }
    if (req.method === 'PROPFIND') {
      if (req.url === '/dir/') {
        res.writeHead(207, { 'content-type': 'application/xml' });
        res.end(statResponse('/dir/', 'directory'));
        return;
      }
      if (req.url === '/file.html') {
        res.writeHead(207, { 'content-type': 'application/xml' });
        res.end(statResponse('/file.html', 'file'));
        return;
      }
      res.writeHead(404);
      res.end();
      return;
    }
    if (req.method === 'DELETE') {
      if (req.url === '/missing.html') {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(204);
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

  it('stats a collection as a directory', async () => {
    const client = createClient(`http://127.0.0.1:${port}`);
    await expect(isRemoteDirectory(client, '/dir/')).resolves.toBe(true);
  });

  it('stats an ordinary resource as a file', async () => {
    const client = createClient(`http://127.0.0.1:${port}`);
    await expect(isRemoteDirectory(client, '/file.html')).resolves.toBe(false);
  });

  it('reads a trailing-slash redirect as the directory it names', async () => {
    // Apache redirects a directory named without its slash, and behind a front
    // proxy the Location names another origin, so the redirect is refused —
    // correctly, since following it would leave the endpoint. The refusal
    // still identifies the path as a directory, which is what a delete has to
    // know. Without this, `delete somedir` reports a front-proxy
    // misconfiguration instead of "that is a directory".
    const client = createClient(`http://127.0.0.1:${port}`);
    await expect(isRemoteDirectory(client, '/dir')).resolves.toBe(true);
  });

  it('still refuses a redirect that is not a trailing-slash correction', async () => {
    const client = createClient(`http://127.0.0.1:${port}`);
    await expect(isRemoteDirectory(client, '/elsewhere.html')).rejects.toBeInstanceOf(
      OffEndpointRedirectError,
    );
  });

  it('maps a stat 404 to RemoteNotFoundError, naming the path', async () => {
    const client = createClient(`http://127.0.0.1:${port}`);
    await expect(isRemoteDirectory(client, '/missing.html')).rejects.toThrow(RemoteNotFoundError);
    await expect(isRemoteDirectory(client, '/missing.html')).rejects.toThrow('/missing.html');
  });

  it('DELETEs exactly the path named', async () => {
    const client = createClient(`http://127.0.0.1:${port}`);
    await deleteFile(client, '/file.html');
    expect(seen).toContain('DELETE /file.html');
  });

  it('maps a delete 404 to RemoteNotFoundError', async () => {
    const client = createClient(`http://127.0.0.1:${port}`);
    await expect(deleteFile(client, '/missing.html')).rejects.toBeInstanceOf(RemoteNotFoundError);
  });
});
