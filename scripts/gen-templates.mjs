// Generate the plandrop template folder set: one per Bootswatch theme, plus one
// per hand-authored theme under themes/.
//
// Each generated folder is the shared three-part skeleton (header.html /
// plan.html / footer.html) taken from the bootstrap5 template, with that theme's
// compiled, self-hosted CSS vendored in. The header references its CSS by the
// concrete theme name, so a doc built from a theme links into that theme's tree;
// the self-update JS is the one exception — shared and theme-neutral at
// .plandrop/shared/js/selfupdate.js, not copied per theme.
//
// Appearance policy — honour each theme's NATIVE mode:
//   * bootstrap5 (the skeleton) is the one genuinely dual-mode design — stock
//     Bootstrap's light AND dark are both well-built — so it keeps the navbar
//     light/dark toggle button and the paired footer toggle <script>, defaulting
//     to data-bs-theme="light".
//   * Every Bootswatch theme is a single-appearance design. Forcing a toggle on
//     them yields a long tail of contrast bugs, so they carry no toggle (button
//     + script) and pin data-bs-theme to the theme's own native scheme, letting
//     it render exactly as Bootswatch authored it. No contrast patches.
//   * A hand-authored theme declares its own appearances in theme.json and is
//     treated by that declaration: list both to get the toggle, one to be pinned.
//
// The Bootswatch package ships a self-contained dist/<theme>/bootstrap.min.css
// (Bootswatch overrides + full Bootstrap, both copyright banners retained), so
// no SCSS compilation is needed here — just copy it in. A hand-authored theme
// ships only its own layer, so its stylesheet is assembled here: the skeleton's
// stock Bootstrap with the theme's CSS appended, which is the same shape a
// Bootswatch dist file has — one request, cascade decided by source order.
//
// themes/ is source and templates/ is output, which is what keeps a hand-made
// theme safe: this script rewrites templates/ wholesale on every run and in
// every image build, so a theme authored there would be overwritten. See
// themes/README.md for the full convention.
//
// Alongside the themes, the run also vendors the shared document-enhancement
// libraries (mermaid, highlight.js) from their pinned npm packages into
// templates/shared/vendor/, served at .plandrop/shared/vendor/ and lazy-loaded
// by shared/js/enhance.js only when a document actually uses them.
//
// Usage:
//   node scripts/gen-templates.mjs [--skeleton DIR] [--bootswatch DIR]
//                                  [--custom DIR] [--out DIR]
// Defaults resolve to this repo's templates/bootstrap5, node_modules/bootswatch,
// themes/, and templates/ respectively.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

/** The template name baked into the skeleton header's asset paths. */
const SKELETON_NAME = 'bootstrap5';

/** Where the hand-authored themes are sourced from. */
const CUSTOM_DIR = join(repoRoot, 'themes');

/** The manifest that makes a folder under themes/ a theme. */
const SPEC_FILE = 'theme.json';

/** The hand-authored stylesheet layered over stock Bootstrap. */
const THEME_CSS = 'theme.css';

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

/** The hand-authored theme folders: those carrying a manifest, name-sorted. */
export function customThemes(customDir = CUSTOM_DIR) {
  if (!existsSync(customDir)) {
    return [];
  }
  return readdirSync(customDir)
    .filter(
      (name) =>
        statSync(join(customDir, name)).isDirectory() &&
        existsSync(join(customDir, name, SPEC_FILE)),
    )
    .sort((a, b) => a.localeCompare(b));
}

/**
 * A hand-authored theme's manifest. Validated here rather than trusted, so a
 * malformed theme fails the build instead of shipping a document whose chrome
 * silently contradicts the stylesheet.
 */
export function readThemeSpec(theme, customDir = CUSTOM_DIR) {
  const path = join(customDir, theme, SPEC_FILE);
  const spec = JSON.parse(readFileSync(path, 'utf8'));
  const appearance = spec.appearance;
  if (!Array.isArray(appearance) || appearance.length === 0) {
    throw new Error(`${path}: "appearance" must list at least one scheme`);
  }
  for (const scheme of appearance) {
    if (scheme !== 'light' && scheme !== 'dark') {
      throw new Error(`${path}: unknown appearance "${scheme}"`);
    }
  }
  const { credit } = spec;
  if (!credit || !credit.name || !credit.url || !credit.license) {
    throw new Error(`${path}: "credit" needs a name, url and license`);
  }
  return spec;
}

/**
 * How a theme presents: the scheme its documents open in, and whether it offers
 * the light/dark toggle. A hand-authored theme is taken at its manifest's word;
 * the built-ins follow the appearance policy above.
 */
function appearanceOf(theme, spec) {
  if (spec) {
    return { scheme: spec.appearance[0], dual: spec.appearance.length > 1 };
  }
  return { scheme: nativeScheme(theme), dual: theme === SKELETON_NAME };
}

/**
 * Strip the dual-mode theme toggle from a header/footer fragment: the navbar
 * <button> carrying the data-bs-theme-toggle attribute, and the footer
 * <script> that drives it (recognised by referencing that same attribute).
 * Used for the single-appearance Bootswatch themes, which carry no toggle.
 */
export function stripToggle(html) {
  return html
    .replace(/[ \t]*<button[^>]*\bdata-bs-theme-toggle\b[\s\S]*?<\/button>\n?/g, '')
    .replace(
      /[ \t]*<script>(?:(?!<\/script>)[\s\S])*?data-bs-theme-toggle[\s\S]*?<\/script>\n?/g,
      '',
    );
}

/**
 * Rewrite the skeleton header for a theme: retarget asset paths to the theme's
 * tree, pin data-bs-theme to the scheme it opens in, and (for a single-appearance
 * theme) strip the toggle button.
 *
 * Asset links stay CONCRETE (the theme's own name, never `default`) so changing
 * the configured default theme later never breaks an existing document; the
 * `.plandrop/shared/…` paths are theme-neutral and are deliberately left alone.
 */
export function renderHeader(skeletonHeader, theme, spec) {
  const { scheme, dual } = appearanceOf(theme, spec);
  let header = skeletonHeader.replaceAll(
    `.plandrop/${SKELETON_NAME}/`,
    `.plandrop/${theme}/`,
  );
  // The concrete theme name on <html>, as a styling hook for the shared
  // cross-theme overrides (shared/css/plandrop.css) — data-bs-theme alone can't
  // distinguish a theme like quartz whose "light" scheme is a saturated surface.
  header = header.replace(
    `data-plandrop-theme="${SKELETON_NAME}"`,
    `data-plandrop-theme="${theme}"`,
  );
  header = header.replace(/(<html[^>]*\sdata-bs-theme=")[^"]*(")/, `$1${scheme}$2`);
  if (!dual) {
    header = stripToggle(header);
    // Pin data-bs-theme on the navbar too, not just <html>. Bootswatch gates its
    // dark-navbar colours on the attribute selector `.navbar[data-bs-theme=dark]`,
    // which needs the attribute ON the navbar — inheriting it from <html> doesn't
    // match (e.g. darkly's brand otherwise falls back to #222, dark-on-dark). A
    // dual-appearance theme is left inheriting so its light/dark toggle still
    // flips the navbar with the rest of the page.
    header = header.replace(/(<nav class="navbar[^"]*")/, `$1 data-bs-theme="${scheme}"`);
  }
  return header;
}

/**
 * Rewrite the skeleton footer for a theme: drop the toggle script for
 * single-appearance themes, and credit the theme's own author when it has one.
 * The skeleton's toggle listener is delegated on the document (not bound to the
 * button) so it survives the self-update <body> swap; the chosen theme lives on
 * <html>, which the swap never touches.
 */
export function renderFooter(skeletonFooter, theme, spec) {
  const { dual } = appearanceOf(theme, spec);
  const footer = dual ? skeletonFooter : stripToggle(skeletonFooter);
  return spec ? renderCredit(footer, spec) : footer;
}

/**
 * Swap the footer's theme-credit span for a hand-authored theme's own credit, so
 * a published document names the people whose theme it is actually wearing. The
 * skeleton's default credit (Bootswatch) is what every generated Bootswatch
 * theme keeps.
 */
export function renderCredit(footer, spec) {
  const { name, url, license } = spec.credit;
  const label = spec.label ?? name;
  return footer.replace(
    /(<span data-plandrop-credit>)[\s\S]*?(<\/span>)/,
    `$1The <a href="${url}" class="link-body-emphasis">${label}</a> theme by ${name} (${license})$2`,
  );
}

/**
 * Produce a theme folder from the skeleton + the theme's compiled CSS.
 * Returns the theme name. Pure file IO so it is unit-testable over temp dirs.
 */
export function generateTheme(theme, { skeletonDir, bootswatchDir, outDir }) {
  const dest = writeSkeleton(theme, { skeletonDir, outDir });

  // The theme's self-contained compiled CSS.
  cpSync(
    join(bootswatchDir, 'dist', theme, 'bootstrap.min.css'),
    join(dest, 'css', 'bootstrap.min.css'),
  );
  return theme;
}

/**
 * Produce a hand-authored theme's folder: the same skeleton chrome, rendered to
 * its manifest, over a stylesheet assembled from the skeleton's stock Bootstrap
 * plus the theme's own layer. The theme vendors Bootstrap that way, so it
 * carries the skeleton's NOTICE with it.
 */
export function generateCustomTheme(theme, { skeletonDir, customDir = CUSTOM_DIR, outDir }) {
  const spec = readThemeSpec(theme, customDir);
  const dest = writeSkeleton(theme, { skeletonDir, outDir, spec });

  const bootstrap = readFileSync(join(skeletonDir, 'css', 'bootstrap.min.css'), 'utf8');
  const layer = readFileSync(join(customDir, theme, THEME_CSS), 'utf8');
  writeFileSync(join(dest, 'css', 'bootstrap.min.css'), `${bootstrap}\n${layer}`);
  cpSync(join(skeletonDir, 'NOTICE'), join(dest, 'NOTICE'));
  return theme;
}

/** The chrome every theme folder shares: the three rendered skeleton parts. */
function writeSkeleton(theme, { skeletonDir, outDir, spec }) {
  const dest = join(outDir, theme);
  mkdirSync(join(dest, 'css'), { recursive: true });

  const header = renderHeader(readFileSync(join(skeletonDir, 'header.html'), 'utf8'), theme, spec);
  writeFileSync(join(dest, 'header.html'), header);

  const footer = renderFooter(readFileSync(join(skeletonDir, 'footer.html'), 'utf8'), theme, spec);
  writeFileSync(join(dest, 'footer.html'), footer);

  // plan.html carries no template-name paths and no toggle, so it copies as-is.
  // No per-theme js/: selfupdate.js is shared and theme-neutral, seeded once to
  // .plandrop/shared/js/ (the header references that bare path, not a per-theme one).
  cpSync(join(skeletonDir, 'plan.html'), join(dest, 'plan.html'));
  return dest;
}

/**
 * The shared vendor assets: browser bundles copied verbatim (licenses included)
 * from the pinned npm packages into shared/vendor/, served at
 * .plandrop/shared/vendor/. enhance.js lazy-loads them, so a document that uses
 * no diagrams or code blocks never fetches them.
 */
const VENDOR_ASSETS = [
  ['mermaid/dist/mermaid.min.js', 'mermaid/mermaid.min.js'],
  ['mermaid/LICENSE', 'mermaid/LICENSE'],
  ['@highlightjs/cdn-assets/highlight.min.js', 'highlight/highlight.min.js'],
  ['@highlightjs/cdn-assets/styles/github.min.css', 'highlight/styles/github.min.css'],
  ['@highlightjs/cdn-assets/styles/github-dark.min.css', 'highlight/styles/github-dark.min.css'],
  ['@highlightjs/cdn-assets/LICENSE', 'highlight/LICENSE'],
];

export function vendorSharedAssets({ modulesDir, outDir }) {
  for (const [from, to] of VENDOR_ASSETS) {
    const dest = join(outDir, 'shared', 'vendor', to);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(modulesDir, from), dest);
  }
}

/** Every theme name shipped by the Bootswatch dist (each dist subdir is a theme). */
export function bootswatchThemes(bootswatchDir) {
  const dist = join(bootswatchDir, 'dist');
  return readdirSync(dist)
    .filter((name) => statSync(join(dist, name)).isDirectory())
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Generate every theme folder — Bootswatch and hand-authored alike — and return
 * their names. The two sources are generated in one pass so a regeneration can
 * neither clobber nor omit a hand-authored theme: it is rebuilt from themes/
 * exactly like a Bootswatch theme is rebuilt from the pinned package.
 */
export function generateAll({ skeletonDir, bootswatchDir, customDir = CUSTOM_DIR, outDir }) {
  const bootswatch = bootswatchThemes(bootswatchDir);
  for (const theme of bootswatch) {
    generateTheme(theme, { skeletonDir, bootswatchDir, outDir });
  }
  const custom = customThemes(customDir);
  for (const theme of custom) {
    generateCustomTheme(theme, { skeletonDir, customDir, outDir });
  }
  return [...bootswatch, ...custom].sort((a, b) => a.localeCompare(b));
}

function parseArgs(argv) {
  const opts = {
    skeletonDir: join(repoRoot, 'templates', SKELETON_NAME),
    bootswatchDir: join(repoRoot, 'node_modules', 'bootswatch'),
    customDir: CUSTOM_DIR,
    outDir: join(repoRoot, 'templates'),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--skeleton') {
      opts.skeletonDir = argv[++i];
    } else if (arg === '--bootswatch') {
      opts.bootswatchDir = argv[++i];
    } else if (arg === '--custom') {
      opts.customDir = argv[++i];
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
  vendorSharedAssets({ modulesDir: join(repoRoot, 'node_modules'), outDir: opts.outDir });
  process.stdout.write(
    `generated ${themes.length} theme(s) + shared vendor assets into ${opts.outDir}\n`,
  );
}
