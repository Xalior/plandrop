# Self-hosting the plandrop stack

This page covers a **real-domain deployment** — the stack behind a reverse proxy with
wildcard DNS and TLS, reachable across your network. To just **try plandrop locally** on one
machine with no domain or DNS, use the one-command starter in the [Quickstart](quickstart.md)
instead.

The stack is three containers sharing one data volume:

| Service | Role |
|---------|------|
| **ingress** | A dockerised nginx. The only publicly-reachable control entrypoint: it serves `/.plandrop/*` template statics and reverse-proxies `/api/*` to the control plane over the internal docker network. Host-published on `PLANDROP_INGRESS_PORT`. |
| **apache** | A dockerised Apache `mod_dav` host. One dynamic vhost serves every subdomain: open reads, per-tenant authenticated WebDAV writes. Served content is purely static. Host-published on `PLANDROP_APACHE_PORT`. |
| **control** | A small Node/Hono service: the only writer of the shared content tree and the credentials file. It mints hosts (`create`) and changes/removes them (`rotate`, `remove`). Internal-only — reached solely through the ingress. |

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

The stack ships as two ready-to-run, **image-only** compose files — no repo, no build, just
the compose file plus a `.env`:

| File | Use |
|------|-----|
| **`compose.exposed.yml`** | Behind **your own** TLS/reverse proxy (this guide). ingress + apache publish plain-HTTP ports for the proxy to reach. |
| **`compose.proxy.yml`** | **Self-contained** — bundles its own proxy so a single host port serves both the control entrypoint and the `*.<domain>` tenant hosts, with no external proxy. Good for a single host or trying it on `localhost`. |

(`docker-compose.yml` in the repo is the **development build/test** stack — it carries the
build contexts and is not for deployment.)

## Quick start

Grab the file you want and a `.env`, then pull + up — no clone, no build:

```sh
mkdir plandrop && cd plandrop
curl -fsSLO https://raw.githubusercontent.com/Xalior/plandrop/main/compose.exposed.yml
curl -fsSL https://raw.githubusercontent.com/Xalior/plandrop/main/.env.example -o .env
# edit .env (see below); set COMPOSE_FILE=compose.exposed.yml so bare `docker compose` finds it
mkdir -p data/hosts data/auth
docker compose pull        # fetch the prebuilt images from GHCR
docker compose up -d
```

Each image carries its own config, so the only host-side files are the compose file, `.env`,
and the `data/` tree. The images are **multi-arch** — `amd64`, `arm64`, and `arm/v7` (32-bit
ARM) — so they run on a Raspberry Pi as well as a server. Track `latest` (default) or pin a
release with `PLANDROP_VERSION` in `.env`.

> **Build from source instead** — for development, `git clone` the repo and use the dev
> stack, which builds the images from the Dockerfiles: `docker compose up -d --build`.

## Configuration (`.env`)

| Variable | Meaning | Example |
|----------|---------|---------|
| `PLANDROP_BIND` | Host address the services bind on — the address your reverse proxy reaches them at. `127.0.0.1` for local; in a deployment, the docker-bridge gateway (`172.17.0.1`) or another proxy-reachable IP. | `172.17.0.1` |
| `PLANDROP_INGRESS_PORT` | Plain-HTTP port for the ingress — the public control entrypoint your reverse proxy points the apex at. | `8082` |
| `PLANDROP_APACHE_PORT` | Plain-HTTP port for the static/WebDAV host (in-container and on the host, mapped 1:1). Unprivileged. | `8080` |
| `PLANDROP_DEFAULT_TEMPLATE` | Template applied to a host's autoindex chrome when none is requested. | `bootstrap5` |
| `PLANDROP_USER_TEMPLATES` | Host path to operator drop-in templates, layered over the built-ins. | `./user-templates` |
| `PLANDROP_UID` / `PLANDROP_GID` | The user/group the containers run as, and that the `data/` tree should be owned by. Writes land as this UID. | `1000` |
| `PLANDROP_DATA` | Host path to the data root (holds `hosts/` and `auth/`). Keep it out of version control. | `./data` |

### Data layout

```
<data>/hosts/<label>/www/   per-tenant content (served docroot)
<data>/auth/htpasswd         shared credentials (bcrypt, one line per host)
```

The control plane creates host directories and writes the credentials file; Apache reads
the credentials and serves/accepts writes under `hosts/`. Both run as `PLANDROP_UID` so
ownership is consistent.

## Ingress

Put a TLS-terminating reverse proxy in front and configure two routes against your domain —
here `plandrop.example.com`:

| Hostname | Proxy to | Purpose |
|----------|----------|---------|
| `plandrop.example.com` (apex) | `http://<PLANDROP_BIND>:<PLANDROP_INGRESS_PORT>` | ingress — template statics + the control API (create / rotate / remove) |
| `*.plandrop.example.com` | `http://<PLANDROP_BIND>:<PLANDROP_APACHE_PORT>` | apache — static + WebDAV serving |

Three things the proxy must get right:

- **Wildcard TLS certificate** covering both `plandrop.example.com` and
  `*.plandrop.example.com`. A wildcard cert from Let's Encrypt requires the **DNS-01**
  challenge (HTTP-01 cannot issue wildcards).
- **Wildcard DNS**: `*.plandrop.example.com` must resolve to the proxy, so each minted
  host's subdomain is reachable.
- **WebDAV methods + body size**: the `*.` route must forward `PUT`, `MKCOL`, `PROPFIND`,
  and `DELETE` (not in a proxy's default method set), and allow a request body large enough
  for your documents (e.g. nginx `client_max_body_size`).

The client connects to the apex for control calls and to `<host>.domain` for
uploads/serving; the proxy's host routing does the rest. The control plane stores no domain
and Apache keys off the host *label*, so the same stack works behind any domain.

> ⚠️ **Security:** `create` has **no authentication** — anyone who can reach the ingress can
> mint a host. Restrict who can reach the apex route (LAN-only, VPN, or a proxy access list).
> Per-host writes are always authenticated by the generated passphrase; reads are public by
> design.

## Operating

| Task | Command (from the stack directory) |
|------|-----------------------------------|
| Update | `docker compose pull && docker compose up -d` — no `git pull` (image-only). Re-fetch the compose file only if it changes; move releases by editing `PLANDROP_VERSION`. |
| Restart | `docker compose restart` |
| Logs | `docker compose logs -f` |
| Stop | `docker compose down` (data in `data/` persists) |

Back up the `data/` tree to preserve hosted content and credentials.

## Verifying the stack (without the proxy)

You can exercise the backends directly with an explicit `Host` header before the proxy is
in place. The control API is reached through the ingress port:

```sh
BIND=172.17.0.1; A=8080; I=8082; D=plandrop.example.com
# create
read host pass < <(curl -s -X POST http://$BIND:$I/api/hosts \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["host"],d["passphrase"])')
# upload + read back
curl -s -o /dev/null -w '%{http_code}\n' -X PUT -u "$host:$pass" \
  -H "Host: $host.$D" --data '<h1>hello</h1>' http://$BIND:$A/index.html   # 201
curl -s -H "Host: $host.$D" http://$BIND:$A/                              # <h1>hello</h1>
# remove
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE -u "$host:$pass" \
  http://$BIND:$I/api/hosts/$host                                          # 204
```
