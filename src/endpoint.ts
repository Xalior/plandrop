/**
 * Normalize a user-supplied hostname or URI to a base origin URI. A bare
 * hostname (no scheme) defaults to https — the secure choice for real
 * deployments; local dev passes an explicit http:// URI.
 */
export function normalizeBaseUri(value: string): string {
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  return new URL(candidate).origin;
}

/** A control-plane URL: the base origin joined with an /api path. */
export function controlUrl(base: string, path: string): string {
  return `${base}${path}`;
}

/** How long a control-plane request may go unanswered before it aborts (ms). */
export const CONTROL_TIMEOUT_MS = 10_000;

/**
 * fetch bounded by a timeout. A bare fetch waits forever, so a domain that
 * resolves to a host that silently drops the connection (no SYN-ACK, no reset
 * — e.g. a LAN-only server addressed from off-LAN) would hang the CLI with no
 * output; the abort turns that into a clear error naming the silent host.
 */
export async function timedFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = CONTROL_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (isTimeout(error)) {
      throw new Error(
        `no response from ${new URL(url).host} within ${Math.round(timeoutMs / 1000)}s — is it reachable on your network?`,
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * The only signal passed to the fetch above is our own timeout, so an abort
 * — whichever name the runtime surfaces it under — means the timer fired.
 */
function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

/**
 * The base URI for a host's static/WebDAV endpoint: the host label prepended as
 * a subdomain of the base hostname, preserving scheme and port. The ingress
 * routes `*.domain` to Apache; the vhost resolves the docroot from the label.
 */
export function hostBaseUri(base: string, host: string): string {
  const url = new URL(base);
  const port = url.port === '' ? '' : `:${url.port}`;
  return `${url.protocol}//${host}.${url.hostname}${port}`;
}

/** The shareable URL for a host (trailing slash; DirectoryIndex serves it). */
export function hostUrl(base: string, host: string): string {
  return `${hostBaseUri(base, host)}/`;
}
