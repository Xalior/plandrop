import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';

export const DOTFILE_NAME = '.plandrop';

/**
 * The per-location config + secret store. `domain` is the full base URI
 * (scheme + host + optional port); `host` is the bare label (the served
 * endpoint is `host` as a subdomain of the base). Holds the passphrase, so it
 * is written mode 0600.
 */
export interface Dotfile {
  domain: string;
  host: string;
  passphrase: string;
  /**
   * The template this location defaults to, stored as-is (may be the `default`
   * alias) and resolved to a concrete name at `newdoc` time. Optional — a
   * dotfile without it falls back to the `default` alias.
   */
  template?: string;
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
    typeof parsed.passphrase !== 'string' ||
    (parsed.template !== undefined && typeof parsed.template !== 'string')
  ) {
    throw new Error(`malformed ${DOTFILE_NAME} at ${path}`);
  }
  const dotfile: Dotfile = {
    domain: parsed.domain,
    host: parsed.host,
    passphrase: parsed.passphrase,
  };
  if (parsed.template !== undefined) {
    dotfile.template = parsed.template;
  }
  return dotfile;
}

/** Write `.plandrop` into `dir`, mode 0600, atomically (temp file + rename). */
export function writeDotfile(dir: string, data: Dotfile): string {
  const path = join(dir, DOTFILE_NAME);
  const tmp = join(dir, `${DOTFILE_NAME}.tmp-${process.pid}`);
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  return path;
}
