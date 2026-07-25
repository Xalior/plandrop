/** The commands plandrop accepts. Every command name is fewer than 8 characters. */
export const COMMANDS = ['create', 'newdoc', 'upload', 'rotate', 'remove', 'init', 'server', 'hooks', 'help'] as const;

export type CommandName = (typeof COMMANDS)[number];

export interface Dispatch {
  command: CommandName;
  /** A host hash supplied as arg 1 (>= 8 chars), overriding the dotfile host. */
  hashOverride: string | undefined;
  params: string[];
}

/** Thrown when argv cannot be resolved to a known command. */
export class UsageError extends Error {}

/** Thrown when argv asks to print the CLI's own version rather than run a command. */
export class VersionRequested extends Error {}

/**
 * A command is shorter than 8 chars; a host hash is at least 8. The length of
 * arg 1 is therefore enough to tell whether it is a command or a hash override.
 */
const HASH_MIN_LENGTH = 8;

export function parseArgs(argv: readonly string[]): Dispatch {
  // A bare invocation orients the user rather than erroring.
  if (argv.length === 0) {
    return { command: 'help', hashOverride: undefined, params: [] };
  }

  // -v/--version in any position short-circuits to the version print — like
  // -h/--help below, intercepted before the hash/command split so a length-8+
  // arg 1 (e.g. `--version`, 9 chars) can never be mistaken for a hash
  // override, and a short one never for an unknown command.
  if (argv.some((arg) => arg === '-v' || arg === '--version')) {
    throw new VersionRequested();
  }

  // -h/--help in any position resolves to help — intercepted before the
  // hash/command split so it works wherever the flag lands. Any known command
  // name alongside it becomes the help topic.
  if (argv.some((arg) => arg === '-h' || arg === '--help')) {
    const topic = argv.find((arg) => isCommand(arg) && arg !== 'help');
    return { command: 'help', hashOverride: undefined, params: topic === undefined ? [] : [topic] };
  }

  const first = argv[0];
  if (first === undefined) {
    throw new UsageError('no command given (run `plandrop help`)');
  }

  let command: string;
  let hashOverride: string | undefined;
  let params: string[];

  if (first.length >= HASH_MIN_LENGTH) {
    hashOverride = first;
    command = argv[1] ?? '';
    params = argv.slice(2);
  } else {
    hashOverride = undefined;
    command = first;
    params = argv.slice(1);
  }

  if (!isCommand(command)) {
    throw new UsageError(
      command === ''
        ? 'no command given (run `plandrop help`)'
        : `unknown command: ${command} (run \`plandrop help\`)`,
    );
  }

  return { command, hashOverride, params };
}

/** Where a command's host hash came from, for human-readable stub output. */
export function hashSource(dispatch: Dispatch): string {
  return dispatch.hashOverride !== undefined
    ? `override (${dispatch.hashOverride})`
    : 'dotfile';
}

export function isCommand(value: string): value is CommandName {
  return (COMMANDS as readonly string[]).includes(value);
}
