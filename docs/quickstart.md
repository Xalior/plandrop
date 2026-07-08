# Quickstart — run plandrop locally

Stand up a complete plandrop server on your own machine and publish your first document —
no domain, no DNS, no TLS proxy. For a real-domain deployment behind a reverse proxy, see
[Self-hosting](setup.md) instead.

## Start a server

The canonical way to stand up a server is a one-liner from plandrop.dev:

```sh
curl -fsSL https://plandrop.dev/start.sh | sh
```

`npx plandrop server` downloads and runs that same starter, so you don't have to remember
the URL. Prefer to read it before running it? Fetch, inspect, then run:

```sh
curl -fsSL https://plandrop.dev/start.sh -o start.sh
# read start.sh, then:
sh start.sh
```

The starter checks for Docker + Compose (and stops with a clear message if either is
missing — it never installs them), writes a localhost-defaults `.env` if none exists,
fetches the ready-to-run compose file, pulls the prebuilt GHCR images, and brings the stack
up on `http://localhost:8083`. It is re-runnable — an existing `.env` or compose file is
kept, then `pull` + `up -d` refresh the stack. It tracks the `latest` images; set
`PLANDROP_VERSION` in `.env` to pin a release.

## Publish a document

With the server up, the full loop works against `http://localhost:8083`:

```sh
npx plandrop init --domain http://localhost:8083   # record the local server as your default
npx plandrop create                                # mint a host
npx plandrop newdoc plan.html                      # scaffold a document from a theme
npx plandrop upload plan.html                      # publish it
# → http://<host-label>.localhost:8083/plan.html
```

`*.localhost` resolves to loopback on modern OSes (macOS, and Linux with `systemd-resolved`
or an `nss-myhostname`/`dnsmasq` setup), so the minted hostnames open in a browser with no
DNS configuration. Where it doesn't (some minimal or older Linux resolvers), add the label
to `/etc/hosts` — e.g. `127.0.0.1 <host-label>.localhost` — or run a local resolver.

## From source instead

The starter pulls prebuilt images. To run from a checkout — to develop plandrop or inspect
everything first — clone the repo and build the bundled-proxy stack locally:

```sh
git clone https://github.com/Xalior/plandrop.git
cd plandrop
docker compose -f compose.proxy.yml up -d --build
```

`compose.proxy.yml` bundles its own front proxy, so it needs no external reverse proxy or
DNS for localhost use — the same shape the starter runs, built from source rather than
pulled.
