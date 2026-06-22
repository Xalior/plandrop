.PHONY: build lint typecheck test check pack clean showcase apache-pull apache-up apache-down control-build control-up control-down manual-up manual-down

build:
	pnpm run build

lint:
	pnpm run lint

typecheck:
	pnpm run typecheck

test:
	pnpm run test

check: typecheck lint test

pack: build
	pnpm pack

clean:
	rm -rf dist
	rm -f plandrop-*.tgz

# Regenerate the all-themes showcase plan on a running stack. Builds the CLI,
# then runs gen-showcase against $(SHOWCASE_DOMAIN) (default http://localhost:8083),
# publishing from $(SHOWCASE_CWD) (default the current dir, which must hold a
# `.plandrop`). e.g. make showcase SHOWCASE_DOMAIN=http://localhost:8083 SHOWCASE_CWD=~/plandrop-eyeball
SHOWCASE_DOMAIN ?= http://localhost:8083
SHOWCASE_CWD ?= $(CURDIR)
showcase: build
	node scripts/gen-showcase.mjs --domain "$(SHOWCASE_DOMAIN)" --cwd "$(SHOWCASE_CWD)"

# Apache host service helpers. The integration tests manage their own throwaway
# container; these are for running the service against your own .env/data.
apache-pull:
	docker pull httpd:2.4

apache-up:
	docker compose up -d apache

apache-down:
	docker compose down -v

# Control plane service helpers. Build depends on dist/server.js (make build).
control-build: build
	docker compose build control

control-up: build
	docker compose up -d --build control

control-down:
	docker compose down -v

# Manual browser testflow — the whole stack PLUS the dev front proxy (the
# `testproxy` profile). The proxy is the same nginx routing the automated tests
# use: bare PLANDROP_PROXY_DOMAIN -> ingress, *.<domain> -> apache, on one host
# port (PLANDROP_PROXY_PORT). Point the CLI at http://<domain>:<port> and a
# browser at the host URLs it prints. See docs/manual-testing.md.
manual-up: build
	docker compose --profile testproxy up -d --build

manual-down:
	docker compose --profile testproxy down -v
