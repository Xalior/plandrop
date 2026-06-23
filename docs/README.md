# plandrop documentation

Push a finished static HTML document to a unique, secure hostname on your network and share
the link — hosted assets are served with **zero server-side logic**.

```sh
npx plandrop create --domain https://plandrop.example.com
npx plandrop upload ./planfile.html
# → share https://<host>.plandrop.example.com/
```

- **[Using the client](usage.md)** — the `npx plandrop` CLI: `create`, `upload`, `rotate`,
  `remove`, the `.plandrop` file, and how the domain is resolved.
- **[Self-hosting the stack](setup.md)** — run the three-container stack (nginx ingress +
  Apache `mod_dav` host + control plane) with Docker Compose, and the reverse-proxy / TLS /
  DNS it needs in front.

## How it fits together

- Your parent domain reaches the **ingress**, which fronts the internal **control plane**
  that mints a host: a unique label + passphrase, a per-tenant directory, and a credentials
  entry. The control plane is the only privileged writer.
- The **Apache host** (on `*.domain`) serves each host's content read-only to anyone, and
  accepts authenticated WebDAV writes from that host's owner.
- The **client** writes a local `.plandrop` with the host, passphrase, and domain, then
  uploads over authenticated WebDAV and prints the shareable link.
- A reused **reverse proxy** provides wildcard TLS and host routing; the two services speak
  plain HTTP behind it.

Source: <https://github.com/Xalior/plandrop> · LGPL-3.0-only.
