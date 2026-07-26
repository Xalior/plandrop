# Using the plandrop client

**plandrop** pushes a finished static HTML document to a unique, secure hostname on your
network and gives you a link to share. The client is an `npx` CLI; the hosting is served
with zero server-side logic.

You need a running plandrop stack and its **domain** (e.g. `https://plandrop.example.com`).
If you run the stack yourself, see [Self-hosting](setup.md).

## At a glance

```sh
# in the directory holding your finished document
npx plandrop create --domain https://plandrop.example.com
npx plandrop upload ./planfile.html
# → share the printed https://<host>.plandrop.example.com/ link
```

## Commands

| Command | What it does |
|---------|--------------|
| `create` | Mint a new host (a unique hostname + passphrase) and write them to a `.plandrop` file in the current directory. |
| `newdoc <filename>` | Scaffold a new template-based HTML document locally from a server-hosted theme. Needs no host — defaults to the public template host. |
| `upload <path> [remote]` | Push a file or a directory (recursively) to your host over authenticated WebDAV. |
| `rotate` | Change the host's passphrase (the old one stops working immediately). |
| `remove` | Delete the host and its content, and remove the local `.plandrop`. |
| `init` | Record your default domain (and template) in a config file the other commands resolve. |
| `server` | Stand up a local plandrop server (Docker) via the plandrop.dev starter script. |
| `hooks [path]` | Install or update the autosync hook in the current project, without minting a host. |
| `help` | List every command, or show one command's usage and examples. |

`plandrop help <command>` (or `plandrop <command> --help`) prints any command's detailed
usage; a bare `plandrop` prints the overview. `plandrop --version` (or `-v`) prints the
CLI's own version and exits.

## init

First-run setup — records the preferences the other commands resolve when no flag or
`.plandrop` applies, so you never hand-author the JSON:

```sh
npx plandrop init                                  # guided (prompts)
npx plandrop init --yes --domain http://localhost:8083
npx plandrop init --local --domain https://plandrop.example.com --template darkly
```

It asks for (or takes via flags):

- **Domain** — the plandrop server your documents publish to and templates come from.
  The public CDN `https://plandrop.dev` is offered as the default, with a caveat: it
  serves **templates only**, so `newdoc` works out of the box but publishing
  (`create`/`upload`) needs your own server (see [server](#server)).
- **Template** — a default theme, offered from the chosen domain's live list. Optional.
- **Where to write** — the **per-user** config `~/.config/plandrop/config.json`
  (honours `XDG_CONFIG_HOME`; the default, or `--user`) or a **project-local**
  `.plandrop` in the current directory (`--local`).

Either target is **merged**, never clobbered: a `.plandrop` already holding a minted
`host`/`passphrase` keeps them. An existing per-user config is not overwritten without
confirmation (non-interactively, `--force`). On completion it prints the absolute path
of the file it wrote. `init` only writes config — it never mints a host or runs Docker.

### The config file and its search path

The config is plain JSON with two optional keys:

```json
{ "domain": "https://plandrop.example.com", "template": "darkly" }
```

It is read at two tiers, below any flag/env/`.plandrop` (see
[Where the domain comes from](#where-the-domain-comes-from) for the full precedence):

- **User** — `$XDG_CONFIG_HOME/plandrop/config.json`, defaulting to
  `~/.config/plandrop/config.json`. This is what `init --user` writes.
- **System** — admin-managed defaults, read-only to the CLI (`init` never writes them):
  each `$XDG_CONFIG_DIRS` entry (default `/etc/xdg`) as `<dir>/plandrop/config.json`,
  then `/etc/plandrop/config.json`, then the Homebrew prefixes
  (`/opt/homebrew/etc/plandrop/config.json`, `/usr/local/etc/plandrop/config.json`).
  The search applies on macOS and Linux alike; each key comes from the first file that
  defines it.

## server

Stand up a complete plandrop server on your own machine — no domain, DNS, or TLS proxy:

```sh
npx plandrop server                      # downloads and runs the plandrop.dev starter
# or, equivalently, the canonical one-liner:
curl -fsSL https://plandrop.dev/start.sh | sh
```

`server` requires Docker + Compose; it writes a localhost-defaults `.env`, pulls the
prebuilt GHCR images, and brings the stack up on `http://localhost:8083`. See the
[Quickstart](quickstart.md) for the full walkthrough — inspecting the starter first,
publishing your first document, and the from-source alternative. For a real-domain
deployment (wildcard DNS + TLS in front), see [Self-hosting](setup.md).

## create

Run `create` in the directory you want to associate with a host:

```sh
npx plandrop create --domain https://plandrop.example.com
```

It calls the control plane, receives a generated **host label** and **passphrase**, and
writes a `.plandrop` file here. It prints the shareable URL and a reminder that the file
holds your passphrase.

If a `.plandrop` already exists in this directory, `create` refuses unless you pass
`--force` (which mints a new host and replaces the file).

### Autosync hook

At a terminal, `create` offers to scaffold a Claude Code `PostToolUse` hook that
republishes a saved HTML document via `upload` whenever it matches the watched glob:

```
Set up a Claude Code hook that auto-publishes saved HTML documents? [Y/n]:
```

The default is **yes** — a bare Enter accepts it; only an answer starting with `n`
declines. Accepting prompts for the path to watch, defaulting to `docs/**/*.html` (or
whatever was recorded last time), so plans in subfolders are covered as well as ones at
the top level. It then asks where to publish:

```
Publish [m]irroring the project path, [r]elative to docs (default), or [f]lat at the host root? [r]:
```

Three publish roots, all built from the same idea — the hook `cd`s to a root and uploads
the saved file's path relative to it, exactly as a manual `upload` run from that root
would:

- **mirror the project path** (`m` at the prompt; `--local-root=""` scripted — an empty
  root collapses to mirror): a save at `docs/plans/x.html` publishes to
  `/docs/plans/x.html`.
- **relative to `<dir>`** (`--local-root <dir>`): with `--local-root docs`, that same save
  publishes to `/plans/x.html`. **Relative to the watched directory is the default
  everywhere** — the prompt preselects it, and a run with no mode flag and no prompt (a
  script, an agent) applies the same answer, so both paths land in the same place. A
  watch glob with no directory of its own (`*.html`) collapses to mirror.
- **flat at the host root** (`--hook-flat`): that same save publishes to `/x.html`
  regardless of where under the watched glob it lives.

A save outside the configured root falls back naturally to `upload`'s own behaviour: no
mirror image inside the host, so it publishes by bare basename.

`--hook` takes the offer without asking, `--no-hook` skips it (and its prompt), and
`--hook-path <glob>` sets the watched glob non-interactively. Every hook-taking flag
(`--hook-path`, `--local-root`, `--hook-flat`) implies `--hook`; `--local-root` and
`--hook-flat` are mutually exclusive. A non-interactive `create` with none of those flags
sets up nothing. Whichever way the glob and publish root are settled, they're recorded
into `.plandrop` (see [The `.plandrop` file](#the-plandrop-file)) so a later re-run —
interactive or via `hooks` — defaults from them; Enter keeps them. See [hooks](#hooks) to
install the same hook in a project whose host already exists, or to upgrade one already
installed.

### Where the domain comes from

You can give the domain explicitly, or let the client resolve it. Precedence, highest first:

| Source | Example |
|--------|---------|
| `--domain` flag | `--domain https://plandrop.example.com` |
| `PLANDROP_DOMAIN` env var | `export PLANDROP_DOMAIN=https://plandrop.example.com` |
| Nearest `.plandrop` (walking up from the current dir) | the `domain` field of a parent directory's `.plandrop` |
| Per-user config | `~/.config/plandrop/config.json` → `{ "domain": "https://plandrop.example.com" }` (honours `XDG_CONFIG_HOME`) |
| Interactive prompt / piped stdin | typed at a TTY, or `echo https://plandrop.example.com \| npx plandrop create` |

A bare hostname (no scheme) defaults to `https://`. An explicit `http://…` or `https://…`
URI — including a port — is used as given. The full URI is stored in `.plandrop`.

With nothing set and no input available (non-interactive, closed stdin), `create` exits
non-zero with a clear error.

## newdoc

Scaffold a starting document from one of the server's themes, written to a local file:

```sh
npx plandrop newdoc plan.html                    # default theme from plandrop.dev
npx plandrop newdoc plan.html --template darkly  # a specific theme
npx plandrop newdoc plan.html --domain https://plandrop.example.com  # your own host's themes
```

Unlike the other commands, `newdoc` needs no host or passphrase — it only fetches a template.
With nothing configured it defaults to the public template host **plandrop.dev**, so
`npx plandrop newdoc plan.html` works out of the box; it never prompts.

- **Pointed at plandrop.dev** (the default) you get **static, publish-less** templates: assets
  are referenced by absolute `https://plandrop.dev/…` URLs, so the document renders standalone
  — even opened straight off disk as a `file://` URL — and its self-update script lies dormant
  until the saved doc is hosted over HTTP(S).
- **Pointed at your own running stack** (via `--domain`, `PLANDROP_DOMAIN`, or a nearby
  `.plandrop`) you get that host's self-updating templates.

The theme is chosen by precedence: `--template` flag > the nearest `.plandrop`'s `template`
field > the per-user config's `template` > the server's default. `create` records a
`template` in `.plandrop` only when `--template` names one, so a host minted without the
flag keeps following the per-user preference. Domain resolution follows the same precedence as `create` (see
[Where the domain comes from](#where-the-domain-comes-from)), except `newdoc` never prompts and
falls back to plandrop.dev. It refuses to overwrite an existing file without `--force`. The
scaffolded file is yours to edit — then `upload` it like any other document.

Every scaffolded document comes with **mermaid** and **highlight.js** preinstalled, self-hosted
by the template server (no CDN): write `<pre class="mermaid">…</pre>` for a rendered diagram,
and `<pre><code class="language-…">…</code></pre>` for highlighted code (the language
auto-detects if the class is omitted). Both follow the document's light/dark theme, and load
lazily — a document using neither fetches neither. The starter's single HTML comment explains
the same to whoever (or whatever) writes the document body.

### The bundled themes

The set is `bootstrap5` (stock Bootstrap, the default), `f1terminal` (Fanny's First
Terminal, plandrop's own — a phosphor CRT in dark, a teletype printout in light), and the
full Bootswatch set. A theme
that offers both appearances scaffolds with a **light / dark toggle** in the navbar; a
single-appearance theme renders in the one its designer built. `GET /api/templates` lists
whatever your server actually has, including any operator templates dropped into the
`user/` mount, and the [theme gallery](https://plandrop.dev/templates/) shows the same plan
in every bundled one.

## upload

Upload a single file. With no remote path it publishes where you keep it — the subpath
it occupies under the `.plandrop`'s recorded `localRoot` when one is set, else under the
current directory — and prints the full shareable URL of the file it just published:

```sh
npx plandrop upload ./planfile.html              # → /planfile.html
npx plandrop upload docs/plans/x.html            # → /plans/x.html with localRoot docs;
                                                 #   /docs/plans/x.html with none
npx plandrop upload ./planfile.html index.html   # → /index.html (explicit remote wins)
```

`localRoot` names the local root remote paths are resolved against — a manual `upload`
lands a file exactly where the autosync hook would publish the same save, however deep
the shell sits in the project. Any missing collections along the way are created. A path
outside that root (absolute, or escaping via `../`) has no mirror image on the host, so
it falls back to its bare name.

Upload a directory and its contents preserve their internal structure verbatim; the
remote argument, if given, names the destination folder they land in:

| Command | Contents land at |
|---------|-------------------|
| `npx plandrop upload ./evidence` | `/evidence/…` — the directory's own name |
| `npx plandrop upload ./evidence photos` | `/photos/…` — the named destination |
| `npx plandrop upload ./evidence .` | `/…` — `.` is the explicit way to flatten a directory's contents into the host root |
| `npx plandrop upload .` | `/…` — the current directory publishes *what's here* to the host root; its own name is incidental and never becomes a folder |

Trailing slashes on either argument never change the outcome, and each uploaded file
prints its own shareable URL.

Nothing hidden is ever published. A directory upload skips every dot-prefixed name it
walks — dot-files one line each, dot-directories pruned whole and never descended into, so
a `.git` costs a single line rather than thousands — and prints what it left behind:

```
skipped .plandrop (plandrop credential file)
skipped .git/ (hidden)
skipped .env (hidden)
```

Naming one explicitly is refused rather than obeyed: `upload .plandrop` would hand the
host's passphrase — the write key for everything published there — to anyone who can reach
the page. Rename the file if you really mean to publish something of that name. Only the
leading dot is reserved: `x.plandrop`, `plandrop.html`, and a `config.json` that happens to
hold plandrop settings all publish normally.

Two hidden names are the exception, because they are content you publish on purpose:
**`.header.html`** and **`.footer.html`**, the chrome a directory listing is wrapped in
(see below). They upload like any other file, at any depth — the chrome is per-directory —
and they are exact names: `.header.html.bak` is not one of them.

The server does not take the client's word for it. Apache refuses every WebDAV write method
against the exact path segment `.plandrop` at any depth, so no client can put a credential
file on a host. Where a deployment runs the bundled proxy, it goes further and refuses any
request for a dot-prefixed path segment outright, reads included — making the same three
exceptions: the theme namespace `.plandrop/`, `.header.html`, and `.footer.html`.

It's a plain static host: files are served at their paths, and `index.html` answers the
bare directory URL. There is no client-side renaming or index magic — what you upload is
what's served. A directory with no `index.html` answers with a themed listing (folders
first, file-type icons) wrapped in the server's default-template chrome, at any depth.

A scaffolded document carries root-absolute `/.plandrop/…` links to its theme, so it
resolves them against the host root wherever you publish it, root or ten folders down. The
server also answers `.plandrop/…` from the shared theme tree **at every depth**, which keeps
an already-published document's relative links working too. The flip side: on a plandrop
host `.plandrop` is a reserved path segment. A directory of that name is not yours to
publish — the server refuses to create one and serves the theme tree in its place.

## rotate

```sh
npx plandrop rotate
```

Asks the control plane for a new passphrase and updates `.plandrop` in place. The old
passphrase stops authorizing writes immediately; reads are unaffected. Wrong credentials
leave the host and your `.plandrop` untouched.

## remove

```sh
npx plandrop remove
```

Deletes the host (its content and credentials) and removes the local `.plandrop`. After
this, the host URL returns 404 and writes are rejected. Wrong credentials change nothing.

## hooks

Install, update, or upgrade the autosync hook in the current project without minting a
host — for a project that already has one:

```sh
npx plandrop hooks                                   # uses recorded settings, or the defaults
npx plandrop hooks "plans/**/*.html"                 # a different glob, positional or --hook-path
npx plandrop hooks docs/**/*.html --hook-flat        # publish flat at the host root instead
```

It merges the same hook `create`'s offer scaffolds (see [Autosync hook](#autosync-hook))
into `.claude/settings.json`, preserving every other setting and hook, and publishes to
the host in the nearest `.plandrop` — it never mints one, and refuses clearly if no host
resolves.

A plandrop hook already in place is recognized however it's shaped — by its status
message and/or a command that invokes `plandrop upload` — not by exact text, so an older
or hand-edited hook is found and upgraded rather than left beside a second one. One that
already matches the wanted watch glob and publish root is left alone; one that differs is
replaced in place, printing what changed.

With no path or `--local-root`/`--hook-flat` given: at a terminal it asks what to watch and
where to publish, defaulting both from whatever was recorded last time; otherwise — a bare
`plandrop hooks` run from a script or an agent — it silently applies the recorded settings,
or the same defaults the prompts preselect when nothing was ever recorded, so both paths
land in the same place. The silent run is also how a client version bump upgrades an older
hook shape without needing to be told the settings again.

## The `.plandrop` file

A small JSON file written at mode `0600` in the directory where you ran `create`:

```json
{
  "domain": "https://plandrop.example.com",
  "host": "<generated-label>",
  "passphrase": "<generated-passphrase>",
  "hookWatch": "docs/**/*.html",
  "hookPublish": "root",
  "localRoot": "docs",
  "version": "0.6.0"
}
```

Subsequent commands (`upload`, `rotate`, `remove`) find the nearest `.plandrop` by walking
up from the current directory — so you can run them from anywhere inside the project.

`hookWatch` and `hookPublish` (plus `localRoot`, present only when `hookPublish` is
`"root"`) record the autosync hook's watch glob and publish root the last time `create` or
`hooks` set one up — read back as defaults on a later interactive run, or applied silently
by a bare `plandrop hooks`. `localRoot` also anchors a manual `upload`'s no-remote path
mirroring (see [upload](#upload)) — it names the local root remote paths are resolved
against, for the hook and the hand-run command alike. `version` records the plandrop client version that last
**changed** the file — a run that changes nothing leaves it (and the file) untouched.

> `.plandrop` holds your host's passphrase and grants write access to it — treat it as
> a credential when deciding whether to commit it.

### Targeting another host explicitly

Any argument of **8 characters or more** in front of the command is treated as a host label
that overrides the one in `.plandrop` (the passphrase still comes from `.plandrop`):

```sh
npx plandrop <host-label> upload ./planfile.html
```

Command names are all shorter than 8 characters, so the length of the first argument is
enough to tell a command from a host label.

## Claude Code skill

Driving plandrop from an AI agent? A Claude Code **skill** packages this workflow
(scaffold → fill in → publish → share) with the commands and guardrails, so the agent runs
it when you ask to "start a doc with plandrop." Install it with the
[`skills`](https://github.com/Xalior/agent-skills) CLI:

```sh
npx skills add Xalior/agent-skills --skill plandrop
```
