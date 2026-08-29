# Self-hosting the plandrop stack

This page covers a **real-domain deployment** — the stack behind a reverse proxy with
wildcard DNS and TLS, reachable across your network. To just **try plandrop locally** on one
machine with no domain or DNS, use the one-command starter in the [Quickstart](quickstart.md)
instead.

The stack is three containers sharing one data volume:

| Service | Role |
|---------|------|
| **ingress** | A dockerised nginx. The only publicly-reachable control entry point: it serves `/.plandrop/*` template files and forwards `/api/*` requests to the control plane over the internal Docker network. Published on `PLANDROP_INGRESS_PORT`. |
| **apache** | A dockerised Apache server using `mod_dav`. One dynamic virtual host (vhost) serves every subdomain: reads are open to anyone, and writes need the matching host's passphrase. Served content is static files only. It also serves the shared, read-only template files under `.plandrop/` for every subdomain — reachable from a document at any depth, not just the subdomain's root — and it refuses every write to anything named `.plandrop`, whether that is the shared path or the bare name on its own. This matters because the client keeps its own local credential file (holding your passphrase) under that same name; the block stops that file from ever landing on the host by accident. Published on `PLANDROP_APACHE_PORT`. |
| **control** | A small Node/Hono service: the only writer of the shared content tree and the credentials file. It creates hosts (`create`) and changes or removes them (`rotate`, `remove`). Internal-only — reached solely through the ingress. |

The ingress and apache speak **plain HTTP**. TLS and routing are provided by a reverse
proxy you put in front (see [Ingress](#ingress)) — that part is deliberately out of scope
and reusable.

## Requirements

- Docker + Docker Compose. Prebuilt images are published, so **no toolchain is needed on
  the host** — and if you'd rather build from source, the images are multistage and build
  entirely inside Docker.
- For `compose.exposed.yml`: a reverse proxy that terminates TLS and routes by hostname
  (e.g. Nginx Proxy Manager, Caddy, Traefik, plain nginx), plus a domain you control with a
  wildcard DNS record (see below). `compose.proxy.yml` bundles its own proxy and needs
  neither for localhost/single-host use.

## Choose a compose file

The stack ships as two ready-to-run, **image-only** compose files — no repository, no
build, just the compose file plus a `.env`:

| File | Use |
|------|-----|
| **`compose.exposed.yml`** | Behind **your own** TLS/reverse proxy (this guide). ingress and apache publish plain-HTTP ports for the proxy to reach. |
| **`compose.proxy.yml`** | **Self-contained** — bundles its own proxy so a single host port serves both the control entry point and every `*.<domain>` host, with no external proxy needed. That proxy also refuses any request for a dot-prefixed path segment (`.git`, `.env`, the `.plandrop` credential file) with a 403 response before it reaches a backend, except the shared template namespace `.plandrop/` and the two per-host listing-chrome file names `.header.html` / `.footer.html`. Good for a single host, or for trying plandrop on `localhost`. |

(`docker-compose.yml` in the repository is the **development build/test** stack — it
carries the build contexts and is not for deployment.)

## Quick start

Download the compose file you want and a `.env`, then pull the images and start the stack —
no clone, no build:

```sh
mkdir plandrop && cd plandrop
curl -fsSLO https://raw.githubusercontent.com/Xalior/plandrop/main/compose.exposed.yml
curl -fsSL https://raw.githubusercontent.com/Xalior/plandrop/main/.env.example -o .env
# edit .env (see below); set COMPOSE_FILE=compose.exposed.yml so bare `docker compose` finds it
mkdir -p data/hosts data/auth
docker compose pull        # fetch the prebuilt images from GHCR
docker compose up -d
```

Each image carries its own configuration, so the only host-side files are the compose file,
`.env`, and the `data/` tree. The images are **multi-architecture** — `amd64`, `arm64`, and
`arm/v7` (32-bit ARM) — so they run on a Raspberry Pi as well as a server. The stack uses the
`latest` image tag by default; set `PLANDROP_VERSION` in `.env` to pin a specific release
instead.

> **Build from source instead** — for development, clone the repository with `git clone` and
> use the dev stack, which builds the images from the Dockerfiles: `docker compose up -d
> --build`.

## Configuration (`.env`)

| Variable | Meaning | Example |
|----------|---------|---------|
| `PLANDROP_BIND` | The host address the services bind on — the address your reverse proxy reaches them at. Use `127.0.0.1` for local use; in a deployment, use the Docker bridge network's gateway address (`172.17.0.1` on Linux) or another address your proxy can reach. | `172.17.0.1` |
| `PLANDROP_INGRESS_PORT` | The plain-HTTP port for the ingress service — the entry point your reverse proxy sends control traffic to (the bare domain, with no subdomain). | `8082` |
| `PLANDROP_APACHE_PORT` | The plain-HTTP port for the static/WebDAV host, used both inside the container and on the host machine (mapped 1:1). It is an unprivileged port (above 1024), which lets the container run as a non-root user. | `8080` |
| `PLANDROP_DEFAULT_TEMPLATE` | The template used when a host's directory listing has no header/footer of its own, and the template that the name `default` resolves to when scaffolding a document with `newdoc`. Leave unset to use `bootstrap5`; an unrecognised value also falls back to `bootstrap5`. Changing it takes effect on the next restart. | `bootstrap5` |
| `PLANDROP_USER_TEMPLATES` | A host path to your own drop-in templates, made available alongside the built-in ones. | `./user-templates` |
| `PLANDROP_UID` / `PLANDROP_GID` | The Linux user and group ID the containers run as, and that should own the `data/` tree. Files written by the stack are owned by this UID. | `1000` |
| `PLANDROP_DATA` | A host path to the data root (holds `hosts/` and `auth/`). Keep it out of version control. | `./data` |

### Data layout

```
<data>/hosts/<label>/www/   content for one host (its served document root)
<data>/auth/htpasswd         shared credentials file (bcrypt, one line per host)
```

The control plane creates each host's directory and writes the credentials file; Apache
reads the credentials and serves and accepts writes under `hosts/`. Both containers run as
`PLANDROP_UID`, so file ownership stays consistent between them.

## Ingress

Put a TLS-terminating reverse proxy in front and configure two routes against your domain —
here `plandrop.example.com`:

| Hostname | Send requests to | Purpose |
|----------|-------------------|---------|
| `plandrop.example.com` (the bare domain, no subdomain) | `http://<PLANDROP_BIND>:<PLANDROP_INGRESS_PORT>` | ingress — template files, and the control API (create / rotate / remove) |
| `*.plandrop.example.com` | `http://<PLANDROP_BIND>:<PLANDROP_APACHE_PORT>` | apache — serves and accepts writes for each host |

Three things the proxy must get right:

- **A wildcard TLS certificate** covering both `plandrop.example.com` and
  `*.plandrop.example.com`. A wildcard certificate from Let's Encrypt requires the **DNS-01**
  challenge — the HTTP-01 challenge cannot issue wildcard certificates.
- **Wildcard DNS**: `*.plandrop.example.com` must resolve to the proxy, so every host you
  create is reachable at its own subdomain.
- **WebDAV methods and request body size**: the `*.` route must forward the `PUT`, `MKCOL`,
  `PROPFIND`, and `DELETE` HTTP methods (not always allowed by a proxy's default
  configuration), and must allow a request body large enough for your documents (for
  example, nginx's `client_max_body_size` setting).

The client connects to the bare domain for control calls (create, rotate, remove) and to
`<host>.domain` for uploading and reading documents; the proxy's hostname-based routing
handles the rest. The control plane does not store any domain, and Apache identifies each
host only by its label (the first part of the hostname), so the same stack works behind any
domain you point at it.

> **Security:** creating a host (`create`) requires **no authentication** — anyone who can
> reach the ingress can create a new host. Restrict who can reach that route (for example,
> limit it to your local network, a VPN, or a proxy access list). Writes to an existing host
> always require that host's generated passphrase; reads are public by design.

## Operating

| Task | Command (from the stack directory) |
|------|-----------------------------------|
| Update | `docker compose pull && docker compose up -d` — no `git pull` needed, since the stack runs from images only. Re-fetch the compose file only if it changes; move to a different release by editing `PLANDROP_VERSION`. |
| Restart | `docker compose restart` |
| View logs | `docker compose logs -f` |
| Stop | `docker compose down` (data in `data/` is kept) |

> **Doubled log lines:** apache's vhost uses `[PT]` (pass-through) rewrite rules in several
> places, for example to serve the shared `.plandrop/` files at any path depth. A `[PT]` rewrite sends the request
> through Apache's URL-to-file mapping a second time, so any line logged for that request —
> including an error — is written twice. Two identical log lines for one request is expected
> here; it does not mean the request was made twice or that something is retrying.

Back up the `data/` tree to preserve hosted content and credentials.

## Verifying the stack (without the proxy)

You can exercise the ingress and apache containers directly, using an explicit `Host` header,
before the reverse proxy is in place. The control API is reached through the ingress port:

```sh
BIND=172.17.0.1; A=8080; I=8082; D=plandrop.example.com
# create a host
read host pass < <(curl -s -X POST http://$BIND:$I/api/hosts \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["host"],d["passphrase"])')
# upload a file, then read it back
curl -s -o /dev/null -w '%{http_code}\n' -X PUT -u "$host:$pass" \
  -H "Host: $host.$D" --data '<h1>hello</h1>' http://$BIND:$A/index.html   # 201
curl -s -H "Host: $host.$D" http://$BIND:$A/                              # <h1>hello</h1>
# remove the host
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE -u "$host:$pass" \
  http://$BIND:$I/api/hosts/$host                                          # 204
```
