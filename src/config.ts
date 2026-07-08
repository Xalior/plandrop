import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The user- or system-level plandrop preferences. Unlike a `.plandrop` this
 * file carries no secrets — just defaults the resolvers pick up when nothing
 * more specific (flag, env, nearby dotfile) applies.
 */
export interface UserConfig {
  domain?: string;
  template?: string;
}

/** Absolute path of the per-user config file, honouring XDG_CONFIG_HOME. */
export function userConfigPath(configHome: string | undefined, home: string): string {
  const base =
    configHome !== undefined && configHome.trim() !== '' ? configHome : join(home, '.config');
  return join(base, 'plandrop', 'config.json');
}

/**
 * The system-tier config search path, most specific first: each
 * $XDG_CONFIG_DIRS entry (default /etc/xdg), then a plain /etc/plandrop for
 * discoverability, then the Homebrew etc prefixes (macOS installs — treated
 * like Linux otherwise). This tier is read-only to the CLI: the paths need
 * root, so the file is admin-managed (dropped in by an operator or a package);
 * `init` only ever writes the user or local config.
 */
export function systemConfigPaths(env: NodeJS.ProcessEnv): string[] {
  const xdgDirs = (env.XDG_CONFIG_DIRS ?? '/etc/xdg')
    .split(':')
    .map((dir) => dir.trim())
    .filter((dir) => dir !== '');
  return [
    ...xdgDirs.map((dir) => join(dir, 'plandrop', 'config.json')),
    '/etc/plandrop/config.json',
    '/opt/homebrew/etc/plandrop/config.json',
    '/usr/local/etc/plandrop/config.json',
  ];
}

/**
 * Read one config file leniently: a missing, unreadable, or malformed file is
 * just no preferences — config resolution falls through, it never errors out.
 */
export function readConfigFile(path: string): UserConfig {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
  const config: UserConfig = {};
  if (typeof parsed.domain === 'string') {
    config.domain = parsed.domain;
  }
  if (typeof parsed.template === 'string') {
    config.template = parsed.template;
  }
  return config;
}

/**
 * The system-tier preferences: per XDG semantics the earlier directories are
 * the more important, so each key comes from the first file that defines it.
 */
export function systemConfig(env: NodeJS.ProcessEnv): UserConfig {
  const merged: UserConfig = {};
  for (const path of systemConfigPaths(env)) {
    if (!existsSync(path)) {
      continue;
    }
    const config = readConfigFile(path);
    merged.domain ??= config.domain;
    merged.template ??= config.template;
  }
  return merged;
}

/**
 * Write the config at `path`, merging over any existing file so unrelated keys
 * survive. Creates the directory as needed; mode 0600 (a private preference
 * file) and atomic (temp + rename) like the dotfile writer.
 */
export function writeUserConfig(path: string, patch: UserConfig): string {
  const existing = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)
    : {};
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify({ ...existing, ...patch }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  return path;
}
