import { homedir } from 'node:os';
import {
  defaultPublishMode,
  describeHookOutcome,
  DEFAULT_WATCH_GLOB,
  FLAT_MODE,
  hookConfigPatch,
  normalizeWatchGlob,
  promptPublishMode,
  promptWatchGlob,
  publishRootMode,
  writeAutosyncHook,
  type PublishMode,
} from '../autosync';
import { DomainError, resolveDomain } from '../domain';
import {
  dotfileExists,
  dotfileHasHost,
  mergeDotfileConfig,
  tryReadDotfileConfig,
  writeDotfile,
  type DotfileConfig,
} from '../dotfile';
import { controlUrl, hostUrl, timedFetch } from '../endpoint';
import { promptLine } from '../prompt';
import { printCommandHelp, usageLine, wantsHelp } from '../usage';
import type { Dispatch } from '../dispatch';
import type { CreateResponse } from '../types';

export async function run(dispatch: Dispatch): Promise<number> {
  if (wantsHelp(dispatch.params)) {
    printCommandHelp('create');
    return 0;
  }
  const flags = parseFlags(dispatch.params);
  if (flags.localRoot !== undefined && flags.hookFlat) {
    process.stderr.write(`--local-root and --hook-flat are mutually exclusive\n${usageLine('create')}\n`);
    return 2;
  }
  const cwd = process.cwd();

  // The guard protects a minted host from accidental replacement. A
  // config-only .plandrop (init's preferences — domain/template, no host) is
  // filled in, not guarded, so `init --local` then `create` just works.
  if (dotfileExists(cwd) && !flags.force && dotfileHasHost(cwd)) {
    process.stderr.write('a .plandrop already exists here; pass --force to replace it\n');
    return 1;
  }
  const existingConfig = tryReadDotfileConfig(cwd);

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

  // The template key is written only when a flag or an existing dotfile
  // preference names one, stored as-is and resolved to a concrete name at
  // `newdoc` time. An unnamed template stays absent — a recorded value would
  // shadow the per-user config's `template` in newdoc's fallback chain, and
  // no preference was expressed here. Only written on success, so a failed
  // create leaves no dotfile.
  const template = flags.template ?? existingConfig?.template;
  const path = writeDotfile(cwd, {
    domain,
    host: created.host,
    passphrase: created.passphrase,
    ...(template !== undefined ? { template } : {}),
  });
  process.stdout.write(`created ${hostUrl(domain, created.host)}\n`);
  process.stdout.write(`wrote ${path} (mode 0600) — it holds your passphrase\n`);

  await offerAutosyncHook(cwd, flags, existingConfig);
  return 0;
}

/**
 * The hook offer is default-yes: a bare Enter accepts it, only an answer
 * starting with `n` declines. A closed stdin (undefined — no answer at all,
 * rather than an empty one) declines too, so a prompt the user walked away
 * from writes nothing.
 */
export function hookOfferAccepted(answer: string | undefined): boolean {
  return answer !== undefined && !answer.trim().toLowerCase().startsWith('n');
}

/**
 * Offer to scaffold the Claude Code auto-publish hook for the new host.
 * --hook/--hook-path/--local-root/--hook-flat take it without a prompt,
 * --no-hook declines; otherwise it is offered only at a terminal — a
 * scripted create without flags sets up nothing. Whichever way the watch glob and publish
 * mode are settled, they are recorded into .plandrop so a later re-run
 * (interactive or a bare `plandrop hooks`) defaults from them.
 */
async function offerAutosyncHook(
  cwd: string,
  flags: CreateFlags,
  existingConfig: DotfileConfig | undefined,
): Promise<void> {
  let glob: string;
  let mode: PublishMode;
  if (flags.hook === false) {
    return;
  }
  if (
    flags.hook === true ||
    flags.hookPath !== undefined ||
    flags.localRoot !== undefined ||
    flags.hookFlat === true
  ) {
    glob = normalizeWatchGlob(flags.hookPath ?? existingConfig?.hookWatch ?? DEFAULT_WATCH_GLOB);
    const flagMode = flags.hookFlat
      ? FLAT_MODE
      : flags.localRoot !== undefined
        ? publishRootMode(flags.localRoot)
        : undefined;
    mode = flagMode ?? defaultPublishMode(glob, existingConfig);
  } else if (process.stdin.isTTY === true) {
    const wanted = await promptLine(
      'Set up a Claude Code hook that auto-publishes saved HTML documents? [Y/n]: ',
    );
    if (!hookOfferAccepted(wanted)) {
      return;
    }
    glob = await promptWatchGlob(existingConfig?.hookWatch);
    mode = await promptPublishMode(glob, existingConfig);
  } else {
    return;
  }

  try {
    const { path, outcome, change } = writeAutosyncHook(cwd, glob, mode);
    process.stdout.write(describeHookOutcome(path, glob, mode, outcome, change));
    mergeDotfileConfig(cwd, hookConfigPatch(glob, mode));
  } catch (error) {
    process.stderr.write(`could not set up the hook: ${(error as Error).message}\n`);
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
  /** --local-root <dir>; mutually exclusive with hookFlat. */
  localRoot: string | undefined;
  /** --hook-flat. */
  hookFlat: boolean;
}

function parseFlags(params: readonly string[]): CreateFlags {
  const flags: CreateFlags = {
    force: false,
    domain: undefined,
    template: undefined,
    hook: undefined,
    hookPath: undefined,
    localRoot: undefined,
    hookFlat: false,
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
    } else if (param === '--local-root') {
      flags.localRoot = params[i + 1];
      i += 1;
    } else if (param?.startsWith('--local-root=')) {
      flags.localRoot = param.slice('--local-root='.length);
    } else if (param === '--hook-flat') {
      flags.hookFlat = true;
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
