import { COMMANDS, type CommandName } from './dispatch';

/**
 * The single source of truth for every command's help text — consumed by the
 * `help` command, by each command's --help path, and by usage errors, so the
 * three can never drift apart.
 */
export interface CommandUsage {
  /** One-liner for the overview command list. */
  summary: string;
  /** Argument synopsis after `plandrop <command>` ('' = takes no arguments). */
  synopsis: string;
  /** Detailed behaviour + flag lines, pre-indented two spaces. */
  detail: string;
  /** Ready-to-run example invocations. */
  examples: readonly string[];
}

export const COMMAND_USAGE: Record<CommandName, CommandUsage> = {
  create: {
    summary: 'mint a new host (hostname + passphrase)',
    synopsis: '[--domain <uri>] [--template <name>] [--force] [--hook | --no-hook] [--hook-path <glob>]',
    detail: `  Mints a new host on the control plane and writes a .plandrop file here
  (mode 0600) holding the domain, host label, and passphrase — don't commit
  it. At a terminal it then offers to scaffold a Claude Code hook that
  republishes watched HTML documents whenever they are saved.

    --domain <uri>      the plandrop server; otherwise resolved from
                        PLANDROP_DOMAIN, the nearest .plandrop, the user or
                        system config, or a prompt
    --template <name>   record a default template for this host
    --force             replace an existing .plandrop here
    --hook              scaffold the auto-publish hook without asking
    --no-hook           skip the hook (and its prompt)
    --hook-path <glob>  what the hook watches (default docs/*.html; implies --hook)`,
    examples: [
      'plandrop create --domain https://plandrop.example.com',
      'plandrop create --hook --hook-path plans/*.html',
    ],
  },
  newdoc: {
    summary: 'scaffold a template-based HTML document locally',
    synopsis: '<filename> [--template <name>] [--domain <uri>] [--force]',
    detail: `  Writes a starter document from a server-hosted template. Needs no host:
  with nothing configured it uses the public template host plandrop.dev
  (static, publish-less templates); pointed at your own server it fetches
  that host's self-updating ones. Refuses to overwrite without --force.

    --template <name>   the template to scaffold from (--template > the
                        .plandrop template field > user config > the server default)
    --domain <uri>      the template server (same resolution as create, but
                        never prompts — it falls back to plandrop.dev)
    --force             overwrite an existing file`,
    examples: [
      'plandrop newdoc plan.html',
      'plandrop newdoc plan.html --template darkly',
    ],
  },
  upload: {
    summary: 'push a file or directory over authed WebDAV',
    synopsis: '<path> [remote-path]',
    detail: `  Pushes a file (or a directory, recursively) to the host in the nearest
  .plandrop. A single file uploads to its basename unless a remote path is
  given, and the full shareable URL of the uploaded file is printed; a
  directory upload preserves structure and prints the host root.`,
    examples: [
      'plandrop upload plan.html',
      'plandrop upload plan.html index.html',
      'plandrop upload ./site',
    ],
  },
  rotate: {
    summary: 'change the host passphrase',
    synopsis: '',
    detail: `  Asks the control plane for a new passphrase and updates .plandrop in
  place. The old passphrase stops authorizing writes immediately.`,
    examples: ['plandrop rotate'],
  },
  remove: {
    summary: 'delete the host and its content',
    synopsis: '',
    detail: `  Deletes the host (content and credentials) and removes the local
  .plandrop. The host URL 404s afterwards.`,
    examples: ['plandrop remove'],
  },
  init: {
    summary: 'record your default domain and template in a config file',
    synopsis: '[--domain <uri>] [--template <name>] [--local | --user] [--yes] [--force]',
    detail: `  First-run setup: records the domain (and optionally a default template)
  that later commands resolve when no flag or .plandrop applies. Writes
  either the per-user config (~/.config/plandrop/config.json, honouring
  XDG_CONFIG_HOME) or a project-local .plandrop in the current directory —
  merging with what's already there, never clobbering a host or passphrase.
  Prints the absolute path it wrote.

  The public CDN https://plandrop.dev serves templates only: it makes
  newdoc work with zero setup, but publishing (create/upload) needs your
  own server (see \`plandrop help server\`).

    --domain <uri>      the default domain to record
    --template <name>   the default template to record
    --user              write the per-user config (the default)
    --local             write a .plandrop in the current directory instead
    --yes               accept defaults; never prompt
    --force             update an existing per-user config`,
    examples: [
      'plandrop init',
      'plandrop init --yes --domain http://localhost:8083',
      'plandrop init --local --domain https://plandrop.example.com --template darkly',
    ],
  },
  server: {
    summary: 'stand up a local plandrop server (Docker) via the starter script',
    synopsis: '',
    detail: `  Downloads the plandrop.dev starter script and runs it in the current
  directory: it checks for Docker + Compose, writes a localhost-defaults
  .env if none exists, fetches the ready-to-run compose file, pulls the
  prebuilt images, and brings the stack up. Re-runnable; existing .env and
  compose files are kept. Equivalent to:
    curl -fsSL https://plandrop.dev/start.sh | sh`,
    examples: ['plandrop server'],
  },
  help: {
    summary: 'show this overview, or a command\'s usage',
    synopsis: '[command]',
    detail: `  With no argument, lists every command. With a command name, prints that
  command's usage, flags, and examples — the same text as \`plandrop
  <command> --help\`.`,
    examples: ['plandrop help', 'plandrop help newdoc'],
  },
};

/** The one-line `usage:` string for a command's error path. */
export function usageLine(name: CommandName): string {
  const { synopsis } = COMMAND_USAGE[name];
  return `usage: plandrop ${name}${synopsis === '' ? '' : ` ${synopsis}`}`;
}

/** The overview help: synopsis, command list with one-liners, next step. */
export function overviewText(): string {
  const width = Math.max(...COMMANDS.map((name) => name.length));
  const list = COMMANDS.map(
    (name) => `  ${name.padEnd(width)}  ${COMMAND_USAGE[name].summary}`,
  ).join('\n');
  return `plandrop — push a static HTML document to a unique, secure hostname.

Usage:
  plandrop <command> [params]
  plandrop <hash> <command> [params]    # a >= 8-char hash overrides the dotfile host

Commands:
${list}

Run \`plandrop help <command>\` for a command's usage and examples.
`;
}

/** The detailed help for one command: summary, usage, flags, examples. */
export function commandText(name: CommandName): string {
  const { summary, detail, examples } = COMMAND_USAGE[name];
  const exampleLines = examples.map((example) => `  ${example}`).join('\n');
  return `plandrop ${name} — ${summary}

${usageLine(name)}

${detail}

examples:
${exampleLines}
`;
}

/** True when a command's params ask for its help text. */
export function wantsHelp(params: readonly string[]): boolean {
  return params.includes('-h') || params.includes('--help');
}

/** Print a command's detailed help to stdout (the --help short-circuit). */
export function printCommandHelp(name: CommandName): void {
  process.stdout.write(commandText(name));
}
