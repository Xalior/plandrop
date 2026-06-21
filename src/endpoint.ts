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
