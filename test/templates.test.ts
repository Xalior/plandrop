import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildTemplatesResponse, DEFAULT_TEMPLATE } from '../src/templates';

describe('buildTemplatesResponse', () => {
  it('reports the default and a sorted template list', () => {
    const res = buildTemplatesResponse(['zephyr', 'bootstrap5', 'cerulean']);
    expect(res.default).toBe(DEFAULT_TEMPLATE);
    expect(res.templates).toEqual(['bootstrap5', 'cerulean', 'zephyr']);
  });

  it('handles an empty theme volume', () => {
    expect(buildTemplatesResponse([])).toEqual({ default: DEFAULT_TEMPLATE, templates: [] });
  });

  it('honours an explicit default override', () => {
    const res = buildTemplatesResponse(['bootstrap5', 'darkly'], 'darkly');
    expect(res.default).toBe('darkly');
  });
});

// The seeder assembles template.html = header.html + plan.html + footer.html.
// These assert the content contract that concatenation relies on, so the
// assembled starter is a single valid document with concrete asset links.
describe('bootstrap5 template parts', () => {
  const part = (name: string): string =>
    readFileSync(fileURLToPath(new URL(`../templates/bootstrap5/${name}`, import.meta.url)), 'utf8');

  it('concatenates the three parts into one valid HTML document', () => {
    const assembled = part('header.html') + part('plan.html') + part('footer.html');
    expect(assembled.trimStart().startsWith('<!DOCTYPE html>')).toBe(true);
    expect(assembled.trimEnd().endsWith('</html>')).toBe(true);
    // plan.html content (the onboarding comment) sits between header and footer.
    expect(assembled).toContain('Replace this comment');
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
    expect(part('footer.html')).toContain('data-bs-theme-toggle');
  });

  it('credits Bootstrap and plandrop in the footer (loud and proud)', () => {
    const footer = part('footer.html');
    expect(footer).toContain('Bootstrap');
    expect(footer).toContain('plandrop');
  });
});
