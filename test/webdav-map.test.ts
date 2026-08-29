import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebDAVClient } from 'webdav';
import {
  collectionChain,
  deleteFile,
  isRemoteDirectory,
  makeDir,
  OffEndpointRedirectError,
  putFile,
  RemoteNotFoundError,
  sameOriginFetch,
  WrongTenantError,
} from '../src/webdav';

function throwingClient(status: number): WebDAVClient {
  const throwStatus = (): never => {
    throw Object.assign(new Error('http error'), { status });
  };
  return {
    putFileContents: throwStatus,
    createDirectory: throwStatus,
    stat: throwStatus,
    deleteFile: throwStatus,
  } as unknown as WebDAVClient;
}

/** A client that records the collections it is asked to create. */
function recordingClient(calls: string[]): WebDAVClient {
  return {
    createDirectory: (path: string) => {
      calls.push(path);
      return Promise.resolve();
    },
  } as unknown as WebDAVClient;
}

function redirectTo(location: string): Response {
  return new Response(null, { status: 301, headers: { location } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('webdav error mapping', () => {
  it('maps a 401 on PUT to WrongTenantError (no retry)', async () => {
    await expect(putFile(throwingClient(401), '/x', Buffer.from('x'))).rejects.toBeInstanceOf(
      WrongTenantError,
    );
  });

  it('maps a 401 on MKCOL to WrongTenantError', async () => {
    await expect(makeDir(throwingClient(401), '/dir')).rejects.toBeInstanceOf(WrongTenantError);
  });

  it('treats a 405 on MKCOL (collection exists) as success', async () => {
    await expect(makeDir(throwingClient(405), '/dir')).resolves.toBeUndefined();
  });

  it('passes a non-401 error through unchanged', async () => {
    await expect(putFile(throwingClient(500), '/x', Buffer.from('x'))).rejects.not.toBeInstanceOf(
      WrongTenantError,
    );
  });

  it('maps a 401 on stat to WrongTenantError', async () => {
    await expect(isRemoteDirectory(throwingClient(401), '/x')).rejects.toBeInstanceOf(WrongTenantError);
  });

  it('maps a 404 on stat to RemoteNotFoundError', async () => {
    await expect(isRemoteDirectory(throwingClient(404), '/x')).rejects.toBeInstanceOf(
      RemoteNotFoundError,
    );
  });

  it('maps a 401 on delete to WrongTenantError', async () => {
    await expect(deleteFile(throwingClient(401), '/x')).rejects.toBeInstanceOf(WrongTenantError);
  });

  it('maps a 404 on delete to RemoteNotFoundError', async () => {
    await expect(deleteFile(throwingClient(404), '/x')).rejects.toBeInstanceOf(RemoteNotFoundError);
  });
});

describe('collectionChain', () => {
  it('walks the ancestors top-down, each with a trailing slash', () => {
    expect(collectionChain('/a/b/c')).toEqual(['/a/', '/a/b/', '/a/b/c/']);
    expect(collectionChain('/evidence')).toEqual(['/evidence/']);
    expect(collectionChain('/')).toEqual([]);
  });
});

describe('makeDir', () => {
  it('MKCOLs every ancestor, addressing each as a collection', async () => {
    const calls: string[] = [];
    await makeDir(recordingClient(calls), '/docs/plans');
    expect(calls).toEqual(['/docs/', '/docs/plans/']);
  });
});

describe('sameOriginFetch', () => {
  it('returns a non-redirect response as it stands', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('ok', { status: 201 })));
    const response = await sameOriginFetch('https://h.example/evidence/');
    expect(response.status).toBe(201);
  });

  it('follows a redirect that stays on the endpoint', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      seen.push(url);
      return Promise.resolve(
        url.endsWith('/') ? new Response('ok', { status: 200 }) : redirectTo('/evidence/'),
      );
    });
    const response = await sameOriginFetch('https://h.example/evidence');
    expect(response.status).toBe(200);
    expect(seen).toEqual(['https://h.example/evidence', 'https://h.example/evidence/']);
  });

  it('rejects a redirect that changes origin, naming both', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(redirectTo('http://h.example:8080/evidence/')));
    const failure = sameOriginFetch('https://h.example/evidence');
    await expect(failure).rejects.toBeInstanceOf(OffEndpointRedirectError);
    await expect(failure).rejects.toThrow('https://h.example');
    await expect(failure).rejects.toThrow('http://h.example:8080');
  });

  it('gives up rather than looping on endless same-origin redirects', async () => {
    let hop = 0;
    vi.stubGlobal('fetch', () => {
      hop += 1;
      return Promise.resolve(redirectTo(`/hop-${hop}`));
    });
    await expect(sameOriginFetch('https://h.example/evidence')).rejects.toThrow(
      /too many redirects/,
    );
  });
});
