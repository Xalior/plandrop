# plandrop

**plandrop** publishes a finished static HTML document to a unique, secure web address on
your network, so you can share the link with anyone else on that network. The published
files are served with **zero server-side logic** — the server returns the exact bytes you
uploaded; no code runs to build or generate the page.

```sh
# in the directory holding your finished document
npx plandrop create --domain https://plandrop.example.com   # create a host and save it to .plandrop
npx plandrop upload ./planfile.html                          # upload the file over authenticated WebDAV
# → share the printed https://<host>.plandrop.example.com/ link
```

`upload`, `rotate`, and `remove` look for the nearest `.plandrop` file, checking the current
directory and then each parent directory in turn. The `.plandrop` file holds your passphrase
and grants write access to the host — treat it as a credential and keep it private.

Start from a themed template instead of a blank file with `npx plandrop newdoc plan.html`
(this needs no server of your own — with nothing configured it uses the public template
gallery at plandrop.dev). Choose from stock Bootstrap, plandrop's own `f1terminal` theme
(Fanny's First Terminal — a light and a dark appearance in one theme), or any theme from
Bootswatch, a free collection of Bootstrap themes. Every built-in template includes two
tools with no extra setup: Mermaid, for diagrams written as plain text (wrap the text in
`<pre class="mermaid">`), and syntax highlighting for code (mark a code block with a
`language-*` class, e.g. `language-python`).

**Try it locally:** `npx plandrop server` starts a complete plandrop stack on your own
machine using Docker, with no domain name or DNS setup needed — see the
[Quickstart](docs/quickstart.md).

## What it is

Three Docker containers, running behind a TLS reverse proxy — a server that accepts the
incoming connection and forwards it to the right container — that you already run or set up
separately:

- **Ingress** — a small nginx server. It is the only container reachable from outside the
  stack: it serves the shared template files and forwards `/api/*` requests to the internal
  control plane.
- **Apache WebDAV host** — a single Apache server configured so one instance serves every
  subdomain (`*.yourdomain.com`). Anyone can read the published files; only the owner of a
  subdomain, authenticated over WebDAV (a protocol for uploading and managing files over
  HTTP), can write to it.
- **Control plane** — a small Node.js service, built on the Hono framework, that creates and
  manages hosts. It is the only part of the stack allowed to write the shared content
  directory and the credentials file, and it is reached only through the ingress.

Ready-to-run images are published to the GitHub Container Registry (GHCR) for three
processor architectures — `amd64`, `arm64`, and `arm/v7` — so `docker compose pull`
downloads a working image for a typical server, an ARM64 machine, or an older 32-bit
Raspberry Pi alike, with nothing to install and nothing to configure beyond the compose file
and a `.env` file. To build from source instead, run `docker compose up -d --build`: the
images build entirely inside Docker, so no separate toolchain is needed on your machine
either.

## Docs

- [Quickstart](docs/quickstart.md) — run a server locally and publish your first document,
  no domain or DNS.
- [Using the client](docs/usage.md) — the `npx plandrop` CLI.
- [Self-hosting the stack](docs/setup.md) — Docker Compose, configuration, and the
  reverse-proxy / TLS / DNS it needs in front.

**Using plandrop from an AI coding agent?** Install the Claude Code skill:
`npx skills add Xalior/agent-skills --skill plandrop` (see
[Using the client](docs/usage.md#claude-code-skill)).

## License

LGPL-3.0-only.
