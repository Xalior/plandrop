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

## What it is

Two containers behind a reused TLS reverse proxy:

- **Apache `mod_dav` host** — one dynamic vhost serves every `*.domain` subdomain: open
  reads, per-tenant authenticated WebDAV writes.
- **Control plane** — a small Node/Hono service that mints and manages hosts (the only
  privileged writer of the content tree and credentials).

The control image builds entirely inside Docker (multistage), so the stack runs from a
clean clone with no host toolchain, on x86-64 or arm64.

## Docs

- [Using the client](docs/usage.html) — the `npx plandrop` CLI.
- [Self-hosting the stack](docs/setup.html) — Docker Compose, configuration, and the
  reverse-proxy / TLS / DNS it needs in front.

## License

LGPL-3.0-only.
