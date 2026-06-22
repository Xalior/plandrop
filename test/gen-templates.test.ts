import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootswatchThemes, generateAll } from '../scripts/gen-templates.mjs';

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
      'css/plandrop.css',
    ]) {
      expect(existsSync(join(outDir, 'darkly', file))).toBe(true);
    }
  });

  it('ships plandrop.css in every theme and links it after bootstrap in the header', () => {
    const themes = generateAll({ skeletonDir, bootswatchDir, outDir });
    for (const theme of themes) {
      expect(existsSync(join(outDir, theme, 'css', 'plandrop.css'))).toBe(true);
      const header = readFileSync(join(outDir, theme, 'header.html'), 'utf8');
      expect(header).toContain(`.plandrop/${theme}/css/plandrop.css`);
      // Loaded after Bootstrap so the overrides win.
      expect(header.indexOf('css/bootstrap.min.css')).toBeLessThan(
        header.indexOf('css/plandrop.css'),
      );
    }
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
