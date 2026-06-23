# Changelog

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
