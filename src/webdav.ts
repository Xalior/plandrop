import { createClient, getPatcher, type WebDAVClient } from 'webdav';
import { hostBaseUri } from './endpoint';

/**
 * A 401 *after* valid credentials means the authenticated user is not the
 * host's tenant (Apache surfaces cross-tenant denial as 401/AH01629). It is
 * never a retryable auth failure, so it maps to its own error.
 */
export class WrongTenantError extends Error {}

/** Thrown when a remote path named for deletion does not exist on the host. */
export class RemoteNotFoundError extends Error {}

/**
 * A redirect that would take a request off the origin the client addressed.
 * It names both origins because the cause is always a misconfigured front
 * proxy or vhost, while the symptom otherwise surfaces far from it — a refused
 * connection to an internal address nobody typed.
 */
export class OffEndpointRedirectError extends Error {
  /**
   * The full address the host tried to send the request to. The message names
   * only the origins, because that is where the misconfiguration is, but the
   * path is what tells a caller whether the redirect was Apache pointing a
   * directory at its trailing-slash form.
   */
  readonly to: string;

  constructor(from: URL, to: URL) {
    super(
      `refusing to follow a redirect off ${from.origin} to ${to.origin}: the host advertises an origin the client was not pointed at — check the front proxy's forwarded host/proto/port and Apache's ServerName/UseCanonicalName`,
    );
    this.to = to.toString();
  }
}

/**
 * Whether a failed request was Apache redirecting a directory to its
 * trailing-slash form (mod_dir's DirectorySlash), rather than a genuine
 * misdirection. Apache issues this for directories only, so it identifies one
 * without the request having to arrive: the redirect is refused when the host
 * advertises an origin the client was not pointed at, which happens whenever
 * the stack sits behind a proxy on a different port, and refusing it is right.
 * The redirect still says what the path is.
 */
function isDirectorySlashRedirect(error: unknown, remotePath: string): boolean {
  if (!(error instanceof OffEndpointRedirectError)) {
    return false;
  }
  try {
    return new URL(error.to).pathname === `${remotePath.replace(/\/$/, '')}/`;
  } catch {
    return false;
  }
}

/** How many same-origin redirects one request may take before it aborts. */
const MAX_REDIRECTS = 5;

export function makeClient(base: string, host: string, passphrase: string): WebDAVClient {
  guardRedirects();
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

/**
 * Whether `remotePath` is a directory on the host. A delete refuses a
 * directory outright — WebDAV DELETE on a collection removes everything
 * inside it, which would take out more than the one path named — so the
 * command needs to know the type before it deletes anything. A path absent
 * from the host surfaces here as RemoteNotFoundError rather than a bare 404,
 * since "not there" and "there but a directory" both need to stop the delete
 * before it runs, each with its own message.
 */
export async function isRemoteDirectory(client: WebDAVClient, remotePath: string): Promise<boolean> {
  let stat;
  try {
    stat = await client.stat(remotePath);
  } catch (error) {
    if (statusOf(error) === 404) {
      throw new RemoteNotFoundError(`no such file on the host: ${remotePath}`);
    }
    if (isDirectorySlashRedirect(error, remotePath)) {
      return true;
    }
    throw mapError(error);
  }
  const info = 'data' in stat ? stat.data : stat;
  return info.type === 'directory';
}

/**
 * DELETE one remote file, mapping a 401 to WrongTenantError and a 404 to
 * RemoteNotFoundError — deleting a path that is not there is reported as a
 * clear error rather than the silent success an unmapped DELETE would read as.
 */
export async function deleteFile(client: WebDAVClient, remotePath: string): Promise<void> {
  try {
    await client.deleteFile(remotePath);
  } catch (error) {
    if (statusOf(error) === 404) {
      throw new RemoteNotFoundError(`no such file on the host: ${remotePath}`);
    }
    throw mapError(error);
  }
}

/**
 * MKCOL a collection and each of its ancestors, top-down — MKCOL creates one
 * level at a time and a missing parent is a 409. Every collection is addressed
 * with its trailing slash: mod_dir answers a slash-less collection URL with a
 * DirectorySlash redirect, which carries Apache's own origin rather than the
 * one the request arrived on. An already-existing collection answers 405,
 * which is success here.
 */
export async function makeDir(client: WebDAVClient, remotePath: string): Promise<void> {
  for (const collection of collectionChain(remotePath)) {
    try {
      await client.createDirectory(collection);
    } catch (error) {
      if (statusOf(error) === 405) {
        continue; // collection already exists
      }
      throw mapError(error);
    }
  }
}

/** Every collection from the host root down to `remotePath`, slash-terminated. */
export function collectionChain(remotePath: string): string[] {
  const chain: string[] = [];
  let path = '';
  for (const segment of remotePath.split('/')) {
    if (segment === '') {
      continue;
    }
    path += `/${segment}`;
    chain.push(`${path}/`);
  }
  return chain;
}

/** Whether the redirect guard below has been installed in this process. */
let redirectGuardInstalled = false;

/**
 * Follow redirects only while they stay on the endpoint the client addressed.
 * The webdav library routes its requests through a patchable `fetch` whose
 * default follows a Location anywhere, including to an internal backend origin
 * unreachable from here. The patch is process-wide and installed once — the
 * patcher's own `isPatched` cannot answer that, since the library registers
 * its stock fetch under the same key on its first request.
 */
function guardRedirects(): void {
  if (redirectGuardInstalled) {
    return;
  }
  redirectGuardInstalled = true;
  getPatcher().patch('fetch', (...args: unknown[]) =>
    sameOriginFetch(String(args[0]), args[1] as RequestInit | undefined),
  );
}

/** fetch that follows same-origin redirects itself and rejects the rest. */
export async function sameOriginFetch(
  url: string,
  init: RequestInit | undefined = {},
): Promise<Response> {
  let target = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(target, { ...init, redirect: 'manual' });
    const location = isRedirect(response.status) ? response.headers.get('location') : null;
    if (location === null) {
      return response;
    }
    const from = new URL(target);
    const next = new URL(location, target);
    if (next.origin !== from.origin) {
      throw new OffEndpointRedirectError(from, next);
    }
    target = next.toString();
  }
  throw new Error(`too many redirects (over ${MAX_REDIRECTS}) following ${url}`);
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
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
