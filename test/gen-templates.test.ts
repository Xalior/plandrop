import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootswatchThemes,
  customThemes,
  generateAll,
  generateCustomTheme,
  joinStylesheet,
  nativeScheme,
  readThemeSpec,
  vendorSharedAssets,
} from '../scripts/gen-templates.mjs';

/** Bootswatch themes we assert render in their native DARK scheme. */
const NATIVE_DARK = ['cyborg', 'darkly', 'slate', 'solar', 'superhero', 'vapor'];

/** The hand-authored themes shipped under themes/. */
const CUSTOM = ['d3code', 'f1terminal', 'f2terminal', 'f3terminal', 'f4terminal', 'r1pcb', 'r3pcb', 'r4pcb', 's1notebook'];

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const skeletonDir = join(repoRoot, 'templates', 'bootstrap5');
const sharedJsDir = join(repoRoot, 'templates', 'shared', 'js');
const bootswatchDir = join(repoRoot, 'node_modules', 'bootswatch');
const customDir = join(repoRoot, 'themes');

let outDir: string;

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), 'plandrop-gen-'));
});

afterEach(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe('template generator', () => {
  it('emits one folder per pinned Bootswatch theme and per hand-authored theme', () => {
    const themes = generateAll({ skeletonDir, bootswatchDir, customDir, outDir });
    expect(themes.length).toBeGreaterThan(0);
    expect(themes).toEqual(
      [...bootswatchThemes(bootswatchDir), ...customThemes(customDir)].sort((a, b) =>
        a.localeCompare(b),
      ),
    );
    for (const theme of themes) {
      expect(existsSync(join(outDir, theme))).toBe(true);
    }
  });

  it('gives each theme the three-part skeleton + vendored CSS, but no per-theme JS', () => {
    const themes = generateAll({ skeletonDir, bootswatchDir, outDir });
    expect(themes).toContain('darkly');
    for (const file of [
      'header.html',
      'plan.html',
      'footer.html',
      'css/bootstrap.min.css',
    ]) {
      expect(existsSync(join(outDir, 'darkly', file))).toBe(true);
    }
    // self-update is shared (.plandrop/shared/js/), never copied per theme.
    expect(existsSync(join(outDir, 'darkly', 'js', 'selfupdate.js'))).toBe(false);
    expect(existsSync(join(outDir, 'darkly', 'js'))).toBe(false);
  });

  it('pins each Bootswatch theme to its native data-bs-theme and drops the toggle', () => {
    generateAll({ skeletonDir, bootswatchDir, customDir, outDir });
    const themes = bootswatchThemes(bootswatchDir);
    // The detected dark set must match the hardcoded list exactly.
    const detectedDark = themes.filter((t) => nativeScheme(t) === 'dark').sort();
    expect(detectedDark).toEqual([...NATIVE_DARK].sort());

    for (const theme of themes) {
      const header = readFileSync(join(outDir, theme, 'header.html'), 'utf8');
      const footer = readFileSync(join(outDir, theme, 'footer.html'), 'utf8');
      expect(header).toContain(`data-bs-theme="${nativeScheme(theme)}"`);
      // Single-mode Bootswatch themes carry no toggle button or script — the
      // stripped footer holds no script at all, and the header no button.
      expect(header).not.toContain('data-bs-theme-toggle');
      expect(header).not.toContain('<button');
      expect(footer).not.toContain('data-bs-theme-toggle');
      expect(footer).not.toContain('<script');
      // The brand link home survives on every theme.
      expect(header).toContain('<a class="navbar-brand mb-0 h1" href="/">');
      // The navbar itself carries data-bs-theme too — Bootswatch gates its
      // dark-navbar colours on `.navbar[data-bs-theme=dark]`, which only matches
      // when the attribute is on the navbar, not merely inherited from <html>.
      expect(header).toContain(
        `<nav class="navbar navbar-expand-lg bg-body-tertiary border-bottom" data-bs-theme="${nativeScheme(theme)}"`,
      );
    }
  });

  it('keeps the toggle (button + script tag) on the dual-mode bootstrap5 skeleton', () => {
    const header = readFileSync(join(skeletonDir, 'header.html'), 'utf8');
    expect(header).toContain('data-bs-theme="light"');
    expect(header).toContain('data-bs-theme-toggle');
    expect(nativeScheme('bootstrap5')).toBe('light');
    // The skeleton navbar is NOT pinned — it inherits data-bs-theme from <html>
    // so the toggle flips the navbar along with the page.
    expect(header).toContain(
      '<nav class="navbar navbar-expand-lg bg-body-tertiary border-bottom">',
    );
    // Asset refs are root-absolute so a document published at any subpath
    // resolves them against the host root, not its own location.
    expect(header).toContain('href="/.plandrop/bootstrap5/css/bootstrap.min.css"');
    expect(header).toContain('href="/.plandrop/shared/css/plandrop.css"');
    expect(header).toContain('src="/.plandrop/shared/js/selfupdate.js"');
    expect(header).toContain('src="/.plandrop/shared/js/enhance.js"');
    expect(header).not.toMatch(/href="\.plandrop/);
    expect(header).not.toMatch(/src="\.plandrop/);
  });

  it('carries the toggle behaviour as one shared file, not a copy per theme', () => {
    // The behaviour is theme-neutral: the storage key is read from the
    // document at run time. Inlining it would put an identical copy in every
    // dual-mode template, so a change would mean editing and re-checking each
    // one, and a reader opening two themes would download it twice.
    const header = readFileSync(join(skeletonDir, 'header.html'), 'utf8');
    const footer = readFileSync(join(skeletonDir, 'footer.html'), 'utf8');
    expect(header).toContain('src="/.plandrop/shared/js/theme.js"');
    expect(header).not.toMatch(/<script[^>]*data-bs-theme-toggle[^>]*>\s*\(function/);
    expect(footer).not.toContain('<script');
  });

  it('loads the toggle script render-blocking in <head>, ahead of paint', () => {
    const header = readFileSync(join(skeletonDir, 'header.html'), 'utf8');
    const headEnd = header.indexOf('</head>');
    const scriptStart = header.indexOf('<script data-bs-theme-toggle');
    expect(scriptStart).toBeGreaterThan(-1);
    expect(scriptStart).toBeLessThan(headEnd);
    // A deferred or async script runs after the parser reaches <body>, which
    // is exactly the flash the stored mode has to be applied ahead of.
    expect(header).not.toMatch(/<script[^>]*\bdata-bs-theme-toggle\b[^>]*\b(?:defer|async)\b/);
  });

  it('cycles light -> dark -> system and keeps the system scheme live via matchMedia', () => {
    const script = readFileSync(join(sharedJsDir, 'theme.js'), 'utf8');
    expect(script).toContain("['light', 'dark', 'system']");
    // "system" is resolved from the OS preference on load...
    expect(script).toContain("window.matchMedia('(prefers-color-scheme: dark)')");
    // ...and tracked for as long as the page stays open, rather than read
    // once: a "change" listener, not a one-off check.
    expect(script).toContain("media.addEventListener('change', applyScheme)");
  });

  it('keys the stored preference to the document\'s own theme, and tolerates no storage', () => {
    const script = readFileSync(join(sharedJsDir, 'theme.js'), 'utf8');
    // One shared file serves every theme because the key is built at run time
    // from data-plandrop-theme, which the generator rewrites to the concrete
    // theme name — so each theme reads and writes its own key.
    expect(script).toContain("'plandrop:mode:' + root.getAttribute('data-plandrop-theme')");
    // A throwing localStorage (private browsing, blocked cookies, …) must not
    // break the toggle — reading and writing are both guarded.
    expect(script).toMatch(/try\s*{\s*return window\.localStorage\.getItem\(/);
    expect(script).toMatch(/try\s*{\s*window\.localStorage\.setItem\(/);
  });

  it('reflects the active mode on the toggle button, accessibly', () => {
    const header = readFileSync(join(skeletonDir, 'header.html'), 'utf8');
    const script = readFileSync(join(sharedJsDir, 'theme.js'), 'utf8');
    // A screen reader gets the state from the button's own accessible name...
    expect(header).toContain('aria-label="Toggle colour scheme, currently light"');
    expect(script).toContain("setAttribute('aria-label', 'Toggle colour scheme, currently ' + mode)");
    // ...and a sighted reader gets it from the visible label, kept in sync on
    // every click.
    expect(header).toContain('data-bs-theme-toggle-label');
    expect(script).toContain('data-bs-theme-toggle-label');
  });

  it('finds the toggle button by tag, not by the marker alone', () => {
    // The script tag carries the same marker so the generator can strip both
    // it and the button in one pass, and it precedes the button in the
    // document. A lookup on the bare marker resolves to that <script>: the
    // colours still change on a click, but the label is written into an
    // element with no text, so it never moves off its starting value.
    const script = readFileSync(join(sharedJsDir, 'theme.js'), 'utf8');
    expect(script).toContain("querySelector('button[data-bs-theme-toggle]')");
    expect(script).not.toContain("querySelector('[data-bs-theme-toggle]')");
  });

  it('rewrites the CSS path to the concrete theme name, leaves shared assets neutral', () => {
    generateAll({ skeletonDir, bootswatchDir, outDir });
    const header = readFileSync(join(outDir, 'darkly', 'header.html'), 'utf8');
    expect(header).toContain('.plandrop/darkly/css/bootstrap.min.css');
    expect(header).not.toContain('.plandrop/bootstrap5/');
    // self-update and the cross-theme override CSS stay at the shared,
    // theme-neutral paths — not retargeted.
    expect(header).toContain('.plandrop/shared/js/selfupdate.js');
    expect(header).toContain('.plandrop/shared/css/plandrop.css');
    expect(header).not.toContain('.plandrop/darkly/js/');
    // <html> carries the concrete theme name — the shared override CSS keys
    // per-theme exceptions (e.g. quartz) on this attribute.
    expect(header).toContain('data-plandrop-theme="darkly"');
    expect(header).not.toContain('data-plandrop-theme="bootstrap5"');
    // The retarget preserves the root-absolute form: the theme CSS and the
    // shared refs both stay rooted at /.plandrop/, never document-relative.
    expect(header).toContain('href="/.plandrop/darkly/css/bootstrap.min.css"');
    expect(header).toContain('href="/.plandrop/shared/css/plandrop.css"');
    expect(header).toContain('src="/.plandrop/shared/js/selfupdate.js"');
  });

  it('vendors the shared enhancement bundles with their licenses', () => {
    vendorSharedAssets({ modulesDir: join(repoRoot, 'node_modules'), outDir });
    for (const file of [
      'mermaid/mermaid.min.js',
      'mermaid/LICENSE',
      'highlight/highlight.min.js',
      'highlight/styles/github.min.css',
      'highlight/styles/github-dark.min.css',
      'highlight/LICENSE',
    ]) {
      expect(existsSync(join(outDir, 'shared', 'vendor', file))).toBe(true);
    }
  });

  it('links the cross-theme override CSS after the theme CSS so it wins by source order', () => {
    generateAll({ skeletonDir, bootswatchDir, outDir });
    const header = readFileSync(join(outDir, 'darkly', 'header.html'), 'utf8');
    expect(header.indexOf('.plandrop/shared/css/plandrop.css')).toBeGreaterThan(
      header.indexOf('.plandrop/darkly/css/bootstrap.min.css'),
    );
  });

  it('vendors a self-hosted CSS (no runtime CDN link) carrying the MIT banners', () => {
    generateAll({ skeletonDir, bootswatchDir, outDir });
    const css = readFileSync(join(outDir, 'darkly', 'css', 'bootstrap.min.css'), 'utf8');
    expect(css).toContain('Bootswatch');
    expect(css).toContain('Bootstrap');
    expect(css.length).toBeGreaterThan(10_000);
  });

  it('credits Bootswatch, Bootstrap and plandrop in every Bootswatch theme footer', () => {
    generateAll({ skeletonDir, bootswatchDir, customDir, outDir });
    for (const theme of bootswatchThemes(bootswatchDir)) {
      const footer = readFileSync(join(outDir, theme, 'footer.html'), 'utf8');
      expect(footer).toContain('Bootswatch');
      expect(footer).toContain('Bootstrap');
      expect(footer).toContain('plandrop.dev');
    }
  });

  it('credits Bootstrap and plandrop in every generated footer', () => {
    generateAll({ skeletonDir, bootswatchDir, customDir, outDir });
    for (const theme of readdirSync(outDir)) {
      const footer = readFileSync(join(outDir, theme, 'footer.html'), 'utf8');
      expect(footer).toContain('Bootstrap');
      expect(footer).toContain('plandrop.dev');
    }
  });

  it('gives every generated theme root-absolute asset refs, never document-relative', () => {
    generateAll({ skeletonDir, bootswatchDir, customDir, outDir });
    for (const theme of readdirSync(outDir)) {
      const header = readFileSync(join(outDir, theme, 'header.html'), 'utf8');
      const hrefs = [...header.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1] ?? '');
      const plandropRefs = hrefs.filter((href) => href.includes('.plandrop/'));
      expect(plandropRefs.length).toBeGreaterThan(0);
      for (const href of plandropRefs) {
        // A document published at any subpath must resolve these against the
        // host root, not its own location — root-absolute, not relative.
        expect(href.startsWith('/.plandrop/')).toBe(true);
      }
    }
  });
});

// A hand-authored theme is generated from themes/<name>/ on every run, exactly
// as a Bootswatch theme is generated from the pinned package — which is what
// makes regeneration reproduce it rather than clobber or omit it.
describe('hand-authored themes', () => {
  it('ships the expected set, each with a manifest and a stylesheet', () => {
    expect(customThemes(customDir)).toEqual(CUSTOM);
    for (const theme of CUSTOM) {
      expect(existsSync(join(customDir, theme, 'theme.json'))).toBe(true);
      expect(existsSync(join(customDir, theme, 'theme.css'))).toBe(true);
    }
  });

  it('survives a full regeneration alongside the Bootswatch set', () => {
    generateAll({ skeletonDir, bootswatchDir, customDir, outDir });
    const first = readFileSync(join(outDir, 'f1terminal', 'css', 'bootstrap.min.css'), 'utf8');
    generateAll({ skeletonDir, bootswatchDir, customDir, outDir });
    const second = readFileSync(join(outDir, 'f1terminal', 'css', 'bootstrap.min.css'), 'utf8');
    expect(second).toBe(first);
    expect(existsSync(join(outDir, 'f1terminal', 'header.html'))).toBe(true);
  });

  it('gives f1terminal the skeleton chrome over Bootstrap plus its own layer', () => {
    generateAll({ skeletonDir, bootswatchDir, customDir, outDir });
    for (const file of ['header.html', 'plan.html', 'footer.html', 'css/bootstrap.min.css']) {
      expect(existsSync(join(outDir, 'f1terminal', file))).toBe(true);
    }
    const css = readFileSync(join(outDir, 'f1terminal', 'css', 'bootstrap.min.css'), 'utf8');
    // Stock Bootstrap first, the theme's own layer after it, so source order
    // alone decides the cascade.
    expect(css).toContain('Bootstrap  v5');
    expect(css).toContain('plandrop terminal theme');
    expect(css.indexOf('plandrop terminal theme')).toBeGreaterThan(css.indexOf('Bootstrap  v5'));
    // It vendors Bootstrap, so it carries the attribution.
    expect(readFileSync(join(outDir, 'f1terminal', 'NOTICE'), 'utf8')).toContain('Bootstrap');
  });

  it('keeps the toggle on a dual-appearance theme and opens in its first scheme', () => {
    generateAll({ skeletonDir, bootswatchDir, customDir, outDir });
    const header = readFileSync(join(outDir, 'f1terminal', 'header.html'), 'utf8');
    const spec = readThemeSpec('f1terminal', customDir);
    expect(spec.appearance).toEqual(['dark', 'light']);
    expect(header).toContain(`data-bs-theme="${spec.appearance[0]}"`);
    expect(header).toContain('src="/.plandrop/shared/js/theme.js"');
    // The navbar is NOT pinned: it inherits from <html> so the toggle flips the
    // chrome along with the page.
    expect(header).toContain('<nav class="navbar navbar-expand-lg bg-body-tertiary border-bottom">');
    // Assets are retargeted at the theme's own tree; the shared ones are not.
    expect(header).toContain('.plandrop/f1terminal/css/bootstrap.min.css');
    expect(header).toContain('data-plandrop-theme="f1terminal"');
    expect(header).toContain('.plandrop/shared/css/plandrop.css');
    expect(header).not.toContain('.plandrop/bootstrap5/');
    // Root-absolute, same as every Bootswatch theme: a hand-authored theme is
    // rendered through the same skeleton, so it gets the same asset-path form.
    expect(header).toContain('href="/.plandrop/f1terminal/css/bootstrap.min.css"');
    expect(header).toContain('href="/.plandrop/shared/css/plandrop.css"');
    expect(header).toContain('src="/.plandrop/shared/js/selfupdate.js"');
    expect(header).not.toMatch(/href="\.plandrop/);
    expect(header).not.toMatch(/src="\.plandrop/);
  });

  it('gives every dual-mode theme its own storage key, never a shared one', () => {
    generateAll({ skeletonDir, bootswatchDir, customDir, outDir });
    // Every dual-mode theme loads the same file. What keys the stored
    // preference to a theme is data-plandrop-theme, which the generator sets
    // to the concrete name and the script reads at run time — so bootstrap5
    // and f1terminal read and write two different localStorage keys while
    // running one shared copy of the code.
    const bootstrap5Header = readFileSync(join(skeletonDir, 'header.html'), 'utf8');
    const f1terminalHeader = readFileSync(join(outDir, 'f1terminal', 'header.html'), 'utf8');
    expect(bootstrap5Header).toContain('data-plandrop-theme="bootstrap5"');
    expect(f1terminalHeader).toContain('data-plandrop-theme="f1terminal"');
    for (const header of [bootstrap5Header, f1terminalHeader]) {
      expect(header).toContain('src="/.plandrop/shared/js/theme.js"');
    }
    const script = readFileSync(join(sharedJsDir, 'theme.js'), 'utf8');
    expect(script).toContain("'plandrop:mode:' + root.getAttribute('data-plandrop-theme')");
  });

  it('strips the toggle from a single-appearance hand-authored theme, cleanly', () => {
    generateAll({ skeletonDir, bootswatchDir, customDir, outDir });
    const spec = readThemeSpec('s1notebook', customDir);
    expect(spec.appearance).toEqual(['light']);
    const header = readFileSync(join(outDir, 's1notebook', 'header.html'), 'utf8');
    const footer = readFileSync(join(outDir, 's1notebook', 'footer.html'), 'utf8');
    expect(header).not.toContain('<button');
    expect(header).not.toContain('data-bs-theme-toggle');
    expect(header).not.toContain('data-bs-theme-mode');
    expect(footer).not.toContain('<script');
    expect(footer).not.toContain('data-bs-theme-toggle');
  });

  it('credits the theme author in place of the Bootswatch attribution', () => {
    generateAll({ skeletonDir, bootswatchDir, customDir, outDir });
    const footer = readFileSync(join(outDir, 'f1terminal', 'footer.html'), 'utf8');
    const { credit, label } = readThemeSpec('f1terminal', customDir);
    expect(footer).toContain(label);
    expect(footer).toContain(credit.name);
    expect(footer).toContain(credit.license);
    expect(footer).not.toContain('Bootswatch');
    // Bootstrap is still vendored, so it is still credited.
    expect(footer).toContain('Bootstrap');
  });

  it('declares both appearances in full, so neither leaks into the other', () => {
    // :root matches whichever scheme is live: a custom property set only in the
    // light block would survive into dark. The two appearance blocks must
    // therefore declare exactly the same variable names.
    const css = readFileSync(join(customDir, 'f1terminal', 'theme.css'), 'utf8');
    const light = varsOfBlock(css, ':root,\n[data-bs-theme="light"]');
    expect(light.length).toBeGreaterThan(40);
    expect(light).toEqual(varsOfBlock(css, '[data-bs-theme="dark"]'));
  });

  it('leaves the shared calm-green inline-code override alone', () => {
    // The shared sheet loads after every theme and owns --bs-code-color; a theme
    // setting it would be overridden anyway, and silently.
    const css = readFileSync(join(customDir, 'f1terminal', 'theme.css'), 'utf8');
    expect(css).not.toMatch(/^\s*--bs-code-color:/m);
  });

  it('gives its animated flourish a still fallback', () => {
    const css = readFileSync(join(customDir, 'f1terminal', 'theme.css'), 'utf8');
    expect(css).toContain('@keyframes pd-cursor-blink');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});

// A theme folder is not limited to its manifest and its stylesheet: whatever
// else it carries reaches the generated template, so a theme can ship a font or
// an image its CSS refers to.
describe('theme assets', () => {
  it("copies a theme folder's extra files into the generated template", () => {
    const src = mkdtempSync(join(tmpdir(), 'plandrop-theme-'));
    try {
      mkdirSync(join(src, 'assetty', 'fonts'), { recursive: true });
      mkdirSync(join(src, 'assetty', 'img'), { recursive: true });
      writeFileSync(
        join(src, 'assetty', 'theme.json'),
        JSON.stringify({
          label: 'Assetty',
          appearance: ['light'],
          credit: { name: 'plandrop', url: 'https://plandrop.dev/', license: 'LGPL-3.0-only' },
        }),
      );
      writeFileSync(join(src, 'assetty', 'theme.css'), 'body { color: red }\n');
      writeFileSync(join(src, 'assetty', 'fonts', 'sample.woff2'), 'not-really-a-font');
      writeFileSync(join(src, 'assetty', 'img', 'x.svg'), '<svg/>');

      generateCustomTheme('assetty', { skeletonDir, customDir: src, outDir });

      // The assets arrive at the template root, keeping their layout, so the
      // stylesheet (served from css/) reaches them as ../fonts/ and ../img/.
      expect(readFileSync(join(outDir, 'assetty', 'fonts', 'sample.woff2'), 'utf8')).toBe(
        'not-really-a-font',
      );
      expect(existsSync(join(outDir, 'assetty', 'img', 'x.svg'))).toBe(true);
      // The generator's own inputs are consumed, not republished.
      expect(existsSync(join(outDir, 'assetty', 'theme.json'))).toBe(false);
      expect(existsSync(join(outDir, 'assetty', 'theme.css'))).toBe(false);
    } finally {
      rmSync(src, { recursive: true, force: true });
    }
  });

  it("lifts a theme's @import above Bootstrap, where CSS honours it", () => {
    // Left in place, an @import ~100KB into the sheet is discarded by every
    // browser: no request, no error. Hoisting is what makes it load at all.
    const joined = joinStylesheet('.a { color: red }\n', '@import url("x.css");\n.b { color: blue }\n');
    expect(joined.indexOf('@import')).toBeLessThan(joined.indexOf('.a'));
    expect(joined.indexOf('.a')).toBeLessThan(joined.indexOf('.b'));
    // The rule is moved, not copied.
    expect(joined.match(/@import/g)).toHaveLength(1);
  });

  it('leaves a layer without @import in its original order', () => {
    const joined = joinStylesheet('.a { color: red }', '.b { color: blue }');
    expect(joined).toBe('.a { color: red }\n.b { color: blue }');
  });
});

/** The custom-property names declared by the rule with the given selector. */
function varsOfBlock(css: string, selector: string): string[] {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) {
    throw new Error(`no rule found for selector ${selector}`);
  }
  const body = css.slice(start, css.indexOf('}', start));
  return [...body.matchAll(/^\s*(--[\w-]+):/gm)].map((match) => match[1] as string).sort();
}
