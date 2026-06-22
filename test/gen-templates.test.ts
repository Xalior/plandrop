import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootswatchThemes,
  generateAll,
  nativeScheme,
} from '../scripts/gen-templates.mjs';

/** Bootswatch themes we assert render in their native DARK scheme. */
const NATIVE_DARK = ['cyborg', 'darkly', 'slate', 'solar', 'superhero', 'vapor'];

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const skeletonDir = join(repoRoot, 'templates', 'bootstrap5');
const bootswatchDir = join(repoRoot, 'node_modules', 'bootswatch');

let outDir: string;

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), 'plandrop-gen-'));
});

afterEach(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe('template generator', () => {
  it('emits one folder per pinned Bootswatch theme', () => {
    const themes = generateAll({ skeletonDir, bootswatchDir, outDir });
    expect(themes.length).toBeGreaterThan(0);
    expect(themes).toEqual(bootswatchThemes(bootswatchDir));
    for (const theme of themes) {
      expect(existsSync(join(outDir, theme))).toBe(true);
    }
  });

  it('gives each theme the three-part skeleton + self-update JS + vendored CSS', () => {
    const themes = generateAll({ skeletonDir, bootswatchDir, outDir });
    expect(themes).toContain('darkly');
    for (const file of [
      'header.html',
      'plan.html',
      'footer.html',
      'js/selfupdate.js',
      'css/bootstrap.min.css',
    ]) {
      expect(existsSync(join(outDir, 'darkly', file))).toBe(true);
    }
  });

  it('ships no plandrop.css and links none from any header (retired)', () => {
    const themes = generateAll({ skeletonDir, bootswatchDir, outDir });
    for (const theme of themes) {
      expect(existsSync(join(outDir, theme, 'css', 'plandrop.css'))).toBe(false);
      const header = readFileSync(join(outDir, theme, 'header.html'), 'utf8');
      expect(header).not.toContain('plandrop.css');
    }
  });

  it('carries no data-plandrop-template marker (retired)', () => {
    const themes = generateAll({ skeletonDir, bootswatchDir, outDir });
    for (const theme of themes) {
      const header = readFileSync(join(outDir, theme, 'header.html'), 'utf8');
      expect(header).not.toContain('data-plandrop-template');
    }
  });

  it('pins each Bootswatch theme to its native data-bs-theme and drops the toggle', () => {
    const themes = generateAll({ skeletonDir, bootswatchDir, outDir });
    // The detected dark set must match the hardcoded list exactly.
    const detectedDark = themes.filter((t) => nativeScheme(t) === 'dark').sort();
    expect(detectedDark).toEqual([...NATIVE_DARK].sort());

    for (const theme of themes) {
      const header = readFileSync(join(outDir, theme, 'header.html'), 'utf8');
      const footer = readFileSync(join(outDir, theme, 'footer.html'), 'utf8');
      expect(header).toContain(`data-bs-theme="${nativeScheme(theme)}"`);
      // Single-mode Bootswatch themes carry no toggle button or script.
      expect(header).not.toContain('data-bs-theme-toggle');
      expect(header).not.toContain('theme-toggle:start');
      expect(footer).not.toContain('data-bs-theme-toggle');
      expect(footer).not.toContain('theme-toggle:start');
      // The brand link home survives on every theme.
      expect(header).toContain('<a class="navbar-brand mb-0 h1" href="/">');
    }
  });

  it('keeps the toggle (button + script) on the dual-mode bootstrap5 skeleton', () => {
    const header = readFileSync(join(skeletonDir, 'header.html'), 'utf8');
    const footer = readFileSync(join(skeletonDir, 'footer.html'), 'utf8');
    expect(header).toContain('data-bs-theme="light"');
    expect(header).toContain('data-bs-theme-toggle');
    expect(footer).toContain("getAttribute('data-bs-theme')");
    expect(nativeScheme('bootstrap5')).toBe('light');
  });

  it('rewrites the header asset paths to the concrete theme name', () => {
    generateAll({ skeletonDir, bootswatchDir, outDir });
    const header = readFileSync(join(outDir, 'darkly', 'header.html'), 'utf8');
    expect(header).toContain('.plandrop/darkly/css/bootstrap.min.css');
    expect(header).toContain('.plandrop/darkly/js/selfupdate.js');
    expect(header).not.toContain('.plandrop/bootstrap5/');
  });

  it('vendors a self-hosted CSS (no runtime CDN link) carrying the MIT banners', () => {
    generateAll({ skeletonDir, bootswatchDir, outDir });
    const css = readFileSync(join(outDir, 'darkly', 'css', 'bootstrap.min.css'), 'utf8');
    expect(css).toContain('Bootswatch');
    expect(css).toContain('Bootstrap');
    expect(css.length).toBeGreaterThan(10_000);
  });

  it('credits Bootswatch, Bootstrap and plandrop in every theme footer', () => {
    generateAll({ skeletonDir, bootswatchDir, outDir });
    for (const theme of readdirSync(outDir)) {
      const footer = readFileSync(join(outDir, theme, 'footer.html'), 'utf8');
      expect(footer).toContain('Bootswatch');
      expect(footer).toContain('Bootstrap');
      expect(footer).toContain('plandrop.dev');
    }
  });
});
