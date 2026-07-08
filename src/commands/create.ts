import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_WATCH_GLOB, normalizeWatchGlob, writeAutosyncHook } from '../autosync';
import { DomainError, resolveDomain } from '../domain';
import { DOTFILE_NAME, dotfileExists, dotfileHasHost, readDotfileConfig, writeDotfile } from '../dotfile';
import { controlUrl, hostUrl, timedFetch } from '../endpoint';
import { promptLine } from '../prompt';
import { DEFAULT_ALIAS } from '../templates';
import { printCommandHelp, wantsHelp } from '../usage';
import type { Dispatch } from '../dispatch';
import type { CreateResponse } from '../types';

export async function run(dispatch: Dispatch): Promise<number> {
  if (wantsHelp(dispatch.params)) {
    printCommandHelp('create');
    return 0;
  }
  const flags = parseFlags(dispatch.params);
  const cwd = process.cwd();

  // The guard protects a minted host from accidental replacement. A
  // config-only .plandrop (init's preferences — domain/template, no host) is
  // filled in, not guarded, so `init --local` then `create` just works.
  if (dotfileExists(cwd) && !flags.force && dotfileHasHost(cwd)) {
    process.stderr.write('a .plandrop already exists here; pass --force to replace it\n');
    return 1;
  }
  const existingConfig = existingDotfileConfig(cwd);

  let domain: string;
  try {
    domain = await resolveDomain({
      flag: flags.domain,
      env: process.env,
      cwd,
      configHome: process.env.XDG_CONFIG_HOME,
      home: homedir(),
      prompt: () => promptLine('Domain: '),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }

  let created: CreateResponse;
  try {
    created = await createHost(domain);
  } catch (error) {
    process.stderr.write(`create failed: ${(error as Error).message}\n`);
    return 1;
  }

  // The template is stored as-is (the `default` alias when neither a flag nor
  // an existing preference names one) and resolved to a concrete name at
  // `newdoc` time, so later default drift never breaks a doc. Only written on
  // success, so a failed create leaves no dotfile.
  const path = writeDotfile(cwd, {
    domain,
    host: created.host,
    passphrase: created.passphrase,
    template: flags.template ?? existingConfig?.template ?? DEFAULT_ALIAS,
  });
  process.stdout.write(`created ${hostUrl(domain, created.host)}\n`);
  process.stdout.write(`wrote ${path} (mode 0600) — it holds your passphrase; don't commit it\n`);

  await offerAutosyncHook(cwd, flags);
  return 0;
}

/**
 * Offer (opt-in) to scaffold the Claude Code auto-publish hook for the new
 * host. --hook/--hook-path take it without a prompt, --no-hook declines;
 * otherwise it is offered only at a terminal — a scripted create without
 * flags sets up nothing.
 */
async function offerAutosyncHook(cwd: string, flags: CreateFlags): Promise<void> {
  let glob: string | undefined;
  if (flags.hook === false) {
    return;
  }
  if (flags.hook === true || flags.hookPath !== undefined) {
    glob = normalizeWatchGlob(flags.hookPath ?? DEFAULT_WATCH_GLOB);
  } else if (process.stdin.isTTY === true) {
    const wanted = await promptLine(
      'Set up a Claude Code hook that auto-publishes saved HTML documents? [y/N]: ',
    );
    if (wanted === undefined || !wanted.trim().toLowerCase().startsWith('y')) {
      return;
    }
    const answer = await promptLine(`Path to watch [${DEFAULT_WATCH_GLOB}]: `);
    glob = normalizeWatchGlob(answer ?? '');
  } else {
    return;
  }

  try {
    const { path, added } = writeAutosyncHook(cwd, glob);
    process.stdout.write(
      added
        ? `wrote ${path} — saving a file matching ${glob} now auto-publishes it\n`
        : `an equivalent hook is already in ${path}; nothing changed\n`,
    );
  } catch (error) {
    process.stderr.write(`could not set up the hook: ${(error as Error).message}\n`);
  }
}

/**
 * The preference keys of the cwd's `.plandrop`, when one is present and
 * readable. A corrupt file (reachable only via --force) reports nothing — it
 * is being replaced wholesale.
 */
function existingDotfileConfig(cwd: string): { domain?: string; template?: string } | undefined {
  if (!dotfileExists(cwd)) {
    return undefined;
  }
  try {
    return readDotfileConfig(join(cwd, DOTFILE_NAME));
  } catch {
    return undefined;
  }
}

async function createHost(base: string): Promise<CreateResponse> {
  const res = await timedFetch(controlUrl(base, '/api/hosts'), { method: 'POST' });
  if (!res.ok) {
    throw new Error(`control plane responded ${res.status}`);
  }
  const body = (await res.json()) as Partial<CreateResponse>;
  if (typeof body.host !== 'string' || typeof body.passphrase !== 'string') {
    throw new Error('control plane returned an unexpected response');
  }
  return { host: body.host, passphrase: body.passphrase };
}

interface CreateFlags {
  force: boolean;
  domain: string | undefined;
  template: string | undefined;
  /** --hook (true) / --no-hook (false); undefined = offer interactively. */
  hook: boolean | undefined;
  hookPath: string | undefined;
}

function parseFlags(params: readonly string[]): CreateFlags {
  const flags: CreateFlags = {
    force: false,
    domain: undefined,
    template: undefined,
    hook: undefined,
    hookPath: undefined,
  };
  for (let i = 0; i < params.length; i += 1) {
    const param = params[i];
    if (param === '--force') {
      flags.force = true;
    } else if (param === '--hook') {
      flags.hook = true;
    } else if (param === '--no-hook') {
      flags.hook = false;
    } else if (param === '--hook-path') {
      flags.hookPath = params[i + 1];
      i += 1;
    } else if (param?.startsWith('--hook-path=')) {
      flags.hookPath = param.slice('--hook-path='.length);
    } else if (param === '--domain') {
      flags.domain = params[i + 1];
      i += 1;
    } else if (param?.startsWith('--domain=')) {
      flags.domain = param.slice('--domain='.length);
    } else if (param === '--template') {
      flags.template = params[i + 1];
      i += 1;
    } else if (param?.startsWith('--template=')) {
      flags.template = param.slice('--template='.length);
    }
  }
  return flags;
}
