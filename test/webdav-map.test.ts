import { describe, expect, it } from 'vitest';
import type { WebDAVClient } from 'webdav';
import { makeDir, putFile, WrongTenantError } from '../src/webdav';

function throwingClient(status: number): WebDAVClient {
  const throwStatus = (): never => {
    throw Object.assign(new Error('http error'), { status });
  };
  return { putFileContents: throwStatus, createDirectory: throwStatus } as unknown as WebDAVClient;
}

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
});
