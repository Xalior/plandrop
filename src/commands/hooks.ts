import { dirname } from 'node:path';
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
import { dotfileHasHost, findDotfile, mergeDotfileConfig, tryReadDotfileConfig } from '../dotfile';
import { printCommandHelp, usageLine, wantsHelp } from '../usage';
import type { Dispatch } from '../dispatch';

/**
 * Install (or update) the Claude Code auto-publish hook in the current
 * project. `create` offers the same hook when it mints a host; this is the way
 * in for a project whose host already exists, and the way to upgrade one
 * later. Purely a local settings + .plandrop merge — it never calls the
 * control plane and never mints a host.
 *
 * With no watch/root flags at all: at a terminal it asks (defaulting from
 * whatever was last recorded); otherwise — a bare `plandrop hooks` run from a
 * script or an agent — it silently applies the recorded settings, or the very
 * defaults the prompts preselect when nothing was ever recorded, so both
 * paths land in the same place. The silent run is also the "upgrade" path a
 * client version bump relies on to refresh an older hook shape in place.
 */
export async function run(dispatch: Dispatch): Promise<number> {
  if (wantsHelp(dispatch.params)) {
    printCommandHelp('hooks');
    return 0;
  }
  const flags = parseFlags(dispatch.params);
  if (flags.localRoot !== undefined && flags.hookFlat) {
    process.stderr.write(`--local-root and --hook-flat are mutually exclusive\n${usageLine('hooks')}\n`);
    return 2;
  }
  const cwd = process.cwd();

  // The hook publishes to the host in the nearest .plandrop; without one it
  // would fail on every save, so say so rather than writing a dead hook.
  const dotfilePath = findDotfile(cwd);
  if (dotfilePath === undefined || !dotfileHasHost(dirname(dotfilePath))) {
    process.stderr.write(
      'no plandrop host found here or in any parent directory; run `plandrop create` first — ' +
        'the hook publishes to that host\n',
    );
    return 1;
  }
  const dotfileDir = dirname(dotfilePath);
  const recorded = tryReadDotfileConfig(dotfileDir) ?? {};

  const flagMode = flags.hookFlat
    ? FLAT_MODE
    : flags.localRoot !== undefined
      ? publishRootMode(flags.localRoot)
      : undefined;

  let glob: string;
  let mode: PublishMode;
  if (flags.watch !== undefined || flagMode !== undefined) {
    glob = normalizeWatchGlob(flags.watch ?? recorded.hookWatch ?? DEFAULT_WATCH_GLOB);
    mode = flagMode ?? defaultPublishMode(glob, recorded);
  } else if (process.stdin.isTTY === true) {
    glob = await promptWatchGlob(recorded.hookWatch);
    mode = await promptPublishMode(glob, recorded);
  } else {
    glob = normalizeWatchGlob(recorded.hookWatch ?? DEFAULT_WATCH_GLOB);
    mode = defaultPublishMode(glob, recorded);
  }

  try {
    const { path, outcome, change } = writeAutosyncHook(cwd, glob, mode);
    process.stdout.write(describeHookOutcome(path, glob, mode, outcome, change));
    mergeDotfileConfig(dotfileDir, hookConfigPatch(glob, mode));
  } catch (error) {
    process.stderr.write(`could not set up the hook: ${(error as Error).message}\n`);
    return 1;
  }
  return 0;
}

interface HooksFlags {
  /** The watched path: a positional argument or --hook-path. */
  watch: string | undefined;
  /** --local-root <dir>; mutually exclusive with hookFlat. */
  localRoot: string | undefined;
  /** --hook-flat. */
  hookFlat: boolean;
}

function parseFlags(params: readonly string[]): HooksFlags {
  const flags: HooksFlags = { watch: undefined, localRoot: undefined, hookFlat: false };
  for (let i = 0; i < params.length; i += 1) {
    const param = params[i];
    if (param === undefined) {
      continue;
    }
    if (param === '--hook-path') {
      flags.watch = params[i + 1];
      i += 1;
    } else if (param.startsWith('--hook-path=')) {
      flags.watch = param.slice('--hook-path='.length);
    } else if (param === '--local-root') {
      flags.localRoot = params[i + 1];
      i += 1;
    } else if (param.startsWith('--local-root=')) {
      flags.localRoot = param.slice('--local-root='.length);
    } else if (param === '--hook-flat') {
      flags.hookFlat = true;
    } else if (!param.startsWith('-') && flags.watch === undefined) {
      flags.watch = param;
    }
  }
  return flags;
}
