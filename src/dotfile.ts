import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';

export const DOTFILE_NAME = '.plandrop';

/**
 * The per-location config + secret store. `host` is the bare label; the full
 * hostname is `host.domain`. Holds the passphrase, so it is written mode 0600.
 */
export interface Dotfile {
  domain: string;
  host: string;
  passphrase: string;
}

/** True if a `.plandrop` exists directly in `dir` (not walking up). */
export function dotfileExists(dir: string): boolean {
  return existsSync(join(dir, DOTFILE_NAME));
}

/** The nearest `.plandrop` path walking up from `startDir`, or undefined. */
export function findDotfile(startDir: string): string | undefined {
  let dir = startDir;
  const { root } = parse(dir);
  for (;;) {
    const candidate = join(dir, DOTFILE_NAME);
    if (existsSync(candidate)) {
      return candidate;
    }
    if (dir === root) {
      return undefined;
    }
    dir = dirname(dir);
  }
}

export function readDotfile(path: string): Dotfile {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<Dotfile>;
  if (
    typeof parsed.domain !== 'string' ||
    typeof parsed.host !== 'string' ||
    typeof parsed.passphrase !== 'string'
  ) {
    throw new Error(`malformed ${DOTFILE_NAME} at ${path}`);
  }
  return { domain: parsed.domain, host: parsed.host, passphrase: parsed.passphrase };
}

/** Write `.plandrop` into `dir`, mode 0600 (enforced even when overwriting). */
export function writeDotfile(dir: string, data: Dotfile): string {
  const path = join(dir, DOTFILE_NAME);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

/** The shareable URL for a host served over plain HTTP behind the ingress. */
export function hostUrl(host: string, domain: string): string {
  return `http://${host}.${domain}/`;
}
