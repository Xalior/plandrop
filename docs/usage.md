# Using the plandrop client

**plandrop** pushes a finished static HTML document to a unique, secure hostname on your
network and gives you a link to share. The client is an `npx` CLI; the hosting is served
with zero server-side logic.

You need a running plandrop stack and its **domain** (e.g. `https://plandrop.example.com`).
If you run the stack yourself, see [Self-hosting](setup.md).

## At a glance

```sh
# in the directory holding your finished document
npx plandrop create --domain https://plandrop.example.com
npx plandrop upload ./planfile.html
# → share the printed https://<host>.plandrop.example.com/ link
```

## Commands

| Command | What it does |
|---------|--------------|
| `create` | Mint a new host (a unique hostname + passphrase) and write them to a `.plandrop` file in the current directory. |
| `upload <path> [remote]` | Push a file or a directory (recursively) to your host over authenticated WebDAV. |
| `rotate` | Change the host's passphrase (the old one stops working immediately). |
| `remove` | Delete the host and its content, and remove the local `.plandrop`. |

## create

Run `create` in the directory you want to associate with a host:

```sh
npx plandrop create --domain https://plandrop.example.com
```

It calls the control plane, receives a generated **host label** and **passphrase**, and
writes a `.plandrop` file here. It prints the shareable URL and a reminder that the file
holds your passphrase.

If a `.plandrop` already exists in this directory, `create` refuses unless you pass
`--force` (which mints a new host and replaces the file).

### Where the domain comes from

You can give the domain explicitly, or let the client resolve it. Precedence, highest first:

| Source | Example |
|--------|---------|
| `--domain` flag | `--domain https://plandrop.example.com` |
| `PLANDROP_DOMAIN` env var | `export PLANDROP_DOMAIN=https://plandrop.example.com` |
| Nearest `.plandrop` (walking up from the current dir) | the `domain` field of a parent directory's `.plandrop` |
| Per-user config | `~/.config/plandrop/config.json` → `{ "domain": "https://plandrop.example.com" }` (honours `XDG_CONFIG_HOME`) |
| Interactive prompt / piped stdin | typed at a TTY, or `echo https://plandrop.example.com \| npx plandrop create` |

A bare hostname (no scheme) defaults to `https://`. An explicit `http://…` or `https://…`
URI — including a port — is used as given. The full URI is stored in `.plandrop`.

With nothing set and no input available (non-interactive, closed stdin), `create` exits
non-zero with a clear error.

## upload

Upload a single file (served at its name under the host root):

```sh
npx plandrop upload ./planfile.html            # → /planfile.html
npx plandrop upload ./planfile.html index.html # → /index.html (served at the bare URL)
```

Upload a whole directory, preserving its structure verbatim:

```sh
npx plandrop upload ./site
```

It's a plain static host: files are served at their paths, and `index.html` answers the
bare directory URL. There is no client-side renaming or index magic — what you upload is
what's served.

## rotate

```sh
npx plandrop rotate
```

Asks the control plane for a new passphrase and updates `.plandrop` in place. The old
passphrase stops authorizing writes immediately; reads are unaffected. Wrong credentials
leave the host and your `.plandrop` untouched.

## remove

```sh
npx plandrop remove
```

Deletes the host (its content and credentials) and removes the local `.plandrop`. After
this, the host URL returns 404 and writes are rejected. Wrong credentials change nothing.

## The `.plandrop` file

A small JSON file written at mode `0600` in the directory where you ran `create`:

```json
{
  "domain": "https://plandrop.example.com",
  "host": "<generated-label>",
  "passphrase": "<generated-passphrase>"
}
```

Subsequent commands (`upload`, `rotate`, `remove`) find the nearest `.plandrop` by walking
up from the current directory — so you can run them from anywhere inside the project.

> **Do not commit `.plandrop`.** It holds your host's passphrase. Add it to `.gitignore`.

### Targeting another host explicitly

Any argument of **8 characters or more** in front of the command is treated as a host label
that overrides the one in `.plandrop` (the passphrase still comes from `.plandrop`):

```sh
npx plandrop <host-label> upload ./planfile.html
```

Command names are all shorter than 8 characters, so the length of the first argument is
enough to tell a command from a host label.
