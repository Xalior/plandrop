# Changelog

## 0.7.0 — 2026-08-14

### Added

- **`plandrop text` prints an HTML document as markdown.** The target is a local
  file or a published URL, and the markdown goes to standard output. Headings,
  lists, links, tables and code blocks keep their structure, and entities are
  decoded. The conversion is mechanical: nothing is summarised or reflowed, and
  no part of the page is selected as the part worth keeping, so the output can be
  compared against the source. `<script>` and `<style>` are removed with their
  contents, an `<iframe>` is kept as HTML so its address survives, and a table
  with no header row is kept as HTML rather than having its cells run together.

- **A theme can ship its own fonts and images.** A hand-authored theme under
  `themes/` was limited to `theme.json` and `theme.css`, so every graphic had to
  be a CSS gradient or an inline `data:` URI and a web font could not be
  included at all. Any other file or folder in a theme directory is now copied
  into the generated template, keeping its layout, and the theme's stylesheet
  reaches it by relative address: `url("../fonts/name.woff2")`.

- **A new theme, Rachel's First PCB (`r1pcb`).** A printed circuit board in
  light and dark: a solder mask surface, component cards, and a seamless trace
  pattern behind the page. It carries the Ryga typeface (SIL Open Font License
  1.1) for its titles and the trace pattern as an SVG, both served from the
  theme rather than fetched from anywhere else. A single hue value sets the
  board colour, in the `oklch()` colour space, so changing it repaints the theme
  without dropping below the WCAG AA contrast minimum. Choose it with
  `--template r1pcb` or the `template` field in `.plandrop`.

### Fixed

- **An `@import` in a hand-authored theme's stylesheet now works.** The served
  stylesheet is Bootstrap followed by the theme's own rules, and CSS obeys
  `@import` only where it comes before every style rule, so such a rule was
  discarded by the browser with no request made and no error reported. These
  rules are moved to the top of the joined stylesheet. Everything else keeps its
  order, so the cascade is unchanged.

## 0.6.0 — 2026-07-28

### Added

- **A new theme, Sonny's First Notebook (`s1notebook`).** A light theme in the
  style of a paper jotter: cream paper with ruled lines, a red margin rule and
  ring-binder holes down the left edge, a book serif for prose and a
  handwriting face for headings, buttons and labels. Its decoration is drawn
  entirely in CSS, so it costs no extra downloads, and it names no web font, so
  it looks the same with no network. Choose it like any other theme, with
  `--template s1notebook` or the `template` field in `.plandrop`.

- **`plandrop index` publishes the header and footer that wrap a directory
  listing.** When a directory on a host contains no `index.html`, the server
  lists its files instead. That listing is wrapped in two files the tenant
  publishes, `.header.html` and `.footer.html`; when they are absent the
  server falls back to its own configured default theme, so a listing is
  never unstyled. `plandrop index` writes both files at the host root, taken
  from a template's own header and footer, so the listing uses the same theme
  as the documents published beside it rather than the server default. The
  template is chosen by the usual precedence: `--template` > the nearest
  `.plandrop`'s `template` field > the per-user config > the server default.

  Given a file as an argument, its HTML is placed at the end of the header,
  which puts it between the page heading and the list of files — the place to
  introduce what a visitor is looking at. That file is a fragment, such as a
  heading and a paragraph, not a complete HTML document; it is wrapped in a
  themed block for you. Running the command again overwrites both files and
  never marks up a header twice, so it is safe to repeat.

  The command writes the host root only. The server resolves the header and
  footer separately for each directory, so a listing in a subdirectory does
  not inherit the root's pair: subdirectory listings continue to use the
  server's default theme.

- **`plandrop fixcss` rewrites theme asset links so they name the server.** A
  document can carry a link to its theme's stylesheet that has no origin in
  it, in any of three shapes: root-absolute (`/.plandrop/…`), relative
  (`.plandrop/…`), or climbing (`../.plandrop/…`). All three resolve on the
  host the document was published to, and none of them resolve anywhere else,
  so the document renders without styling when it is opened from disk, sent
  to someone by mail, or copied to another host. `fixcss` walks every HTML
  document under the publish root — the `localRoot` recorded in the nearest
  `.plandrop`, or the current directory when none is recorded — and rewrites
  every origin-less link to name the server outright, which is what a freshly
  scaffolded document already does. Links that already name an origin are left
  unchanged. Files are rewritten in place and every changed file is printed.

### Fixed

- **Served files declare their character encoding.** The host added no
  `charset` to any response. A document that states its own encoding in-band
  was unaffected — every built-in template carries `<meta charset="utf-8">` —
  but a file with no such mechanism was decoded using whatever default the
  reader's browser applied, so UTF-8 bytes were read as Latin-1 and a
  character such as `·` (bytes `C2 B7`) displayed as `Â·`. The host now sends
  `charset=utf-8` on text responses.

  Markdown was affected worst, because it was served with no `Content-Type` at
  all: the standard MIME type list the server uses ships its markdown entry
  disabled, so the browser was left to guess both the type and the encoding. A
  `.md` file is now served as `text/plain; charset=utf-8`, which displays in a
  browser tab and carries the encoding explicitly. (`text/markdown` is the
  stricter type, but browsers download it instead of displaying it.)

- **The bundled proxy serves only the domain it is configured for.** The
  self-contained stack (`compose.proxy.yml`) puts one small proxy in front of
  everything, and it decides where a request goes by the `Host` header it
  carries: the bare `PLANDROP_PROXY_DOMAIN` reaches the control entrypoint, and
  a subdomain of it reaches a published document. Every *other* host name was
  treated as a subdomain, so a request naming any name at all — an unrelated
  domain, or the machine's own IP address — was served document content. The
  proxy now matches subdomains explicitly and answers anything else with
  `421 Misdirected Request` and one line of plain text naming the domain it does
  serve, so a request that arrives at the wrong address is refused rather than
  answered, and says so.

- **The autosync hook requests the client `@latest`, not bare.** The generated
  hook ran `npx -y plandrop upload`, and `npx` reuses whatever it has cached
  without consulting the registry — so a machine holding an older client kept
  publishing under path rules the installed version no longer uses, silently,
  on every save, with nothing on screen to say which client ran. The hook now
  names `plandrop@latest`. An existing hook is recognised whatever version spec
  it carries (bare, `@latest`, or pinned), so `plandrop hooks` upgrades one in
  place rather than leaving a second behind.

### Changed

- **A scaffolded document names its own template server, so it renders on
  disk.** `newdoc` wrote the server's root-absolute asset links through
  verbatim (`/.plandrop/…`), which resolve only once the document is published
  — off disk that path names the filesystem root, so a freshly scaffolded file
  opened in a browser was unstyled. It now qualifies those links against the
  server the template came from, exactly as the public host's static templates
  already did for plandrop.dev: the assets resolve from any origin, and a
  document still renders published at any depth. The base is the resolved
  domain (`--domain` > `PLANDROP_DOMAIN` > the nearest `.plandrop` > user
  config > plandrop.dev), so a project's own `.plandrop` points its documents
  at its own server. The self-update script is qualified with them and still
  stands down on anything but http(s), leaving a document on disk inert until
  it is hosted.

- **The starter document tells its author to link relatively.** A host's root
  need not be the directory documents are written in: with a `localRoot`
  recorded, `docs/` publishes *as* the root, so `docs/plans/x.html` is served
  at `/plans/x.html` and an `href` of `/docs/plans/x.html` 404s once
  published. The scaffolded document's authoring comment now says so — link
  between documents relatively (`plans/x.html`, `../index.html`), which
  survives the mapping and works on the local file in a browser too.

## 0.5.4 — 2026-07-26

### Fixed

- **A directory upload honours `localRoot` too.** `localRoot` names the local
  root remote paths are resolved against, and a single file obeyed it while a
  directory did not: with `localRoot: "docs"`, `upload docs/plans/x.html`
  landed at `/plans/x.html` but `upload docs` published the same file at
  `/docs/plans/x.html` — a `docs/` folder the recorded root says is the host
  root. Both branches now resolve against the same anchor, so `upload docs`
  fills the host root and `upload docs/plans` fills `/plans/`: a directory
  publishes exactly where its files land one at a time. With no `localRoot`
  the anchor is the cwd, so `upload ./evidence` still publishes `/evidence/…`;
  an explicit remote argument still wins; and `upload .` still publishes
  what's here to the host root — the cwd's own name is never a folder.

## 0.5.3 — 2026-07-26

### Changed

- **The silent hook default now matches the interactive one.** With no mode
  flag and nothing recorded, a non-TTY `create --hook`/`hooks` run picked
  `mirror` while the interactive prompt preselected publishing relative to
  the watched directory — so an agent-driven install (which can never reach
  the prompts) landed documents at `/docs/…` where a human pressing Enter
  would have got them at the host root. Every path now defaults to
  root-of-watch-dir (collapsing to mirror when the watch glob has no
  directory of its own); flags and recorded settings steer it exactly as
  before, and an empty `--local-root=""` selects mirror explicitly without a
  prompt. A `.plandrop` that already records `"hookPublish": "mirror"` keeps
  mirroring — only never-recorded setups feel the change.

### Fixed

- **`upload` honours `localRoot`, completing the 0.5.2 rename's promise.** The
  key names the local root remote paths are resolved against — not a hook-only
  setting — yet only the generated hook applied it (by `cd`ing there). A
  single-file upload with no explicit remote now mirrors against the recorded
  `localRoot` (under the dotfile's directory): with `localRoot: "docs"`,
  `upload docs/plans/x.html` publishes `/plans/x.html` from anywhere in the
  project — exactly where the hook lands the same save — instead of wherever
  the shell's cwd happened to place it. No `localRoot` recorded → cwd-relative
  mirroring, unchanged; an explicit remote argument still wins; directory
  uploads keep their own-name semantics.

- **`.plandrop`'s `version` stamp records mutations, not uses.** A run whose
  config merge changes nothing (a bare `plandrop hooks` re-applying what's
  already recorded, or flags matching the recorded state) leaves the file
  byte-identical — it no longer rewrote the dotfile just to restamp `version`
  with whichever client happened to run, which destroyed the stamp's value as
  a record of what last *changed* the file.

- **`create` no longer buries the per-user template preference.** With no
  `--template` flag it wrote the literal `default` alias into `.plandrop`,
  and — the dotfile outranking the user config in `newdoc`'s fallback chain —
  that fabricated entry shadowed `~/.config/plandrop/config.json`'s `template`
  on every host minted thereafter. An unexpressed preference now stays absent
  from the dotfile, so the per-user config keeps working; a host minted from a
  config-only `.plandrop` (`init --local`) still inherits its recorded
  template unchanged.

## 0.5.2 — 2026-07-26

### Fixed

- **`--hook-root` misnamed the concept — it is `--local-root`, and the dotfile
  key `hookRoot` is `localRoot`.** The value names the local root that remote
  paths are resolved against, which is not a hook-only concern. Same
  semantics, same `--hook-flat` exclusivity, same implied `--hook`. No
  compatibility shim: a `.plandrop` written with `hookRoot` needs the key
  renamed to `localRoot`.

## 0.5.1 — 2026-07-25

### Fixed

- **The error log is quiet again** — the theme namespace's read-only guard relied on a
  nested `Dav Off`, which mod_dav cannot honour inside a DAV-enabled location and
  answered with an `AH00578` log line on every request that walked it — near-every page
  view once documents began resolving their theme through `/.plandrop/`. The line is
  gone; the method gate (`Require all denied` on every non-read method) was always the
  operative guard, and every write-refusal test holds unchanged.

## 0.5.0 — 2026-07-25

### Added

- **Configurable publish root for the autosync hook** — `create` and `hooks` gain
  `--hook-root <dir>` (publish relative to `<dir>` under the project root rather than
  mirroring the full project path) and `--hook-flat` (publish every watched file flat at
  the host root, by its own basename), alongside the existing project-mirror default — the
  silent, no-flags behaviour is unchanged. All three modes are the same idea: the
  generated hook `cd`s to a root and uploads the saved file's path relative to it, exactly
  as a manual `upload` from that root would; a save outside the configured root falls back
  to `upload`'s own bare-basename behaviour. Interactively, `create`'s accepted hook offer
  and an interactive `hooks` run both ask where to publish after asking what to watch,
  defaulting to "relative to the watched directory". Every hook-taking flag
  (`--hook-path`, `--hook-root`, `--hook-flat`) implies `--hook`.
- **The autosync hook is recognized and upgraded, not duplicated** — an existing plandrop
  hook is found by a durable fingerprint (its status message and/or a command that invokes
  `plandrop upload`), not by exact text, so a hook from an older client version or a
  hand-edited one is replaced in place — printing the watch/root change — instead of being
  left beside a second one. A hook that already matches the wanted shape is untouched.
- **The watch glob and publish root are recorded in `.plandrop`** — `hookWatch`,
  `hookPublish`, and (in root mode) `hookRoot` are written alongside the domain and
  template whenever `create` or `hooks` sets up the hook. A later interactive run defaults
  from them (Enter keeps them); a bare `plandrop hooks` with no arguments re-applies them
  silently, upgrading an older hook shape without needing to be told the settings again.
- **`.plandrop` carries a `version` field** — every write or merge (`create`, `init
  --local`, `rotate`, hook-field recording) stamps the plandrop client version that wrote
  it, refreshed each time.
- **`--version`/`-v`** — prints the CLI's own version and exits. `plandrop help`'s
  overview now shows the version in its header line too.
- **`/api/templates` reports the control plane's own version** — a `version` field (e.g.
  `"0.5.0"`) baked from `package.json` at build time, alongside `default` and
  `templates`. plandrop.dev's static mirror carries the same field, sourced from the
  vendored public checkout's package.json at generation time.

### Changed

- **Scaffolded documents reference their theme assets by root-absolute path** —
  `newdoc` now writes `/.plandrop/…` links (previously document-relative
  `.plandrop/…`), so a freshly scaffolded document resolves its theme, the shared
  stylesheet, self-update and enhancer scripts against the host root directly,
  independent of the subpath it's published at. The any-depth alias below remains
  in place for documents already published with the older relative links.

### Security

- **Nothing hidden is ever published** — `upload` skips every dot-prefixed name it walks:
  dot-files one line each, dot-directories pruned whole and never descended into, so a
  `.git` costs a single line rather than thousands. Every omission is printed
  (`skipped .git/ (hidden)`), so the author sees what did not go. Naming one explicitly is
  refused rather than obeyed, with the `.plandrop*` family called out for what it is — the
  host's passphrase, and the write key to everything published there. Previously `upload .`
  from the directory holding `.plandrop` published that passphrase world-readable at
  `/.plandrop`. Two hidden names are exempt, because they are content you publish on
  purpose: `.header.html` and `.footer.html`, the chrome your directory listings are
  wrapped in. They upload at any depth, and are exact names — a `.header.html.bak` is not
  one of them.
- **The server refuses the reserved name too** — apache denies every WebDAV write method
  (PUT, DELETE, MKCOL, COPY, MOVE, PROPPATCH, LOCK) against the exact path segment
  `.plandrop`, at any depth, in both shapes it can take: the collection the theme tree
  would shadow, and the plain file that is a credential. A COPY or MOVE whose destination
  names one is refused with it. No client — plandrop's or anyone else's — can put a
  credential file on a host.
- **The bundled front proxy drops dotted paths at the door** — the self-contained stack's
  proxy answers 403 to any request whose URI carries a dot-prefixed path segment, whatever
  the method and reads included, saving the backend hop and putting a passive floor under
  anything already uploaded. It makes the same three exceptions the client does: the shared
  theme namespace `.plandrop/` at any depth (but not the bare `.plandrop`), and the exact
  names `.header.html` and `.footer.html`. A deployment fronted by an external proxy (NPM,
  Cloudflare, …) does not inherit this layer — apache's guard is the authoritative one.

### Fixed

- **A document published below the host root reaches its theme** — `.plandrop/` is a
  reserved namespace at *every* depth, not just the host root: apache maps
  `…/.plandrop/…` onto the same read-only theme tree wherever it appears, so the relative
  asset links every scaffolded document ships with resolve from the subpath the document
  is published at. A doc at `/plans/deep/x.html` now styles itself and self-updates
  exactly as one at the root does — with no change to already-published documents. The
  namespace is reserved, so it shadows a tenant path segment named `.plandrop` at any
  depth; writes into it (and creating a collection of that name) are refused rather than
  landing where no read could reach them.

## 0.4.1 — 2026-07-25

### Fixed

- **`upload .` publishes to the host root** — uploading the current directory itself
  lands its contents at `/…`, not under a folder named after the cwd's incidental
  basename. Named directories (`upload ./evidence`) keep defaulting to their own name;
  an explicit remote argument still wins.

## 0.4.0 — 2026-07-25

### Added

- **`f1terminal` (Fanny's First Terminal) — plandrop's own theme, and a way to write more** — a hand-made, dual-appearance
  Bootstrap 5 theme: a phosphor CRT in dark (near-black glass, soft green text, a prompt and
  a blinking block cursor on the navbar brand, raster lines across the chrome only) and a
  teletype printout in light (warm paper, near-black ink, deep ink accents). Sharp corners,
  monospace throughout, both palettes meeting WCAG AA. It scaffolds, seeds, self-updates and
  enhances like every other theme, and carries the navbar light/dark toggle. Hand-authored
  themes live in `themes/<name>/` as a manifest plus a stylesheet; the generator renders each
  into a full template folder — the skeleton's chrome over stock Bootstrap with the theme's
  layer appended — so regeneration reproduces them instead of clobbering them, and a change
  to the shared chrome reaches them automatically. A theme's `theme.json` declares its
  appearances (which decides the toggle) and its credit, which replaces the Bootswatch
  attribution in the document footer. See `themes/README.md`.

- **Mermaid diagrams and syntax highlighting, preinstalled** — every scaffolded document can
  simply write `<pre class="mermaid">…</pre>` (or a `language-mermaid` code block) and fenced
  `<pre><code class="language-…">` blocks; a new shared enhancer
  (`.plandrop/shared/js/enhance.js`) renders them on load with **mermaid** and
  **highlight.js**, served self-hosted from `.plandrop/shared/vendor/` (no runtime CDN). The
  enhancer is lazy — a document with no diagrams or code blocks fetches nothing beyond the
  ~2KB scan — and theme-aware: both renderers follow `data-bs-theme`, the bootstrap5 toggle
  re-renders diagrams and flips the highlight stylesheet live, and a self-update body swap
  re-enhances the fresh content. The bundles are vendored from the pinned npm packages
  (licenses included) by the template generator.
- **The scaffolded starter speaks to agents** — the template body is now a single HTML
  comment addressed to the authoring agent, spelling out what is preinstalled and automatic
  (Bootstrap 5, mermaid, highlighting) and inviting it to replace the comment with the
  document. The rest of the template markup is bare — no comments; the generator recognises
  the theme-toggle block by its `data-bs-theme-toggle` attribute rather than marker comments.
- **The showcase plan demos the enhancers** — Project Bigdrop's plan gains a sequence
  diagram of the "AI enrichment" call, its exit funnel as a flowchart, and
  syntax-highlighted bash/JavaScript blocks, so every theme's showcase doc exercises
  mermaid and highlight.js.
- **`hooks` command** — `plandrop hooks [path] [--hook-path <glob>]` installs or updates
  the autosync hook in the current project without minting a host, for a project whose
  host already exists. It reuses the same merge `create`'s offer scaffolds with (preserves
  every other setting and hook, no-ops when an equivalent hook is already present) and
  refuses clearly when no host resolves from the nearest `.plandrop`.

### Changed

- **Directory listings look like the theme, not like 1996** — the autoindex table is styled
  by the shared stylesheet (full-width, hoverable rows, quiet monospace date/size columns,
  file-type glyphs for folders/images/documents), riding Bootstrap's CSS custom properties so
  it follows every theme and scheme. `mod_autoindex` gains `FoldersFirst`, `IgnoreCase`,
  `SuppressRules`, `NameWidth=*`, and `Charset=UTF-8`.

- **Inline code is calm green, not angry pink** — a new shared, theme-neutral override
  stylesheet (`.plandrop/shared/css/plandrop.css`, loaded after every theme's
  `bootstrap.min.css`) retunes Bootstrap's `--bs-code-color` across all themes: dark green
  (`#11632a`) on light themes, a lighter green (`#7ec699`) under `data-bs-theme="dark"`. The
  vendored Bootswatch CSS stays byte-identical to upstream — cross-theme appearance tweaks now
  have a single home that survives Bootswatch upgrades. Each generated `<html>` carries a
  `data-plandrop-theme="<name>"` attribute so the override sheet can make per-theme exceptions:
  quartz (nominally light, but its signature surface is saturated purple glass) takes the
  dark-scheme green.

- **`upload` mirrors where you keep a file** — a single-file upload with no remote path
  now publishes to the same subpath it occupies under the current directory
  (`upload docs/plans/x.html` → `/docs/plans/x.html`, creating any missing collections
  along the way) instead of collapsing to its basename at the host root. A path outside
  the current directory (absolute, or escaping via `../`) still falls back to its
  basename, and an explicit remote path still wins outright. Every uploaded file — from
  a single-file upload, or each one in a directory upload — now prints its own full
  shareable URL; a directory upload no longer prints only the host root.

- **A directory upload's remote argument names a destination, not a root** —
  `upload <dir>` with no remote argument now lands the directory's contents under its
  own name (`upload ./evidence` → `/evidence/…`) rather than the host root; a remote
  argument still names the destination explicitly (`upload ./evidence photos` →
  `/photos/…`), and `.` is the explicit way to flatten a directory's contents into the
  host root (`upload ./evidence .` → `/…`). A remote argument that resolves to or above
  the root (`.`, `..`, or an escaping path) is treated as the root, so a directory upload
  can never address a collection outside the host.

- **The autosync hook offer defaults to yes** — `create`'s interactive prompt is now
  `Set up a Claude Code hook that auto-publishes saved HTML documents? [Y/n]`; a bare
  Enter opts in, and only an answer starting with `n` declines. `--hook`, `--no-hook`,
  and `--hook-path` are unchanged.

- **The autosync hook watches nested plans by default** — `DEFAULT_WATCH_GLOB` is now
  `docs/**/*.html` (was `docs/*.html`), and the generated hook command uploads a saved
  file by its path relative to the project root rather than flattening it to
  `<watch-dir>/<basename>`, so a save now republishes to the same mirrored path `upload`
  would use for that file.

### Fixed

- **Subdirectory listings are no longer unstyled** — the seeded autoindex chrome's asset
  links are absolutized (`/.plandrop/…`); the previous document-relative links only resolved
  at the host root, so any listing below it rendered as bare HTML.

- **WebDAV directory creation no longer chases Apache's own redirect** — `makeDir`
  addresses every collection with its trailing slash (`MKCOL /docs/`, not `/docs`), so it
  never triggers Apache's DirectorySlash redirect in the first place; the WebDAV client's
  underlying fetch is patched to follow only same-origin redirects itself, refusing — with
  a clear error naming both origins — to follow one that would take the request off the
  endpoint the client addressed. That case previously surfaced as an opaque connection
  failure to an internal address nobody typed.

- **Apache's self-referential URLs now match the origin the client used, not the
  container's own listen socket** — the trailing-slash redirect for a directory URL is
  now issued from `mod_rewrite`'s fixup phase (ahead of `mod_dir`'s handler) using the
  request's forwarded scheme (`X-Forwarded-Proto`, falling back to the connection's own)
  and `Host`, instead of Apache's `ServerName`/port; `mod_dav`'s `201 Created` `Location`
  header is stripped down to a path via `mod_headers`. Both now resolve correctly behind
  a TLS proxy, behind a plain-HTTP one, or with no proxy in front at all.

### Documentation

- The README notes that every template ships with mermaid and syntax highlighting
  preinstalled; the [client usage guide](usage.md) documents the enhancers under `newdoc`
  and the themed directory listing under `upload`; the manual-testing checklist covers the
  green inline code, the enhancer render checks, and the styled listing.
- The [client usage guide](usage.md) documents `upload`'s subpath-mirroring and
  destination-folder rules, the `hooks` command, and the default-yes autosync offer; the
  README and usage guide describe `.plandrop` neutrally — what it holds and that it's a
  credential — rather than instructing on committing it; the manual-testing checklist
  gains a nested-upload, directory-destination, default-yes-prompt, and standalone-`hooks`
  checklist.

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
