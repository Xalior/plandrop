import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
  // npm sets the bin executable on install, but the build artifact itself
  // is asserted executable; set the bit at build time too.
  onSuccess: 'chmod +x dist/cli.js',
});
