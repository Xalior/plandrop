import { readConfigFile, systemConfig, userConfigPath } from './config';
import { findDotfile, readDotfileConfig } from './dotfile';
import { normalizeBaseUri } from './endpoint';

/** Thrown when no domain can be resolved and none can be prompted for. */
export class DomainError extends Error {}

export interface DomainSources {
  /** --domain flag value, if given. */
  flag: string | undefined;
  env: NodeJS.ProcessEnv;
  /** Where to start the walk-up for the repo-config (.plandrop) tier. */
  cwd: string;
  /** XDG_CONFIG_HOME, if set. */
  configHome: string | undefined;
  home: string;
  /** Last-resort interactive/piped source; resolves undefined if no input. */
  prompt: () => Promise<string | undefined>;
}

/**
 * Resolve the base URI by precedence: --domain flag > PLANDROP_DOMAIN env >
 * repo config (nearest .plandrop) > per-user config (XDG) > system config
 * ($XDG_CONFIG_DIRS / /etc — admin-managed, read-only to the CLI) > prompt.
 * The result is normalized to a full base URI (bare hostnames default to
 * https). With nothing set and no input available, throws DomainError.
 */
export async function resolveDomain(sources: DomainSources): Promise<string> {
  const raw =
    clean(sources.flag) ??
    clean(sources.env.PLANDROP_DOMAIN) ??
    repoDomain(sources.cwd) ??
    userDomain(sources.configHome, sources.home) ??
    clean(systemConfig(sources.env).domain) ??
    clean(await sources.prompt());

  if (raw === undefined) {
    throw new DomainError(
      'no domain configured: pass --domain, set PLANDROP_DOMAIN, add it to a .plandrop or the user config, or provide it on stdin',
    );
  }
  try {
    return normalizeBaseUri(raw);
  } catch {
    throw new DomainError(`invalid domain or URI: ${raw}`);
  }
}

function repoDomain(cwd: string): string | undefined {
  const path = findDotfile(cwd);
  if (path === undefined) {
    return undefined;
  }
  try {
    return clean(readDotfileConfig(path).domain);
  } catch {
    return undefined;
  }
}

function userDomain(configHome: string | undefined, home: string): string | undefined {
  return clean(readConfigFile(userConfigPath(configHome, home)).domain);
}

function clean(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
