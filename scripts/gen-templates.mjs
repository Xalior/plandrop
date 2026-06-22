// Generate one plandrop template folder per Bootswatch theme.
//
// Each generated folder is the shared three-part skeleton (header.html /
// plan.html / footer.html + the self-update JS) taken from the bootstrap5
// template, with that theme's compiled, self-hosted CSS vendored in. The header
// references its assets by the concrete theme name, so a doc built from a theme
// links only into that theme's tree.
//
// The Bootswatch package ships a self-contained dist/<theme>/bootstrap.min.css
// (Bootswatch overrides + full Bootstrap, both copyright banners retained), so
// no SCSS compilation is needed here — just copy it in.
//
// Usage:
//   node scripts/gen-templates.mjs [--skeleton DIR] [--bootswatch DIR] [--out DIR]
// Defaults resolve to this repo's templates/bootstrap5, node_modules/bootswatch,
// and templates/ respectively.

import { cpSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

/** The template name baked into the skeleton header's asset paths. */
const SKELETON_NAME = 'bootstrap5';

/** Parts copied verbatim into every theme (no template-name paths inside). */
const VERBATIM = ['plan.html', 'footer.html'];

/**
 * Produce a theme folder from the skeleton + the theme's compiled CSS.
 * Returns the theme name. Pure file IO so it is unit-testable over temp dirs.
 */
export function generateTheme(theme, { skeletonDir, bootswatchDir, outDir }) {
  const dest = join(outDir, theme);
  mkdirSync(join(dest, 'css'), { recursive: true });
  mkdirSync(join(dest, 'js'), { recursive: true });

  // Header: rewrite the skeleton's asset paths to this theme's tree.
  const header = readFileSync(join(skeletonDir, 'header.html'), 'utf8').replaceAll(
    `.plandrop/${SKELETON_NAME}/`,
    `.plandrop/${theme}/`,
  );
  writeFileSync(join(dest, 'header.html'), header);

  for (const part of VERBATIM) {
    cpSync(join(skeletonDir, part), join(dest, part));
  }
  cpSync(join(skeletonDir, 'js', 'selfupdate.js'), join(dest, 'js', 'selfupdate.js'));

  // The theme's self-contained compiled CSS.
  cpSync(
    join(bootswatchDir, 'dist', theme, 'bootstrap.min.css'),
    join(dest, 'css', 'bootstrap.min.css'),
  );
  return theme;
}

/** Every theme name shipped by the Bootswatch dist (each dist subdir is a theme). */
export function bootswatchThemes(bootswatchDir) {
  const dist = join(bootswatchDir, 'dist');
  return readdirSync(dist)
    .filter((name) => statSync(join(dist, name)).isDirectory())
    .sort((a, b) => a.localeCompare(b));
}

export function generateAll({ skeletonDir, bootswatchDir, outDir }) {
  const themes = bootswatchThemes(bootswatchDir);
  for (const theme of themes) {
    generateTheme(theme, { skeletonDir, bootswatchDir, outDir });
  }
  return themes;
}

function parseArgs(argv) {
  const opts = {
    skeletonDir: join(repoRoot, 'templates', SKELETON_NAME),
    bootswatchDir: join(repoRoot, 'node_modules', 'bootswatch'),
    outDir: join(repoRoot, 'templates'),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--skeleton') {
      opts.skeletonDir = argv[++i];
    } else if (arg === '--bootswatch') {
      opts.bootswatchDir = argv[++i];
    } else if (arg === '--out') {
      opts.outDir = argv[++i];
    }
  }
  return opts;
}

// Run when invoked directly (not when imported by a test).
if (process.argv[1] && dirname(process.argv[1]) === dirname(fileURLToPath(import.meta.url))) {
  const opts = parseArgs(process.argv.slice(2));
  const themes = generateAll(opts);
  process.stdout.write(`generated ${themes.length} theme(s) into ${opts.outDir}\n`);
}
