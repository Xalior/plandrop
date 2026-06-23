# Self-hosting the plandrop stack

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

- Docker + Docker Compose. The control image builds entirely inside Docker (multistage),
  so **no Node toolchain is needed on the host** — it builds on x86-64 or arm64 alike.
- A reverse proxy that terminates TLS and routes by hostname (e.g. Nginx Proxy Manager,
  Caddy, Traefik, plain nginx).
- A domain you control, with a wildcard DNS record (see below).

## Quick start

```sh
git clone https://github.com/Xalior/plandrop.git
cd plandrop
cp .env.example .env       # then edit (see below)
mkdir -p data/hosts data/auth
docker compose up -d --build
```

This builds the ingress and control images, pulls Apache, and starts the stack bound to the
address in your `.env`.

## Configuration (`.env`)

| Variable | Meaning | Example |
|----------|---------|---------|
| `PLANDROP_BIND` | Host address the services bind on — the address your reverse proxy reaches them at. `127.0.0.1` for local; in a deployment, the docker-bridge gateway (`172.17.0.1`) or another proxy-reachable IP. | `172.17.0.1` |
| `PLANDROP_INGRESS_PORT` | Plain-HTTP port for the ingress — the public control entrypoint your reverse proxy points the apex at. | `8082` |
| `PLANDROP_APACHE_PORT` | Plain-HTTP port for the static/WebDAV host (in-container and on the host, mapped 1:1). Unprivileged. | `8080` |
| `PLANDROP_CONTROL_PORT` | The control plane's **internal** docker-network port. Not host-published — reached only through the ingress. | `8081` |
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
| Update to the latest version | `git pull && docker compose up -d --build` |
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
