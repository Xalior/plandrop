/**
 * plandrop's own version (public/package.json's "version"). Injected as a
 * literal string by tsup's `define` at build time (mirrored by vitest's
 * `define` for tests), so the CLI never reads package.json from disk at
 * runtime — the published bundle has no fixed relationship to dist/cli.js's
 * location it could rely on.
 */
declare const __PLANDROP_VERSION__: string;
