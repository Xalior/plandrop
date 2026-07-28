import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildHeader, markAutoindexBody } from '../src/commands/autoindex';

const TEMPLATES_DIR = fileURLToPath(new URL('../templates', import.meta.url));

describe('markAutoindexBody', () => {
  it('marks a bare body', () => {
    expect(markAutoindexBody('<body>\n<p>x</p>')).toBe('<body class="plandrop-autoindex">\n<p>x</p>');
  });

  it('appends to an existing class list', () => {
    expect(markAutoindexBody('<body class="a b">')).toBe('<body class="a b plandrop-autoindex">');
  });

  it('keeps other attributes and their order', () => {
    expect(markAutoindexBody('<body data-x="1" class="a" id="top">')).toBe(
      '<body data-x="1" class="a plandrop-autoindex" id="top">',
    );
  });

  it('adds a class list to a body that has attributes but no class', () => {
    expect(markAutoindexBody('<body data-x="1">')).toBe(
      '<body data-x="1" class="plandrop-autoindex">',
    );
  });

  it('preserves single-quoted class attributes', () => {
    expect(markAutoindexBody("<body class='a'>")).toBe("<body class='a plandrop-autoindex'>");
  });

  it('is idempotent — a marked body is left alone', () => {
    const once = markAutoindexBody('<body class="a">');
    expect(markAutoindexBody(once)).toBe(once);
  });

  it('marks only the opening body tag, not a later mention', () => {
    const marked = markAutoindexBody('<body>\n<p>&lt;body&gt;</p>\n</body>');
    expect(marked).toBe('<body class="plandrop-autoindex">\n<p>&lt;body&gt;</p>\n</body>');
  });

  // The stylesheet's listing rules are all scoped to the marker, so a stock
  // theme header uploaded unmarked yields a themed page around an unstyled
  // table. Every shipped theme must therefore be markable.
  it('marks every shipped theme header', () => {
    const themes = readdirSync(TEMPLATES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'shared')
      .map((entry) => entry.name);
    expect(themes.length).toBeGreaterThan(0);
    for (const theme of themes) {
      const header = readFileSync(join(TEMPLATES_DIR, theme, 'header.html'), 'utf8');
      expect(markAutoindexBody(header)).toContain('class="plandrop-autoindex"');
    }
  });
});

describe('buildHeader', () => {
  it('marks the body and adds nothing else without a hero', () => {
    expect(buildHeader('<body>\n<main>\n', undefined)).toBe(
      '<body class="plandrop-autoindex">\n<main>\n',
    );
  });

  it('places the hero last, so it renders directly above the listing', () => {
    const built = buildHeader('<body>\n<main class="container py-4">\n', '<h1>Evidence</h1>');
    expect(built).toContain('<h1>Evidence</h1>');
    expect(built.indexOf('<main')).toBeLessThan(built.indexOf('<h1>Evidence</h1>'));
    expect(built.trimEnd().endsWith('</div>')).toBe(true);
  });

  it('wraps the hero in a themed block', () => {
    const built = buildHeader('<body>\n<main>\n', '<p>hi</p>');
    expect(built).toContain('<div class="p-4 p-md-5 mb-4 rounded-3 bg-body-tertiary plandrop-hero">');
  });

  it('takes the hero fragment verbatim, markup and all', () => {
    const hero = '<h1>Title</h1>\n<p>A <a href="/x.html">link</a>.</p>';
    expect(buildHeader('<body>\n<main>\n', hero)).toContain(hero);
  });
});
