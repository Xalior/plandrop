// Generate one plandrop template folder per Bootswatch theme.
//
// Each generated folder is the shared three-part skeleton (header.html /
// plan.html / footer.html + the self-update JS) taken from the bootstrap5
// template, with that theme's compiled, self-hosted CSS vendored in. The header
// references its assets by the concrete theme name, so a doc built from a theme
// links only into that theme's tree.
//
// Appearance policy — honour each theme's NATIVE mode:
//   * bootstrap5 (the skeleton) is the one genuinely dual-mode design — stock
//     Bootstrap's light AND dark are both well-built — so it keeps the navbar
//     light/dark toggle button and the paired footer toggle <script>, defaulting
//     to data-bs-theme="light".
//   * Every Bootswatch theme is a single-appearance design. Forcing a toggle on
//     them produced a long tail of contrast bugs, so we DROP the toggle (button
//     + script) and pin data-bs-theme to the theme's own native scheme, letting
//     it render exactly as Bootswatch authored it. No contrast patches.
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

/**
 * Bootswatch themes whose native scheme is DARK — they get data-bs-theme="dark"
 * so their highest-contrast vars resolve and they render as designed; every
 * other Bootswatch theme is native LIGHT.
 *
 * Detected from each theme's compiled CSS: a theme is native-dark when its
 * default `:root` surface is dark AND it relies on Bootstrap's [data-bs-theme=dark]
 * scope to resolve a usable emphasis/foreground (its `:root` block alone leaves
 * --bs-emphasis-color dark-on-dark). That picks out exactly these six. The list
 * is hardcoded (and asserted against the live CSS by the generator test) so the
 * build needs no CSS parser at runtime.
 *
 * NOTE — quartz is the one deliberate exclusion. By raw luminance its `:root`
 * surface (#686dc3) skews dark and its body text is white, so a naive detector
 * flags it dark. But quartz's SIGNATURE design (the saturated purple glass look)
 * lives in `:root`/light, and its [data-bs-theme=dark] block REPLACES that purple
 * with a generic grey (#212529) — i.e. forcing dark would destroy the theme's
 * identity. So quartz is treated as native LIGHT, where Bootswatch authored it.
 */
const NATIVE_DARK_THEMES = new Set([
  'cyborg',
  'darkly',
  'slate',
  'solar',
  'superhero',
  'vapor',
]);

/** The native data-bs-theme scheme for a theme. */
export function nativeScheme(theme) {
  if (theme === SKELETON_NAME) {
    return 'light'; // dual-mode default; dark reachable via the toggle.
  }
  return NATIVE_DARK_THEMES.has(theme) ? 'dark' : 'light';
}

/**
 * Strip the dual-mode theme-toggle block (delimited by `theme-toggle:start` /
 * `theme-toggle:end` HTML comments) from a header/footer fragment. Used for the
 * single-appearance Bootswatch themes, which carry no toggle.
 */
export function stripToggle(html) {
  return html.replace(
    /[ \t]*<!-- theme-toggle:start[\s\S]*?theme-toggle:end -->\n?/g,
    '',
  );
}

/**
 * Rewrite the skeleton header for a theme: retarget asset paths to the theme's
 * tree, pin data-bs-theme to the theme's native scheme, and (for the single-mode
 * Bootswatch themes) strip the toggle button.
 */
export function renderHeader(skeletonHeader, theme) {
  let header = skeletonHeader.replaceAll(
    `.plandrop/${SKELETON_NAME}/`,
    `.plandrop/${theme}/`,
  );
  header = header.replace(
    /(<html[^>]*\sdata-bs-theme=")[^"]*(")/,
    `$1${nativeScheme(theme)}$2`,
  );
  if (theme !== SKELETON_NAME) {
    header = stripToggle(header);
  }
  return header;
}

/** Rewrite the skeleton footer for a theme: drop the toggle script for single-mode themes. */
export function renderFooter(skeletonFooter, theme) {
  return theme === SKELETON_NAME ? skeletonFooter : stripToggle(skeletonFooter);
}

/**
 * Produce a theme folder from the skeleton + the theme's compiled CSS.
 * Returns the theme name. Pure file IO so it is unit-testable over temp dirs.
 */
export function generateTheme(theme, { skeletonDir, bootswatchDir, outDir }) {
  const dest = join(outDir, theme);
  mkdirSync(join(dest, 'css'), { recursive: true });
  mkdirSync(join(dest, 'js'), { recursive: true });

  const header = renderHeader(readFileSync(join(skeletonDir, 'header.html'), 'utf8'), theme);
  writeFileSync(join(dest, 'header.html'), header);

  const footer = renderFooter(readFileSync(join(skeletonDir, 'footer.html'), 'utf8'), theme);
  writeFileSync(join(dest, 'footer.html'), footer);

  // plan.html carries no template-name paths and no toggle, so it copies as-is.
  cpSync(join(skeletonDir, 'plan.html'), join(dest, 'plan.html'));
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
