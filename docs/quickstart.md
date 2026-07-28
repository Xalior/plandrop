# Quickstart — run plandrop on your own machine

Start a complete plandrop server on your own machine and publish your first document — no
domain name, no DNS, and no TLS proxy needed. For a deployment on a real domain behind a
reverse proxy, see [Self-hosting](setup.md) instead.

## Start a server

The recommended way to start a server is a single command from plandrop.dev:

```sh
curl -fsSL https://plandrop.dev/start.sh | sh
```

`npx plandrop server` downloads and runs the same script, so you don't have to remember the
URL. To read the script before running it, download it first and run it separately:

```sh
curl -fsSL https://plandrop.dev/start.sh -o start.sh
# read start.sh, then:
sh start.sh
```

The script checks that Docker and Docker Compose are installed, and stops with a clear
message if either is missing — it never installs them for you. It then writes a `.env` file
with default settings for local use, if one does not already exist; downloads the
ready-to-run Compose file; pulls the prebuilt images from the GitHub Container Registry
(GHCR); and starts the stack at `http://localhost:8083`. Running the script again is safe:
an existing `.env` file or Compose file is kept as is, and the script just pulls the latest
images and updates the running stack. The script tracks the `latest` images; to pin a
release instead, set `PLANDROP_VERSION` in `.env` to that release's version number.

## Publish a document

With the server running, the full publish workflow works against `http://localhost:8083`:

```sh
npx plandrop init --domain http://localhost:8083   # record the local server as your default
npx plandrop create                                # create a host
npx plandrop newdoc plan.html                      # generate a document from a theme
npx plandrop upload plan.html                      # publish it
# → http://<host-label>.localhost:8083/plan.html
```

`*.localhost` addresses resolve to your own machine automatically on most current operating
systems — macOS, and Linux with `systemd-resolved` or an `nss-myhostname`/`dnsmasq` setup —
so the hostname `create` generates opens directly in a browser with no DNS setup. On a Linux
system where this does not happen (some minimal or older configurations), add the hostname
to `/etc/hosts` yourself — for example `127.0.0.1 <host-label>.localhost` — or set up a
local DNS resolver.

## Building from source instead

The starter script downloads prebuilt images. To run plandrop from a checkout instead — to
develop it, or to inspect every file before running anything — clone the repository and
build the stack locally:

```sh
git clone https://github.com/Xalior/plandrop.git
cd plandrop
docker compose -f compose.proxy.yml up -d --build
```

`compose.proxy.yml` includes its own reverse proxy, so it needs no external reverse proxy
and no DNS for local use — the same stack the starter script runs, built from source instead
of downloaded as prebuilt images.
