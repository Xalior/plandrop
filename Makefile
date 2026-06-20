.PHONY: build lint typecheck test check pack clean

build:
	npm run build

lint:
	npm run lint

typecheck:
	npm run typecheck

test:
	npm run test

check: typecheck lint test

pack: build
	npm pack

clean:
	rm -rf dist
	rm -f plandrop-*.tgz
