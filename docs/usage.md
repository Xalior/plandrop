# Using the plandrop client

**plandrop** pushes a finished static HTML document to a unique, secure hostname on your
network and prints a link you can share. The client is an `npx` CLI; the hosting is served
with zero server-side logic.

You need a running plandrop stack and its **domain** (e.g. `https://plandrop.example.com`).
If you run the stack yourself, see [Self-hosting](setup.md).

## Quick start

```sh
# in the directory holding your finished document
npx plandrop create --domain https://plandrop.example.com
npx plandrop upload ./planfile.html
# → share the printed https://<host>.plandrop.example.com/ link
```

## Commands

| Command | What it does |
|---------|--------------|
| `create` | Create a new host (a unique hostname and passphrase) and write them to a `.plandrop` file in the current directory. |
| `newdoc <filename>` | Generate a new template-based HTML document locally from a server-hosted theme. Needs no host — defaults to the public template host. |
| `upload <path> [remote]` | Publish a file or a directory (recursively) to your host over authenticated WebDAV. |
| `index [hero-file]` | Publish the header and footer that wrap a directory listing when a directory has no `index.html`, optionally with a hero section from a local file. |
| `fixcss` | Rewrite the theme links in your local HTML documents so each one names the server outright, so a document keeps its styling wherever it is opened. |
| `rotate` | Change the host's passphrase (the old one stops working immediately). |
| `remove` | Delete the host and its content, and remove the local `.plandrop`. |
| `init` | Record your default domain (and template) in a config file the other commands resolve. |
| `server` | Start a local plandrop server (Docker) via the plandrop.dev starter script. |
| `hooks [path]` | Install or update the autosync hook in the current project, without creating a host. |
| `help` | List every command, or show one command's usage and examples. |

`plandrop help <command>` (or `plandrop <command> --help`) prints any command's detailed
usage; a bare `plandrop` prints the overview. `plandrop --version` (or `-v`) prints the
CLI's own version and exits.

## init

First-run setup — records the preferences the other commands resolve when no flag or
`.plandrop` applies, so you never write the config file yourself:

```sh
npx plandrop init                                  # guided (prompts)
npx plandrop init --yes --domain http://localhost:8083
npx plandrop init --local --domain https://plandrop.example.com --template darkly
```

It asks for (or takes via flags):

- **Domain** — the plandrop server your documents publish to and templates come from.
  The public template host `https://plandrop.dev` is offered as the default, with one
  limit: it serves **templates only**, so `newdoc` works out of the box, but publishing
  (`create`/`upload`) needs a server you run yourself (see [server](#server)).
- **Template** — a default theme, offered from the chosen domain's live list. Optional.
- **Where to write** — the **per-user** config `~/.config/plandrop/config.json`
  (honours `XDG_CONFIG_HOME`; the default, or `--user`) or a **project-local**
  `.plandrop` in the current directory (`--local`).

Either target is **merged** with what is already there, never overwritten: a `.plandrop`
already holding a `host`/`passphrase` pair keeps them. An existing per-user config is not
overwritten without confirmation (non-interactively, `--force`). On completion it prints the
absolute path of the file it wrote. `init` only writes config — it never creates a host or
runs Docker.

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

Start a complete plandrop server on your own machine — no domain, DNS, or TLS proxy needed:

```sh
npx plandrop server                      # downloads and runs the plandrop.dev starter
# or, equivalently, the canonical one-liner:
curl -fsSL https://plandrop.dev/start.sh | sh
```

`server` requires Docker + Compose; it writes a localhost-defaults `.env`, pulls the
prebuilt container images, and starts the stack on `http://localhost:8083`. See the
[Quickstart](quickstart.md) for the full walkthrough — inspecting the starter first,
publishing your first document, and the from-source alternative. For a real-domain
deployment (wildcard DNS + TLS in front), see [Self-hosting](setup.md).

## create

Run `create` in the directory you want to associate with a host:

```sh
npx plandrop create --domain https://plandrop.example.com
```

It calls the control plane — the part of a plandrop server that manages hosts — and
receives a generated **host label** and **passphrase**, then writes a `.plandrop` file
here. It prints the shareable URL and a reminder that the file holds your passphrase.

If a `.plandrop` already exists in this directory, `create` refuses unless you pass
`--force` (which creates a new host and replaces the file).

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

Three publish roots, all built on the same idea — the hook changes into a root directory
and uploads the saved file's path relative to it, exactly as a manual `upload` run from
that root would:

- **mirror the project path** (`m` at the prompt; `--local-root=""` scripted — an empty
  root collapses to mirror): a save at `docs/plans/x.html` publishes to
  `/docs/plans/x.html`.
- **relative to `<dir>`** (`--local-root <dir>`): with `--local-root docs`, that same save
  publishes to `/plans/x.html`. **Relative to the watched directory is the default
  everywhere** — the prompt preselects it, and a run with no mode flag and no prompt (a
  script, an agent) applies the same answer, so both paths publish to the same place. A
  watch glob with no directory of its own (`*.html`) collapses to mirror.
- **flat at the host root** (`--hook-flat`): that same save publishes to `/x.html`
  regardless of where under the watched glob it lives.

A save outside the configured root uses `upload`'s own default behaviour instead: no
matching path inside the host, so it publishes by bare file name.

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
| Nearest `.plandrop` (found by checking the current directory, then each parent in turn) | the `domain` field of a parent directory's `.plandrop` |
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

A scaffolded document names its template server outright in its asset links —
`https://plandrop.dev/.plandrop/…` from the public host, `https://your.server/.plandrop/…`
from your own — so it renders correctly the moment it is written: opened directly from disk
as a `file://` URL, and published at any depth on a host. Its self-update script is included
in the document and does nothing until the document is served over HTTP(S).

- **Pointed at plandrop.dev** (the default) you get the **publish-less** template set — the
  public host serves templates only and accepts no documents.
- **Pointed at your own running stack** (via `--domain`, `PLANDROP_DOMAIN`, or a nearby
  `.plandrop`) you get that server's templates, which self-update once published.

The theme is chosen by precedence: `--template` flag > the nearest `.plandrop`'s `template`
field > the per-user config's `template` > the server's default. `create` records a
`template` in `.plandrop` only when `--template` names one, so a host created without the
flag keeps following the per-user preference. Domain resolution follows the same precedence as `create` (see
[Where the domain comes from](#where-the-domain-comes-from)), except `newdoc` never prompts and
falls back to plandrop.dev. It refuses to overwrite an existing file without `--force`. The
scaffolded file is yours to edit — then `upload` it like any other document.

Every scaffolded document comes with **mermaid** and **highlight.js** preinstalled,
self-hosted by the template server rather than fetched from any third-party service: write
`<pre class="mermaid">…</pre>` for a rendered diagram, and
`<pre><code class="language-…">…</code></pre>` for highlighted code (the language
auto-detects if the class is omitted). Both follow the document's light/dark theme, and load
lazily — a document using neither fetches neither. The starter's single HTML comment explains
the same to whoever writes the document body, human or automated.

### The bundled themes

The set is `bootstrap5` (stock Bootstrap, the default), `f1terminal` (Fanny's First
Terminal, plandrop's own theme — a phosphor CRT screen in dark mode, a teletype printout in
light mode), and the full [Bootswatch](https://bootswatch.com/) set of free Bootstrap-based
themes. A theme that offers both appearances scaffolds with a **light / dark toggle** in the
navigation bar; a theme with only one appearance renders in the one its designer built.
`GET /api/templates` lists every template your server actually has, including any operator
templates placed in the `user/` mount, and the [theme gallery](https://plandrop.dev/templates/)
shows the same example document rendered in every bundled theme.

## upload

Upload a single file. With no destination path given, it publishes to the location you keep
it in locally — the file's path under the `.plandrop`'s recorded `localRoot` when one is set,
otherwise its path under the current directory — and prints the full address of the file it
just published:

```sh
npx plandrop upload ./planfile.html              # → /planfile.html
npx plandrop upload docs/plans/x.html            # → /plans/x.html with localRoot docs;
                                                 #   /docs/plans/x.html with none
npx plandrop upload ./planfile.html index.html   # → /index.html (an explicit destination always wins)
```

`localRoot` names the local directory remote paths are measured from — a manual `upload`
publishes a file to the exact address the autosync hook would publish the same save to, no
matter how deep in the project the shell's current directory is. Any missing folders on the
host are created automatically. A file outside that root (given as an absolute path, or
reached by `../`) has no matching address on the host, so it publishes under its bare file
name instead.

Upload a directory and its contents keep their internal structure. A directory is measured
against the same root a single file is — its path under `localRoot`, or under the current
directory when none is recorded — and the destination argument, if given, names the folder
its contents go into instead:

| Command | Where the contents are published |
|---------|-----------------------------------|
| `npx plandrop upload ./evidence` | `/evidence/…` — its path under the root |
| `npx plandrop upload docs` | `/…` with `localRoot` docs — the root itself publishes what is inside it, never a folder named after it; `/docs/…` with no `localRoot` |
| `npx plandrop upload docs/plans` | `/plans/…` with `localRoot` docs — the same place the files are published one at a time |
| `npx plandrop upload ./evidence photos` | `/photos/…` — the named destination |
| `npx plandrop upload ./evidence .` | `/…` — `.` is the explicit way to publish a directory's contents at the host root, with no folder wrapping them |
| `npx plandrop upload .` | `/…` — the current directory publishes what is inside it; its own name plays no part |

A directory outside the root (given as an absolute path, or reached by `../`) has no
matching address on the host either, so it too publishes under its bare name — except the
current directory, whose name was never typed in the first place.

A trailing slash on either argument never changes the outcome, and each uploaded file prints
its own address once it is published.

By default, nothing hidden is published. A directory upload skips every name starting with a
dot as it walks the tree — a dot-file is skipped with one line of output, and a
dot-directory is skipped whole, without descending into it, so a `.git` folder costs a
single line instead of thousands — and prints what it left out:

```
skipped .plandrop (plandrop credential file)
skipped .git/ (hidden)
skipped .env (hidden)
```

Naming `.plandrop` as the destination is refused rather than carried out: it would give the
host's passphrase — the write key for everything published there — to anyone who can reach
the page. Rename the file if you do want to publish something under that name. Only a name
that starts with a dot is treated this way: `x.plandrop`, `plandrop.html`, and a
`config.json` that happens to hold plandrop settings all publish normally.

Two dot-prefixed names are the exception, because you publish them on purpose:
**`.header.html`** and **`.footer.html`**, the chrome that wraps a directory listing (see
[index](#index) below). They upload like any other file, at any depth — each directory can
carry its own — and only these exact names count: `.header.html.bak` is not one of them.

The server checks this independently of the client. Apache refuses every WebDAV write
against the exact path `.plandrop` at any depth, so no client can place a credential file on
a host. Where a deployment runs the bundled proxy, it goes further and refuses any request
for a dot-prefixed path outright, including reads — with the same three exceptions: the
theme files under `.plandrop/`, `.header.html`, and `.footer.html`.

It is a plain static host: files are served at the path they were published to, and
`index.html` answers a request for the directory itself. There is no renaming or automatic
indexing on the client side — what you upload is what is served. A directory with no
`index.html` answers with a themed listing (folders first, an icon per file type) wrapped in
the server's default chrome, at any depth; run [`index`](#index) to publish your own chrome
instead of the default.

A scaffolded document links to its theme with paths that start from the host root
(`/.plandrop/…`), so they resolve correctly wherever the document is published, at the root
or several folders down. The server also answers requests for `.plandrop/…` from the shared
theme files at every depth, which keeps an already-published document's relative links
working too. The one limit this creates: on a plandrop host, `.plandrop` is a reserved path.
You cannot publish a directory with that name — the server refuses to create one, and serves
the theme files in its place.

## index

Publish the chrome that a directory listing is wrapped in — the header and footer shown
above and below the file list when a directory has no `index.html`:

```sh
npx plandrop index
npx plandrop index intro.html
npx plandrop index intro.html --template darkly
```

It publishes two files at the host root: `.header.html` and `.footer.html`. Both come from a
template's own header and footer — the same pieces a scaffolded document is built from by
[`newdoc`](#newdoc) — so a directory listing appears in the same style as the documents
published beside it. Without them, a listing falls back to the server's own default style.

`index` writes the host root, and only the host root. The server looks for a header and a
footer in each directory separately, so a listing in a subdirectory does not inherit the pair
published at the root: subdirectory listings keep using the server's default style.

An optional hero file is an HTML fragment — a heading and a paragraph or two, not a whole
document — placed inside the header, so it renders between the page's own heading and the
list of files: the place to introduce what the listing shows. Running `index` again is safe:
both files are replaced each time, and a hero is never inserted twice.

The template is chosen with the same precedence as `newdoc`: the `--template` flag, then the
`.plandrop` file's recorded template, then the per-user config, then the server's default.

## fixcss

Rewrite the theme links inside your published documents so each one names the server
outright, instead of leaving it to be worked out from wherever the document happens to be
opened:

```sh
npx plandrop fixcss
```

It walks every HTML document under the publish root — the `.plandrop`'s recorded
`localRoot`, or the current directory when none is recorded — and looks for theme asset
links that carry no server address: a path starting from the host root (`/.plandrop/…`), a
path relative to the document (`.plandrop/…`), or one that climbs out of its folder first
(`../.plandrop/…`). Every one of these three forms is rewritten to name the server in full,
exactly as a freshly scaffolded document already does.

A link with no server address only resolves on the host the document was published to, so
the document loses its styling wherever else it is opened — from disk, sent as an email
attachment, or copied onto another host. Naming the server fixes that: the document carries
its own theme wherever it goes. A link that already names a server is left untouched, and so
is any document with nothing to fix. Every changed file is rewritten in place and printed.

The server address comes from the same domain resolution `create` uses (see
[Where the domain comes from](#where-the-domain-comes-from)), except `fixcss` never prompts:
it resolves from the `PLANDROP_DOMAIN` environment variable, the nearest `.plandrop`, or the
per-user or system config.

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

Install, update, or upgrade the autosync hook in the current project without creating a
host — for a project that already has one:

```sh
npx plandrop hooks                                   # uses recorded settings, or the defaults
npx plandrop hooks "plans/**/*.html"                 # a different glob, positional or --hook-path
npx plandrop hooks docs/**/*.html --hook-flat        # publish flat at the host root instead
```

It merges the same hook `create`'s offer scaffolds (see [Autosync hook](#autosync-hook))
into `.claude/settings.json`, preserving every other setting and hook, and publishes to
the host in the nearest `.plandrop` — it never creates one, and refuses clearly if no host
resolves.

A plandrop hook already in place is recognized however it's shaped — by its status message
and/or a command that invokes `plandrop upload` — not by exact text, so an older hook, or one
edited by hand, is found and upgraded rather than left beside a second one. One that already
matches the wanted watch glob and publish root is left alone; one that differs is replaced in
place, printing what changed.

With no path or `--local-root`/`--hook-flat` given: at a terminal it asks what to watch and
where to publish, defaulting both from whatever was recorded last time; otherwise — a bare
`plandrop hooks` run from a script or an agent — it silently applies the recorded settings,
or the same defaults the prompts preselect when nothing was ever recorded, so both paths
reach the same outcome. The silent run is also how a client version update upgrades an older
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

Subsequent commands (`upload`, `rotate`, `remove`) find the nearest `.plandrop` by checking
the current directory, then each of its parent directories in turn — so you can run them
from anywhere inside the project.

`hookWatch` and `hookPublish` (plus `localRoot`, present only when `hookPublish` is
`"root"`) record the autosync hook's watch glob and publish root the last time `create` or
`hooks` set one up — read back as defaults on a later interactive run, or applied silently
by a bare `plandrop hooks`. `localRoot` also controls where a manual `upload` with no
destination given publishes to (see [upload](#upload)) — it names the local directory
remote paths are measured from, for the hook and a manually run command alike. `version`
records the plandrop client version that last **changed** the file — a run that changes
nothing leaves it (and the file) untouched.

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

Using plandrop from an AI agent? A Claude Code **skill** packages this workflow
(scaffold → fill in → publish → share) with the commands and the safety checks that keep it
safe to run unattended, so the agent runs it when you ask to "start a doc with plandrop."
Install it with the [`skills`](https://github.com/Xalior/agent-skills) CLI:

```sh
npx skills add Xalior/agent-skills --skill plandrop
```
