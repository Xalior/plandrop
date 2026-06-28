# plandrop

Push a finished static HTML document to a unique, secure hostname on your network and share the link — the hosted assets are served with **zero server-side logic**.

```sh
# in the directory holding your finished document
npx plandrop create --domain https://plandrop.example.com   # mint a host into .plandrop
npx plandrop upload ./planfile.html                          # push it over authed WebDAV
# → share the printed https://<host>.plandrop.example.com/ link
```

`upload`, `rotate`, and `remove` find the nearest `.plandrop` by walking up from the
current directory. The `.plandrop` file holds your passphrase — **don't commit it.**

Start from a themed template instead of a blank file with `npx plandrop newdoc plan.html`
(works with no host — it defaults to the public template gallery on plandrop.dev).

## What it is

Three containers behind a reused TLS reverse proxy:

- **Ingress** — a small nginx, the only public entrypoint: it serves the shared template
  assets and reverse-proxies the control API to the internal control plane.
- **Apache `mod_dav` host** — one dynamic vhost serves every `*.domain` subdomain: open
  reads, per-tenant authenticated WebDAV writes.
- **Control plane** — a small Node/Hono service that mints and manages hosts (the only
  privileged writer of the content tree and credentials), reached only via the ingress.

Prebuilt multi-arch images (`amd64`, `arm64`, `arm/v7`) are published to GHCR, each carrying
its own config, so the stack runs from just the compose file and a `.env` with
`docker compose pull` — no host toolchain and no host-side config, on a server or a Raspberry
Pi alike. Prefer to build from source? The images build entirely inside Docker
(`docker compose up -d --build`).

## Docs

- [Using the client](docs/usage.md) — the `npx plandrop` CLI.
- [Self-hosting the stack](docs/setup.md) — Docker Compose, configuration, and the
  reverse-proxy / TLS / DNS it needs in front.

## License

LGPL-3.0-only.
