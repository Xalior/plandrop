import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli.ts', server: 'src/server.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  // Keep each entry self-contained: the control image copies only server.js,
  // and the published bins are single files. Splitting would hoist code shared
  // between cli and server (e.g. template helpers) into a separate chunk.
  splitting: false,
  // Bundle the control-plane runtime deps so the image is just Node + one file.
  noExternal: ['hono', '@hono/node-server', 'bcryptjs'],
  banner: { js: '#!/usr/bin/env node' },
  // npm sets the bin executable on install, but the build artifact itself
  // is asserted executable; set the bit at build time too.
  onSuccess: 'chmod +x dist/cli.js',
});
