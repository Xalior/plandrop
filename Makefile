.PHONY: build lint typecheck test check pack clean

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
