import { createClient, type WebDAVClient } from 'webdav';
import { hostBaseUri } from './endpoint';

/**
 * A 401 *after* valid credentials means the authenticated user is not the
 * host's tenant (Apache surfaces cross-tenant denial as 401/AH01629). It is
 * never a retryable auth failure, so it maps to its own error.
 */
export class WrongTenantError extends Error {}

export function makeClient(base: string, host: string, passphrase: string): WebDAVClient {
  return createClient(hostBaseUri(base, host), { username: host, password: passphrase });
}

/** PUT one file's bytes, mapping a 401 to WrongTenantError (no retry). */
export async function putFile(
  client: WebDAVClient,
  remotePath: string,
  data: Buffer,
): Promise<void> {
  try {
    await client.putFileContents(remotePath, data, { overwrite: true });
  } catch (error) {
    throw mapError(error);
  }
}

/** MKCOL a collection (and ancestors); an already-existing one is fine. */
export async function makeDir(client: WebDAVClient, remotePath: string): Promise<void> {
  try {
    await client.createDirectory(remotePath, { recursive: true });
  } catch (error) {
    if (statusOf(error) === 405) {
      return; // collection already exists
    }
    throw mapError(error);
  }
}

function mapError(error: unknown): Error {
  if (statusOf(error) === 401) {
    return new WrongTenantError(
      'wrong tenant: the passphrase does not authorize writes to this host',
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

function statusOf(error: unknown): number | undefined {
  const candidate = error as { status?: number; response?: { status?: number } };
  return candidate.status ?? candidate.response?.status;
}
