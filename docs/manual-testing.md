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

# new docs: the default template (bootstrap5) plus a couple of Bootswatch themes
/path/to/plandrop/bin/plandrop newdoc index.html               # default = bootstrap5
/path/to/plandrop/bin/plandrop newdoc darkly.html --template darkly
/path/to/plandrop/bin/plandrop newdoc solar.html  --template solar

# upload everything (*.localhost -> apache, WebDAV PUT)
/path/to/plandrop/bin/plandrop upload .
```

`create` prints the shareable URL, e.g. `http://<label>.localhost:8083/`.

## 3. Open it in a browser

Visit the URLs the CLI printed and confirm:

| URL | Expect |
|-----|--------|
| `http://<label>.localhost:8083/` | the **bootstrap5** doc renders; the **Toggle light / dark** button flips the page between light and dark (the theme lives on `<html data-bs-theme>`, and the click handler is delegated on `document`, so the toggle keeps working after a self-update `<body>` hot-swap). |
| `http://<label>.localhost:8083/darkly.html` | a clearly **dark** Bootswatch theme — visibly different chrome from bootstrap5. |
| `http://<label>.localhost:8083/solar.html` | a third, distinct theme — confirms theme variety. |
| footer of any doc | the attribution line: *Theme by Bootswatch (MIT), built with Bootstrap (MIT), and served by [plandrop](https://plandrop.dev/)* — note the `plandrop.dev` link. |
| `http://<label>.localhost:8083/.plandrop/bootstrap5/css/bootstrap.min.css` | served `text/css` — the shared theme assets are self-hosted (no CDN), routed through apache on the tenant host. |
| a subdir with no `index.html` (e.g. upload to `assets/` then visit `http://<label>.localhost:8083/assets/`) | Apache's **autoindex** listing of the directory. |

All of the above go through the single `proxy` container — exactly the routing a
production front proxy performs.
