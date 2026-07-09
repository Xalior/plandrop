# Changelog

## [Unreleased] — 0.4.0

## 0.3.0 — 2026-07-08

User-friendliness: discoverable help, guided onboarding, and a one-command localhost server.

### Added

- **`help` command** — `plandrop help` lists every command with a one-liner;
  `plandrop help <command>` (or `plandrop <command> --help`, or `-h` in any position) prints
  that command's usage, flags, and examples. A bare `plandrop` prints the overview (exit 0)
  instead of erroring, and an unknown command points at `plandrop help`. All command help text
  lives in one registry, so help and per-command usage errors can't drift apart.
- **`init` command** — guided first-run setup that *writes* the config the resolvers already
  read: the default domain (the public CDN `plandrop.dev` is offered, with its templates-only
  caveat) and optionally a default template, to either the per-user
  `~/.config/plandrop/config.json` (honours `XDG_CONFIG_HOME`) or a project-local `.plandrop`.
  Both targets are merged, never clobbered — an existing `host`/`passphrase` survives — and an
  existing per-user config is not overwritten without confirmation (`--force`
  non-interactively). Scriptable via `--domain`, `--template`, `--local`/`--user`, `--yes`;
  prints the absolute path it wrote.
- **System config tier** — domain/template resolution gains an admin-managed tier below the
  per-user config: each `$XDG_CONFIG_DIRS` entry (default `/etc/xdg`) as
  `<dir>/plandrop/config.json`, then `/etc/plandrop/config.json`, then the Homebrew `etc`
  prefixes. Read-only to the CLI (`init` never writes it). The per-user config also gains a
  `template` key, ranked below a `.plandrop`'s `template` in template precedence.
- **`server` command + `curl | bash` starter** — the canonical way to stand up a plandrop
  server is now `curl -fsSL https://plandrop.dev/start.sh | sh` (the committed
  `scripts/start.sh`, served from plandrop.dev); `npx plandrop server` downloads and runs the
  same starter. It requires Docker + Compose (clear message and non-zero exit when missing —
  it never installs anything), writes a localhost-defaults `.env` if none exists, fetches the
  self-contained `compose.proxy.yml`, pulls the prebuilt GHCR images, and brings the stack up
  on `http://localhost:8083` — no domain, DNS, or TLS proxy. Re-runnable; tracks `latest`
  unless `PLANDROP_VERSION` pins a release.
- **`create` offers the Claude Code autosync hook** — after minting a host, an interactive
  `create` offers (opt-in) to scaffold a `PostToolUse` hook in the project's
  `.claude/settings.json` that republishes a watched HTML document via `plandrop upload`
  whenever it is saved, prompting for the path to watch (default `docs/*.html`). The merge
  preserves existing settings and hooks and skips cleanly when an equivalent hook is already
  present. Non-interactive control via `--hook`/`--no-hook`/`--hook-path <glob>`.

### Changed

- **`upload` prints the file URL** — a single-file upload now prints the full shareable URL
  including the filename (the exact path it PUT to), so the link opens the document directly;
  a directory upload still prints the host root.

### Fixed

- **`create` no longer hangs on an unreachable host** — control-plane requests (`create`,
  `rotate`, `remove`, and `newdoc`'s template fetches) are bounded by a 10s timeout, so a
  domain that resolves but silently drops the connection (e.g. a LAN-only server addressed
  from off-LAN) fails with a clear "no response from `<host>` — is it reachable on your
  network?" instead of hanging forever.
- **Prompted commands exit cleanly** — stdin is paused and unref'd after every prompt (TTY
  included), so an interactive `create` returns to the shell after printing its result instead
  of keeping the process alive.

## [0.2.2] — 2026-06-28

### Changed

- **Self-contained server images** — every service now bakes its own config into its image,
  so the running stack is a true black box: the compose file plus a `.env` (and the `data/`
  tree) is all a deployer needs, with no repo checkout for host-side config. The Apache vhost
  config (`apache/httpd.conf`, with `${PLANDROP_APACHE_PORT}` still interpolated at runtime)
  ships in a new `ghcr.io/xalior/plandrop-apache` image, and the dev front-proxy config in
  `ghcr.io/xalior/plandrop-proxy`; both are multi-arch (`amd64`, `arm64`, `arm/v7`) and built
  by the publish workflow alongside `ingress`/`control`. Genuine runtime data and operator
  content (the `data/` tree, the operator `user-templates` drop-in, the seeded theme volume)
  stay as mounts. Building from source (`docker compose up -d --build`) still works.

### Documentation

- **Documented `newdoc`** in the [client usage guide](usage.md) — it was previously absent.
  Covers the no-host default (scaffolds from plandrop.dev's static, publish-less templates),
  the `--template` / `--domain` flags and their precedence, and static-vs-self-updating
  behaviour.
- **Corrected the stack description** in the README and docs index to the **three** containers
  (nginx ingress + Apache `mod_dav` host + control plane), not two — the ingress was missing.

## [0.2.1] — 2026-06-25

### Added

- **`newdoc` works without a host** — `newdoc` no longer requires a `.plandrop`. It resolves
  its template server by the usual precedence (`--domain` flag > `PLANDROP_DOMAIN` > nearest
  `.plandrop` > user config) and, with nothing configured, defaults to **plandrop.dev** — so
  `npx plandrop newdoc plan.html` scaffolds a document out of the box. Pointed at plandrop.dev
  you get **static, publish-less** templates (assets referenced by absolute
  `https://plandrop.dev/.plandrop/…` URLs, so the document renders standalone — even opened as
  a `file://` URL — and carrying the shared self-update script, which lies dormant on `file://`
  and comes alive once the saved plan is hosted over HTTP(S)); pointed at your own host you get
  that host's self-updating ones. Unlike `create`, `newdoc` never prompts — the default stands
  in for it.

- **Prebuilt container images on GHCR** — the `ingress` and `control` images are published
  to `ghcr.io/xalior/plandrop-ingress` and `ghcr.io/xalior/plandrop-control` on each release
  tag, multi-arch (`amd64`, `arm64`, `arm/v7`). `docker-compose.yml` references them so
  `docker compose pull && docker compose up -d` runs the stack with no local build; pin a
  release with `PLANDROP_VERSION` (default `latest`). Building from source still works with
  `docker compose up -d --build`.

### Changed

- **One shared `selfupdate.js`, not one per theme** — the self-update script is now seeded once
  at the theme-neutral `.plandrop/shared/js/selfupdate.js` and referenced by every template,
  instead of being copied byte-for-byte into all 27 theme folders (the per-theme CSS still
  differs and stays per theme). A fix to the update logic no longer means regenerating every
  theme. The script gained a `file://` guard — it no-ops when there is no host to poll — so it
  now also ships with the statically-scaffolded plandrop.dev templates for local plans.

### Fixed

- **Dark-theme navbar contrast** — the navbar in single-appearance Bootswatch themes now
  carries `data-bs-theme` on the navbar element itself, not just on `<html>`. Bootswatch
  gates its dark-navbar colours on the `.navbar[data-bs-theme=dark]` attribute selector,
  which doesn't match an inherited value, so the brand/links in dark themes (cyborg,
  darkly, slate, solar, superhero, vapor) were falling back to a near-black `#222` on a
  dark bar. The dual-mode `bootstrap5` skeleton is left inheriting so its light/dark toggle
  still flips the navbar with the page.

## [0.2.0] — 2026-06-23

Templates & themes, served behind a new nginx ingress.

### Added

- **`newdoc <filename>` command** — scaffold a template-based HTML document onto the
  local filesystem from a server-hosted template, named exactly as asked. Refuses to
  overwrite an existing file without `--force`. Template precedence: `--template` flag >
  the `.plandrop` `template` field > `default`.
- **Templates & themes** — a shipped set built on Bootstrap: `bootstrap5` (stock Bootstrap,
  light + dark) as the default, plus the full Bootswatch theme set. Each is self-hosted
  (no runtime CDN). `GET /api/templates` lists what's available.
- **`create --template <name>`** — pin a host's default template in `.plandrop`.
- **Configurable default template** — `PLANDROP_DEFAULT_TEMPLATE` (defaults to
  `bootstrap5`); resolved to a concrete name at scaffold time so existing documents never
  break when the default changes.
- **Operator drop-in templates** — a bind-mounted `/.plandrop/user/` tree; operator
  templates appear namespaced as `user/<name>` and are selectable like any other.
- **Shared template assets over `/.plandrop/`** — Apache serves each template's CSS/JS/etc.
  read-only under a hidden per-host path.
- **Branded directory listings** — a host root with no `index.html` is served as an
  autoindex wrapped in the default template's chrome, with a per-host `.header.html` /
  `.footer.html` override.
- **Self-updating documents** — a published document detects when it has been re-uploaded
  and swaps its content in place, with no manual refresh.
- Bootswatch + Bootstrap (MIT) attribution carried in the template footer alongside
  `plandrop.dev`.

### Changed

- **nginx ingress is now the sole public control entrypoint.** It serves the template
  statics and reverse-proxies `/api/*` to the control plane. The **control plane is now
  internal-only**, reachable only through the ingress on the docker network — never
  host-published — leaving the ingress as the single inbound chokepoint.
- The stack is now **three containers** (ingress + apache + control). The control plane's
  port is a fixed internal constant, no longer an operator setting; operators configure
  only the public ingress and apache ports.
- Themes render in their **native mode**: the light/dark toggle is offered only on the
  dual-mode `bootstrap5`; single-appearance Bootswatch themes render as designed.

## [0.1.0] — 2026-06-21

Initial proof-of-concept: push a finished static HTML document to a unique, secure
hostname and share the link, with zero server-side logic on the hosting path.

### Added

- **`npx plandrop` CLI** — `create` (mint a host: a unique hostname + passphrase, written
  to a local `.plandrop` file), `upload` (push a file or directory over authenticated
  WebDAV), `rotate` (change the passphrase), `remove` (delete the host and its content).
- **Control plane** (Node/Hono) — mints, rotates, and removes hosts; the sole writer of
  the per-tenant content tree and the bcrypt `htpasswd`.
- **Static + WebDAV host** (Apache `mod_dav`) — one dynamic vhost serves every subdomain:
  open reads, per-tenant authenticated writes (htpasswd username = the bare host label);
  cross-tenant and anonymous writes are denied (401).
- **Docker Compose stack** (apache + control), `.env` configuration, and the `.plandrop`
  dotfile with domain resolution (flag > env > nearest `.plandrop` > user config > prompt).
- Licensed **LGPL-3.0-only**.

[0.2.0]: https://github.com/Xalior/plandrop/releases/tag/v0.2.0
[0.1.0]: https://github.com/Xalior/plandrop/releases/tag/v0.1.0
