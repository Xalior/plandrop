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
    synopsis:
      '[--domain <uri>] [--template <name>] [--force] [--hook | --no-hook] ' +
      '[--hook-path <glob>] [--local-root <dir> | --hook-flat]',
    detail: `  Mints a new host on the control plane and writes a .plandrop file here
  (mode 0600) holding the domain, host label, and passphrase — it grants
  write access to the host, so treat it as a credential. At a terminal it
  then offers ([Y/n], default yes — a bare Enter opts in) to scaffold a
  Claude Code hook that republishes watched HTML documents whenever they
  are saved, asking what to watch and then where to publish it (mirroring
  the project path, relative to the watched directory — the default — or
  flat at the host root); a re-run defaults both answers from whatever was
  recorded last time. The chosen watch glob and publish mode are recorded
  into .plandrop either way.

    --domain <uri>      the plandrop server; otherwise resolved from
                        PLANDROP_DOMAIN, the nearest .plandrop, the user or
                        system config, or a prompt
    --template <name>   record a default template for this host
    --force             replace an existing .plandrop here
    --hook              scaffold the auto-publish hook without asking
    --no-hook           skip the hook (and its prompt)
    --hook-path <glob>  what the hook watches (default docs/**/*.html; implies --hook)
    --local-root <dir>   publish relative to <dir> (under the project root)
                        instead of mirroring the full project path; implies
                        --hook; mutually exclusive with --hook-flat
    --hook-flat         publish every watched file flat at the host root, by
                        its own basename; mutually exclusive with --local-root`,
    examples: [
      'plandrop create --domain https://plandrop.example.com',
      'plandrop create --hook --hook-path plans/*.html',
      'plandrop create --hook --hook-path docs/**/*.html --local-root docs',
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
  .plandrop, printing every uploaded file's full shareable URL.

  A single file with no remote path publishes where you keep it: uploading
  docs/plans/x.html lands at /docs/plans/x.html, creating any collections
  needed along the way. A path outside the current directory (absolute, or
  escaping via ../) has no mirror on the host, so it falls back to its
  bare name. Naming a remote path explicitly always wins and is used
  exactly as given.

  A directory upload always preserves its internal structure; the remote
  argument names the destination folder its contents land in — omitted,
  the directory's own name is used. Uploading the current directory itself
  (\`upload .\`) publishes its contents to the host root — "what's here",
  not a folder named after the cwd. \`.\` as the remote argument is the
  explicit way to flatten any directory's contents into the host root.
  Trailing slashes never change the outcome.`,
    examples: [
      'plandrop upload docs/plans/x.html',
      'plandrop upload plan.html index.html',
      'plandrop upload ./evidence',
      'plandrop upload ./evidence photos',
      'plandrop upload ./evidence .',
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
  hooks: {
    summary: 'install (or upgrade) the auto-publish hook in this project',
    synopsis: '[path] [--hook-path <glob>] [--local-root <dir> | --hook-flat]',
    detail: `  Merges the Claude Code hook that republishes watched HTML documents
  whenever they are saved into this project's .claude/settings.json,
  keeping every other setting and hook. Publishes to the host in the
  nearest .plandrop — it does not mint one, and refuses clearly if none
  resolves. An existing plandrop hook is recognized however it's shaped
  (not just by exact match) and replaced in place if it differs, printing
  what changed; re-running with settings that already match changes
  nothing. Any flag given is recorded into .plandrop; whichever isn't is
  filled in from what was last recorded, or the defaults if nothing was.

  With no path/flags at all: at a terminal it asks what to watch and where
  to publish (defaulting from what's recorded); otherwise it silently
  re-applies the recorded settings — a bare \`plandrop hooks\` upgrades an
  older hook shape in place without needing to be told the settings again.

    --hook-path <glob>  what the hook watches (default docs/**/*.html); the
                        same value may be given as a positional argument
    --local-root <dir>   publish relative to <dir> (under the project root)
                        instead of mirroring the full project path;
                        mutually exclusive with --hook-flat
    --hook-flat         publish every watched file flat at the host root, by
                        its own basename; mutually exclusive with --local-root`,
    examples: [
      'plandrop hooks',
      'plandrop hooks "plans/**/*.html"',
      'plandrop hooks docs/**/*.html --local-root docs',
    ],
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
  return `plandrop ${__PLANDROP_VERSION__} — push a static HTML document to a unique, secure hostname.

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
