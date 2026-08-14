# plandrop documentation

**plandrop** publishes a finished static HTML document to a unique, secure web address and
gives you a link to share. The published files are served with **zero server-side logic** —
the server returns the exact bytes you uploaded; no code runs to build or generate the page.

```sh
npx plandrop create --domain https://plandrop.example.com
npx plandrop upload ./planfile.html
# → share https://<host>.plandrop.example.com/
```

## Guides

- **[Quickstart](quickstart.md)** — start a complete plandrop server on your own machine
  with Docker, no domain name or DNS needed, and publish your first document.
- **[Using the client](usage.md)** — every `npx plandrop` command: `create`, `newdoc`,
  `upload`, `index`, `fixcss`, `rotate`, `remove`, `text`, `init`, `server`, `hooks`, and
  `help`; the `.plandrop` file; and how the target server is chosen.
- **[Self-hosting the stack](setup.md)** — run the three-container stack (nginx ingress +
  Apache WebDAV host + control plane) with Docker Compose, and the reverse proxy, TLS, and
  DNS it needs in front.
- **[Manual testing](manual-testing.md)** — a checklist for testing a running stack by hand
  in a browser, for anyone contributing to plandrop.
- **[Changelog](CHANGELOG.md)** — every released change, by version.

## How it fits together

- Your domain reaches the **ingress**, which sits in front of the internal **control
  plane**. The control plane creates a host: a unique label and passphrase, a directory for
  that host's files, and an entry in the credentials file. It is the only part of the stack
  allowed to write any of these.
- The **Apache host** (answering on `*.yourdomain.com`) serves each host's files to anyone
  who asks, and accepts authenticated WebDAV writes only from that host's owner.
- The **client** (the `npx plandrop` command) writes a local `.plandrop` file recording the
  host, passphrase, and domain, then uploads your files over authenticated WebDAV and prints
  the link to share.
- A reverse proxy that you provide handles TLS (the encryption behind `https://`) for every
  subdomain and routes each request to the right container; the ingress and the Apache host
  themselves communicate over plain HTTP behind it.

Source: <https://github.com/Xalior/plandrop> · LGPL-3.0-only.
