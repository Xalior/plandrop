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
  return writeDotfileRaw(dir, data);
}

/**
 * The preference-only keys of a dotfile. Readable even from a dotfile with no
 * minted host: `init` writes a config-only `.plandrop` (just these keys), which
 * a later `create` fills in with host + passphrase.
 */
export interface DotfileConfig {
  domain?: string;
  template?: string;
}

/**
 * True when the `.plandrop` in `dir` holds a minted host — the state
 * `create`'s overwrite guard protects. A config-only dotfile (`init`'s
 * preferences, no host yet) reports false so `create` can fill it in; an
 * unreadable or unparseable file reports true, keeping the guard conservative
 * (replacing a corrupt file still takes --force).
 */
export function dotfileHasHost(dir: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, DOTFILE_NAME), 'utf8')) as Record<
      string,
      unknown
    >;
    return typeof parsed.host === 'string';
  } catch {
    return true;
  }
}

/**
 * Read only the preference keys of a `.plandrop`, tolerating a file that lacks
 * host/passphrase. Non-string (or absent) values are simply not reported;
 * unparseable JSON still throws, like readDotfile.
 */
export function readDotfileConfig(path: string): DotfileConfig {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const config: DotfileConfig = {};
  if (typeof parsed.domain === 'string') {
    config.domain = parsed.domain;
  }
  if (typeof parsed.template === 'string') {
    config.template = parsed.template;
  }
  return config;
}

/**
 * Merge preference keys into the `.plandrop` in `dir`, creating the file if
 * absent. Every existing key — host, passphrase, anything unrecognized — is
 * preserved; only the given keys are set. Same 0600 atomic write as any
 * dotfile (it may hold a passphrase).
 */
export function mergeDotfileConfig(dir: string, patch: DotfileConfig): string {
  const path = join(dir, DOTFILE_NAME);
  const existing = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)
    : {};
  return writeDotfileRaw(dir, { ...existing, ...patch });
}

function writeDotfileRaw(dir: string, data: object): string {
  const path = join(dir, DOTFILE_NAME);
  const tmp = join(dir, `${DOTFILE_NAME}.tmp-${process.pid}`);
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  return path;
}
