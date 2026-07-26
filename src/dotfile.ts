import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';

export const DOTFILE_NAME = '.plandrop';

/** The publish-root mode a hook install recorded, alongside its watch glob. */
export type HookPublishMode = 'mirror' | 'root' | 'flat';

const HOOK_PUBLISH_VALUES: readonly HookPublishMode[] = ['mirror', 'root', 'flat'];

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
  /** The watch glob a `create`/`hooks` run last recorded (see src/autosync.ts). */
  hookWatch?: string;
  /** The publish-root mode recorded alongside hookWatch. */
  hookPublish?: HookPublishMode;
  /** The `--local-root` directory, present only when hookPublish is 'root'. */
  localRoot?: string;
  /**
   * The plandrop client version that last wrote this file (__PLANDROP_VERSION__,
   * stamped centrally by every write/merge below — no call site sets it
   * directly, so none can forget). Recorded, not yet read: a future upgrade
   * flow uses it to know what changed since.
   */
  version?: string;
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

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isOptionalHookPublish(value: unknown): value is HookPublishMode | undefined {
  return value === undefined || (typeof value === 'string' && HOOK_PUBLISH_VALUES.includes(value as HookPublishMode));
}

export function readDotfile(path: string): Dotfile {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<Dotfile>;
  if (
    typeof parsed.domain !== 'string' ||
    typeof parsed.host !== 'string' ||
    typeof parsed.passphrase !== 'string' ||
    !isOptionalString(parsed.template) ||
    !isOptionalString(parsed.hookWatch) ||
    !isOptionalHookPublish(parsed.hookPublish) ||
    !isOptionalString(parsed.localRoot) ||
    !isOptionalString(parsed.version)
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
  if (parsed.hookWatch !== undefined) {
    dotfile.hookWatch = parsed.hookWatch;
  }
  if (parsed.hookPublish !== undefined) {
    dotfile.hookPublish = parsed.hookPublish;
  }
  if (parsed.localRoot !== undefined) {
    dotfile.localRoot = parsed.localRoot;
  }
  if (parsed.version !== undefined) {
    dotfile.version = parsed.version;
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
  hookWatch?: string;
  hookPublish?: HookPublishMode;
  localRoot?: string;
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
 * host/passphrase. Non-string (or otherwise malformed) values are simply not
 * reported; unparseable JSON still throws, like readDotfile.
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
  if (typeof parsed.hookWatch === 'string') {
    config.hookWatch = parsed.hookWatch;
  }
  if (typeof parsed.hookPublish === 'string' && HOOK_PUBLISH_VALUES.includes(parsed.hookPublish as HookPublishMode)) {
    config.hookPublish = parsed.hookPublish as HookPublishMode;
  }
  if (typeof parsed.localRoot === 'string') {
    config.localRoot = parsed.localRoot;
  }
  return config;
}

/**
 * `readDotfileConfig`, tolerating any read/parse failure by reporting nothing
 * — for a caller that only wants to default from a `.plandrop`'s preferences,
 * never to act on a corrupt one.
 */
export function tryReadDotfileConfig(dir: string): DotfileConfig | undefined {
  const path = join(dir, DOTFILE_NAME);
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    return readDotfileConfig(path);
  } catch {
    return undefined;
  }
}

/**
 * Merge preference keys into the `.plandrop` in `dir`, creating the file if
 * absent. Every existing key — host, passphrase, anything unrecognized — is
 * preserved; only the given keys are set (a key given as `undefined`, e.g.
 * clearing `localRoot`, is removed rather than left stale). Same 0600 atomic
 * write as any dotfile (it may hold a passphrase).
 */
export function mergeDotfileConfig(dir: string, patch: DotfileConfig): string {
  const path = join(dir, DOTFILE_NAME);
  const existing = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)
    : {};
  return writeDotfileRaw(dir, { ...existing, ...patch });
}

/**
 * Write `data` to `.plandrop`, mode 0600, atomically — and the single point
 * every dotfile write passes through, so the `version` stamp (the client that
 * last wrote this file) is never left to an individual call site to remember.
 * Always overwritten with the current build's version, even if `data` already
 * carried one from an earlier client.
 */
function writeDotfileRaw(dir: string, data: object): string {
  const path = join(dir, DOTFILE_NAME);
  const tmp = join(dir, `${DOTFILE_NAME}.tmp-${process.pid}`);
  const stamped = { ...data, version: __PLANDROP_VERSION__ };
  writeFileSync(tmp, `${JSON.stringify(stamped, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  return path;
}
