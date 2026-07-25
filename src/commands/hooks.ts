import { dirname } from 'node:path';
import { DEFAULT_WATCH_GLOB, normalizeWatchGlob, writeAutosyncHook } from '../autosync';
import { dotfileHasHost, findDotfile } from '../dotfile';
import { printCommandHelp, wantsHelp } from '../usage';
import type { Dispatch } from '../dispatch';

/**
 * Install (or update) the Claude Code auto-publish hook in the current
 * project. `create` offers the same hook when it mints a host; this is the way
 * in for a project whose host already exists. Purely a local settings merge —
 * it never calls the control plane and never mints a host.
 */
export function run(dispatch: Dispatch): number {
  if (wantsHelp(dispatch.params)) {
    printCommandHelp('hooks');
    return 0;
  }
  const flags = parseFlags(dispatch.params);
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

  const glob = normalizeWatchGlob(flags.watch ?? DEFAULT_WATCH_GLOB);
  try {
    const { path, added } = writeAutosyncHook(cwd, glob);
    process.stdout.write(
      added
        ? `wrote ${path} — saving a file matching ${glob} now auto-publishes it\n`
        : `an equivalent hook is already in ${path}; nothing changed\n`,
    );
  } catch (error) {
    process.stderr.write(`could not set up the hook: ${(error as Error).message}\n`);
    return 1;
  }
  return 0;
}

interface HooksFlags {
  /** The watched path: a positional argument or --hook-path. */
  watch: string | undefined;
}

function parseFlags(params: readonly string[]): HooksFlags {
  const flags: HooksFlags = { watch: undefined };
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
    } else if (!param.startsWith('-') && flags.watch === undefined) {
      flags.watch = param;
    }
  }
  return flags;
}
