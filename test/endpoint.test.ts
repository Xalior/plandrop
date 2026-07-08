import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { controlUrl, hostBaseUri, hostUrl, normalizeBaseUri, timedFetch } from '../src/endpoint';

describe('normalizeBaseUri', () => {
  it('defaults a bare hostname to https', () => {
    expect(normalizeBaseUri('plandrop.example.com')).toBe('https://plandrop.example.com');
  });

  it('preserves an explicit http URI with port', () => {
    expect(normalizeBaseUri('http://localhost:8080')).toBe('http://localhost:8080');
  });

  it('preserves an explicit https URI with port', () => {
    expect(normalizeBaseUri('https://plandrop.example.com:8443')).toBe(
      'https://plandrop.example.com:8443',
    );
  });

  it('throws on an unparseable value', () => {
    expect(() => normalizeBaseUri('http://')).toThrow();
  });
});

describe('controlUrl', () => {
  it('joins the base origin with an api path', () => {
    expect(controlUrl('https://plandrop.example.com', '/api/hosts')).toBe(
      'https://plandrop.example.com/api/hosts',
    );
  });
});

describe('timedFetch', () => {
  function listen(server: Server): Promise<string> {
    return new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
      });
    });
  }

  it('rejects with a clear error when the host never answers', async () => {
    // Accepts the connection but never responds — the silent-host hang the
    // timeout exists for.
    const server = createServer(() => {});
    const base = await listen(server);
    try {
      await expect(timedFetch(`${base}/api/hosts`, { method: 'POST' }, 200)).rejects.toThrow(
        /no response from 127\.0\.0\.1:\d+ within \d+s/,
      );
    } finally {
      server.close();
    }
  });

  it('passes a timely response through untouched', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    const base = await listen(server);
    try {
      const res = await timedFetch(`${base}/api/templates`);
      expect(res.ok).toBe(true);
      expect(await res.json()).toEqual({ ok: true });
    } finally {
      server.close();
    }
  });
});

describe('hostBaseUri / hostUrl', () => {
  it('prepends the host label as a subdomain, preserving scheme', () => {
    expect(hostBaseUri('https://plandrop.example.com', 'abc')).toBe('https://abc.plandrop.example.com');
    expect(hostUrl('https://plandrop.example.com', 'abc')).toBe('https://abc.plandrop.example.com/');
  });

  it('preserves the port when present', () => {
    expect(hostBaseUri('http://localhost:8080', 'abc')).toBe('http://abc.localhost:8080');
    expect(hostUrl('http://localhost:8080', 'abc')).toBe('http://abc.localhost:8080/');
  });
});
