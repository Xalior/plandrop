import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildTemplatesResponse,
  countLocalAssetRefs,
  DEFAULT_TEMPLATE,
  qualifyAssetUrls,
} from '../src/templates';

describe('buildTemplatesResponse', () => {
  it('reports the default and a sorted template list', () => {
    const res = buildTemplatesResponse(['zephyr', 'bootstrap5', 'cerulean']);
    expect(res.default).toBe(DEFAULT_TEMPLATE);
    expect(res.templates).toEqual(['bootstrap5', 'cerulean', 'zephyr']);
  });

  it('handles an empty theme volume', () => {
    expect(buildTemplatesResponse([])).toEqual({
      default: DEFAULT_TEMPLATE,
      templates: [],
      version: __PLANDROP_VERSION__,
    });
  });

  it('honours an explicit default override', () => {
    const res = buildTemplatesResponse(['bootstrap5', 'darkly'], 'darkly');
    expect(res.default).toBe('darkly');
  });

  // Matches public/package.json's "version": tsup's `define` bakes the same
  // literal into the built bundle (mirrored for tests by vitest's own
  // `define`, see vitest.config.ts) — no route reads package.json at runtime.
  it("reports the control plane's own version, matching package.json", () => {
    expect(buildTemplatesResponse(['bootstrap5']).version).toBe(__PLANDROP_VERSION__);
  });
});

// The seeder assembles template.html = header.html + plan.html + footer.html.
// These assert the content contract that concatenation relies on, so the
// assembled starter is a single valid document with concrete asset links.
// A scaffolded document has to render before it is published, so the server it
// came from is named outright in its asset links rather than left root-absolute.
describe('qualifyAssetUrls', () => {
  it('names the server in every root-absolute asset link', () => {
    const header =
      '<link rel="stylesheet" href="/.plandrop/darkly/css/bootstrap.min.css">' +
      '<link rel="stylesheet" href="/.plandrop/shared/css/plandrop.css">' +
      '<script defer src="/.plandrop/shared/js/selfupdate.js"></script>';
    expect(qualifyAssetUrls(header, 'https://plandrop.example')).toBe(
      '<link rel="stylesheet" href="https://plandrop.example/.plandrop/darkly/css/bootstrap.min.css">' +
        '<link rel="stylesheet" href="https://plandrop.example/.plandrop/shared/css/plandrop.css">' +
        '<script defer src="https://plandrop.example/.plandrop/shared/js/selfupdate.js"></script>',
    );
  });

  it('keeps a non-default port and scheme, for a local server', () => {
    expect(
      qualifyAssetUrls('<link href="/.plandrop/solar/css/bootstrap.min.css">', 'http://localhost:8083'),
    ).toBe('<link href="http://localhost:8083/.plandrop/solar/css/bootstrap.min.css">');
  });

  it('leaves an already-qualified link alone, so a static host is a no-op', () => {
    const static5 = '<link href="https://plandrop.dev/.plandrop/bootstrap5/css/bootstrap.min.css">';
    expect(qualifyAssetUrls(static5, 'https://plandrop.dev')).toBe(static5);
  });

  // The authoring comment and any code sample are prose, not markup to rewrite.
  it('leaves a mentioned path that is not an attribute value alone', () => {
    const prose = '<!-- assets answer at /.plandrop/shared/ -->\n<code>/.plandrop/x</code>';
    expect(qualifyAssetUrls(prose, 'https://plandrop.example')).toBe(prose);
  });

  it('leaves a document-relative link alone', () => {
    const rel = '<a href="plans/x.html">plan</a><a href="../index.html">up</a>';
    expect(qualifyAssetUrls(rel, 'https://plandrop.example')).toBe(rel);
  });

  // An origin-less asset link resolves only on the host it was published to.
  // Every shape one can take is qualified, so the document renders anywhere.
  it('names the server in a bare-relative asset link', () => {
    expect(
      qualifyAssetUrls('<link href=".plandrop/litera/css/bootstrap.min.css">', 'https://plandrop.example'),
    ).toBe('<link href="https://plandrop.example/.plandrop/litera/css/bootstrap.min.css">');
  });

  it('names the server in a climbing-relative asset link, at any depth', () => {
    expect(
      qualifyAssetUrls('<script src="../.plandrop/shared/js/enhance.js"></script>', 'https://plandrop.example'),
    ).toBe('<script src="https://plandrop.example/.plandrop/shared/js/enhance.js"></script>');
    expect(
      qualifyAssetUrls('<script src="../../.plandrop/shared/js/enhance.js"></script>', 'https://plandrop.example'),
    ).toBe('<script src="https://plandrop.example/.plandrop/shared/js/enhance.js"></script>');
    expect(
      qualifyAssetUrls('<script src="./.plandrop/shared/js/enhance.js"></script>', 'https://plandrop.example'),
    ).toBe('<script src="https://plandrop.example/.plandrop/shared/js/enhance.js"></script>');
  });

  it('qualifies every link in a mixed document in one pass', () => {
    const mixed =
      '<link href="/.plandrop/a.css">' +
      '<link href=".plandrop/b.css">' +
      '<link href="../.plandrop/c.css">' +
      '<link href="https://elsewhere.example/.plandrop/d.css">';
    expect(qualifyAssetUrls(mixed, 'https://plandrop.example')).toBe(
      '<link href="https://plandrop.example/.plandrop/a.css">' +
        '<link href="https://plandrop.example/.plandrop/b.css">' +
        '<link href="https://plandrop.example/.plandrop/c.css">' +
        '<link href="https://elsewhere.example/.plandrop/d.css">',
    );
  });
});

describe('countLocalAssetRefs', () => {
  it('counts exactly what qualifyAssetUrls would rewrite', () => {
    const mixed =
      '<link href="/.plandrop/a.css">' +
      '<link href=".plandrop/b.css">' +
      '<link href="../../.plandrop/c.css">' +
      '<link href="https://elsewhere.example/.plandrop/d.css">' +
      '<!-- mentions /.plandrop/ in prose -->';
    expect(countLocalAssetRefs(mixed)).toBe(3);
  });

  it('reports nothing for a document that already names an origin', () => {
    expect(countLocalAssetRefs('<link href="https://plandrop.dev/.plandrop/a.css">')).toBe(0);
  });

  // A /g regex carries lastIndex; a shared instance would skip every other call.
  it('is stable across repeated calls', () => {
    const html = '<link href="/.plandrop/a.css"><link href=".plandrop/b.css">';
    expect(countLocalAssetRefs(html)).toBe(2);
    expect(countLocalAssetRefs(html)).toBe(2);
    expect(qualifyAssetUrls(html, 'https://x.example')).toBe(
      '<link href="https://x.example/.plandrop/a.css"><link href="https://x.example/.plandrop/b.css">',
    );
  });
});

describe('bootstrap5 template parts', () => {
  const part = (name: string): string =>
    readFileSync(fileURLToPath(new URL(`../templates/bootstrap5/${name}`, import.meta.url)), 'utf8');
  const sharedJs = (name: string): string =>
    readFileSync(fileURLToPath(new URL(`../templates/shared/js/${name}`, import.meta.url)), 'utf8');

  it('concatenates the three parts into one valid HTML document', () => {
    const assembled = part('header.html') + part('plan.html') + part('footer.html');
    expect(assembled.trimStart().startsWith('<!DOCTYPE html>')).toBe(true);
    expect(assembled.trimEnd().endsWith('</html>')).toBe(true);
    // plan.html content (the agent-facing onboarding comment) sits between
    // header and footer.
    expect(assembled).toContain('Agent: this document is yours');
    expect(assembled).toContain('replace this comment');
  });

  it('references the theme CSS by concrete name and self-update by the shared path', () => {
    const header = part('header.html');
    // The per-theme CSS is concrete (never "default").
    expect(header).toContain('.plandrop/bootstrap5/css/bootstrap.min.css');
    expect(header).not.toContain('.plandrop/default/');
    // selfupdate.js is shared and theme-neutral, not per-theme.
    expect(header).toContain('.plandrop/shared/js/selfupdate.js');
    expect(header).not.toContain('.plandrop/bootstrap5/js/');
  });

  it('supports light/dark via data-bs-theme', () => {
    expect(part('header.html')).toContain('data-bs-theme');
    expect(part('header.html')).toContain('data-bs-theme-toggle');
  });

  it('restores the stored mode from <head>, before <body> is parsed', () => {
    const header = part('header.html');
    // Render-blocking and in <head>: a deferred script runs after the parser
    // reaches <body>, which is the flash it exists to prevent.
    expect(header.indexOf('<script data-bs-theme-toggle')).toBeLessThan(header.indexOf('<body>'));
    expect(header).toContain('src="/.plandrop/shared/js/theme.js"');
    expect(header).not.toMatch(/<script[^>]*\bdata-bs-theme-toggle\b[^>]*\b(?:defer|async)\b/);
  });

  it('keys the stored mode to the document\'s own theme via data-plandrop-theme', () => {
    // The behaviour is one shared file; the document supplies the theme name
    // it keys the stored mode by.
    expect(part('header.html')).toContain('data-plandrop-theme=');
    expect(sharedJs('theme.js')).toContain(
      "'plandrop:mode:' + root.getAttribute('data-plandrop-theme')",
    );
  });

  it('credits Bootstrap and plandrop in the footer (loud and proud)', () => {
    const footer = part('footer.html');
    expect(footer).toContain('Bootstrap');
    expect(footer).toContain('plandrop');
  });
});
