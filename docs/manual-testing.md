# Manual browser testing

In production a front proxy you run (NPM, Cloudflare, plain nginx, …) terminates
TLS and routes by hostname — the bare parent domain to the **ingress** and
`*.<domain>` to **apache**. That proxy lives outside this stack.

For local manual testing the repo ships that same front-proxy role as a real,
browser-reachable container: the **`proxy`** service. It is the *same* nginx
routing the automated test harness uses (`test/setup/stack.ts` brings this
service up), so manual and automated testing share one proxy definition — no
throwaway scripts. It is gated behind the **`testproxy`** Compose profile, so a
normal or production `docker compose up` never starts it.

The proxy routes by `Host` on a single published port:

| Host | Routed to | Purpose |
|------|-----------|---------|
| `localhost` (the bare `PLANDROP_PROXY_DOMAIN`) | ingress | template statics + `/api/*` |
| `*.localhost` (any subdomain) | apache | tenant static hosting + WebDAV |

So a browser and the CLI share **one** origin: `http://localhost:8083`.

## 1. Bring the stack up (repo infra only)

```sh
cd public
cp .env.example .env          # first time only; defaults are fine for local
mkdir -p data/hosts data/auth # or set PLANDROP_DATA to an existing dir
make manual-up                # = docker compose --profile testproxy up -d --build
```

`make manual-down` tears it back down (`docker compose --profile testproxy down -v`).

Defaults (override in `.env`): proxy on `127.0.0.1:8083`, parent domain
`localhost`. `*.localhost` resolves to loopback on macOS and modern Linux, so
tenant subdomains reach the proxy with no `/etc/hosts` edits.

## 2. Drive the CLI at the one proxy domain

From any working directory, point the CLI at the proxy origin:

```sh
mkdir /tmp/plandrop-manual && cd /tmp/plandrop-manual

# create a host (parent -> ingress -> control). Writes ./.plandrop (mode 0600).
/path/to/plandrop/bin/plandrop create --domain http://localhost:8083

# new docs: the default template (bootstrap5), plandrop's own f1terminal theme,
# and a couple of Bootswatch themes
/path/to/plandrop/bin/plandrop newdoc index.html                 # default = bootstrap5
/path/to/plandrop/bin/plandrop newdoc f1terminal.html --template f1terminal
/path/to/plandrop/bin/plandrop newdoc darkly.html   --template darkly
/path/to/plandrop/bin/plandrop newdoc solar.html    --template solar

# upload everything (*.localhost -> apache, WebDAV PUT)
/path/to/plandrop/bin/plandrop upload .
```

`create` prints the shareable URL, e.g. `http://<label>.localhost:8083/`.

## 3. Open it in a browser

Visit the URLs the CLI printed and confirm:

| URL | Expect |
|-----|--------|
| `http://<label>.localhost:8083/` | the **bootstrap5** doc renders; the **Toggle light / dark** button flips the page between light and dark (the theme lives on `<html data-bs-theme>`, and the click handler is delegated on `document`, so the toggle keeps working after a self-update `<body>` hot-swap). |
| `http://<label>.localhost:8083/f1terminal.html` | plandrop's own **Fanny's First Terminal** theme: opens **dark** (phosphor green on near-black, a `$` prompt and a blinking cursor on the navbar brand), and its **Toggle light / dark** button flips it to the warm-paper teletype appearance — chrome, table rules, badges, alerts and code all follow. |
| `http://<label>.localhost:8083/darkly.html` | a clearly **dark** Bootswatch theme — visibly different chrome from bootstrap5. |
| `http://<label>.localhost:8083/solar.html` | a third, distinct theme — confirms theme variety. |
| footer of a Bootswatch doc | the attribution line: *Theme by Bootswatch (MIT), built with Bootstrap (MIT), and served by [plandrop](https://plandrop.dev/)* — note the `plandrop.dev` link. |
| footer of `f1terminal.html` | the theme's own credit instead: *The Fanny's First Terminal theme by plandrop (LGPL-3.0-only), built with Bootstrap (MIT), …* |
| `http://<label>.localhost:8083/.plandrop/bootstrap5/css/bootstrap.min.css` | served `text/css` — the shared theme assets are self-hosted (no CDN), routed through apache on the tenant host. |
| inline `code` in any doc | renders **green** (dark green on light themes, lighter green on dark) — the cross-theme override `/.plandrop/shared/css/plandrop.css` loads after the theme CSS. |
| a doc with `<pre class="mermaid">` and a `<pre><code class="language-…">` block | the diagram renders as SVG and the code block is syntax-highlighted (self-hosted mermaid + highlight.js, lazy-loaded from `/.plandrop/shared/vendor/`); on bootstrap5 the light/dark toggle restyles both. |
| a subdir with no `index.html` (e.g. upload to `assets/` then visit `http://<label>.localhost:8083/assets/`) | Apache's **autoindex** listing, fully styled in the default theme's chrome (the chrome assets are absolute, so depth doesn't matter): a full-width hoverable table, folders first, file-type glyphs, quiet monospace date/size columns. |

All of the above go through the single `proxy` container — exactly the routing a
production front proxy performs.

## 4. Subdirectories and the autosync hook

From the same manual working directory (`/tmp/plandrop-manual`, still pointed at
`http://localhost:8083`):

```sh
mkdir -p docs/plans
cp index.html docs/plans/nested.html
/path/to/plandrop/bin/plandrop upload docs/plans/nested.html
/path/to/plandrop/bin/plandrop upload newdoc.html                # a lone file, cwd root
mkdir -p evidence && cp index.html evidence/a.html
/path/to/plandrop/bin/plandrop upload ./evidence                 # → /evidence/…
/path/to/plandrop/bin/plandrop upload ./evidence .                # → / (flattened)
```

Confirm:

| Check | Expect |
|-------|--------|
| nested single-file upload | `upload docs/plans/nested.html` prints and opens at `http://<label>.localhost:8083/docs/plans/nested.html` — Apache created the intermediate `docs/` and `docs/plans/` collections. |
| directory upload lands under its own name | `upload ./evidence` (no remote argument) serves its contents at `/evidence/…`. |
| explicit `.` flattens | `upload ./evidence .` serves the same directory's contents straight at the host root, with no `evidence/` prefix. |
| `create`'s hook prompt defaults to yes | In a fresh directory, run `create` at a terminal and press **Enter** (no typed answer) at `Set up a Claude Code hook…? [Y/n]`; it writes `.claude/settings.json` with the autosync hook rather than skipping it. |
| saving a nested watched file republishes it | With the hook installed (default glob `docs/**/*.html`), editing and saving a file like `docs/plans/x.html` in Claude Code auto-publishes it to the same mirrored path `upload` would use — no manual `upload` needed. |
| `plandrop hooks` installs standalone | In a project with a `.plandrop` but no hook yet (i.e. `create` was never offered, or was declined), run `plandrop hooks` — it writes `.claude/settings.json` with the hook. Running it again reports an equivalent hook already present and changes nothing. |

## 5. Testing from another device (across the LAN)

Sections 1–4 use `localhost`, which only resolves on the host itself. To open the
docs from a phone or another laptop you need a **wildcard domain that resolves to
this host's LAN IP**, because tenant vhosts are `*.<domain>`. Two ways to get one:

- **A wildcard DNS record you control** — point `*.plandrop.example.com` at the
  host's LAN address (e.g. `198.51.100.20`), and use `plandrop.example.com`.
- **Zero-config wildcard DNS** — `nip.io` / `sslip.io` resolve
  `<anything>.<ip>.nip.io` to `<ip>`. For a host at `203.0.113.10` the domain is
  `203.0.113.10.nip.io`, and any subdomain of it resolves to `203.0.113.10`.

Then expose the proxy port on the LAN and set the domain in `.env`:

```sh
# .env  — made-up IP shown; use your host's real LAN address
PLANDROP_PROXY_BIND=0.0.0.0                  # publish the proxy port on all interfaces
PLANDROP_PROXY_DOMAIN=203.0.113.10.nip.io    # your wildcard host (or plandrop.example.com)
```

Only the proxy port is exposed; apache and ingress stay on loopback and are
reached over the Docker network — the same single-front-door shape as
production. Bring it up and drive the CLI at that one domain:

```sh
make manual-up
mkdir ~/plandrop-manual && cd ~/plandrop-manual
/path/to/plandrop/bin/plandrop create --domain http://203.0.113.10.nip.io:8083
/path/to/plandrop/bin/plandrop newdoc index.html
/path/to/plandrop/bin/plandrop upload .
```

The shareable URLs become `http://<label>.203.0.113.10.nip.io:8083/`, reachable
from any device on the network — run the same section-3 browser checks there.

> The stack ships **without auth**, so exposing it on the LAN makes it reachable
> by anything on that network. That matches plandrop's model (LAN access is the
> security boundary) — but don't bind it to an internet-routable address.

## 6. Release smoke — every URL a feature fetches

A feature that fetches a published URL at runtime is only shipped when that URL
serves. After a release (npm + images) and any site deploy, probe each one at
its real, public location — not just in the local stack:

```sh
curl -sf -o /dev/null https://plandrop.dev/start.sh          # `plandrop server` downloads this
curl -sf https://plandrop.dev/api/templates | grep -q default # `newdoc` catalogue (static mirror)
curl -sf -o /dev/null https://plandrop.dev/.plandrop/shared/js/selfupdate.js
curl -sf -o /dev/null https://plandrop.dev/.plandrop/shared/js/enhance.js
```

Then one end-to-end client pass against the production host: `create` → a
nested `upload` (prints the full URL — open it) → `remove`. A 404 on any of
these is a shipped breakage even when every test is green: the suite exercises
the repo, not the published locations.
