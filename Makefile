.PHONY: build lint typecheck test check pack clean apache-pull apache-up apache-down

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

# Apache host service helpers. The integration tests manage their own throwaway
# container; these are for running the service against your own .env/data.
apache-pull:
	docker pull httpd:2.4

apache-up:
	docker compose up -d apache

apache-down:
	docker compose down -v
