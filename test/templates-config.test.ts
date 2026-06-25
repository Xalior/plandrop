import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPLATE,
  listTemplates,
  resolveConfiguredDefault,
} from '../src/templates';

describe('resolveConfiguredDefault', () => {
  const available = ['bootstrap5', 'darkly', 'user/house'];

  it('honours a configured value that names an available template', () => {
    expect(resolveConfiguredDefault('darkly', available)).toBe('darkly');
  });

  it('resolves a user/<name> default', () => {
    expect(resolveConfiguredDefault('user/house', available)).toBe('user/house');
  });

  it('defaults to bootstrap5 when unset or empty', () => {
    expect(resolveConfiguredDefault(undefined, available)).toBe(DEFAULT_TEMPLATE);
    expect(resolveConfiguredDefault('', available)).toBe(DEFAULT_TEMPLATE);
  });

  it('falls back to bootstrap5 when the configured value is unknown', () => {
    expect(resolveConfiguredDefault('nope', available)).toBe(DEFAULT_TEMPLATE);
  });
});

describe('listTemplates enumeration', () => {
  let themeDir: string;
  let userDir: string;

  beforeEach(() => {
    themeDir = mkdtempSync(join(tmpdir(), 'plandrop-theme-'));
    userDir = mkdtempSync(join(tmpdir(), 'plandrop-user-'));
    for (const name of ['bootstrap5', 'darkly', 'default', 'shared']) {
      mkdirSync(join(themeDir, name));
    }
    mkdirSync(join(userDir, 'house'));
  });

  afterEach(() => {
    rmSync(themeDir, { recursive: true, force: true });
    rmSync(userDir, { recursive: true, force: true });
  });

  it('lists built-ins, excludes the default/ chrome mirror, and namespaces user templates', async () => {
    const res = await listTemplates(themeDir, { userDir });
    expect(res.templates).toContain('bootstrap5');
    expect(res.templates).toContain('darkly');
    expect(res.templates).toContain('user/house');
    // `default/` is the autoindex-chrome mirror, never a selectable template.
    expect(res.templates).not.toContain('default');
    // `shared/` holds theme-neutral assets (selfupdate.js), not a template.
    expect(res.templates).not.toContain('shared');
  });

  it('reports the configured default, validated against the available set', async () => {
    expect((await listTemplates(themeDir, { userDir })).default).toBe('bootstrap5');
    expect(
      (await listTemplates(themeDir, { userDir, configuredDefault: 'darkly' })).default,
    ).toBe('darkly');
    // An unknown configured default falls back.
    expect(
      (await listTemplates(themeDir, { userDir, configuredDefault: 'nope' })).default,
    ).toBe('bootstrap5');
  });

  it('handles a missing user mount gracefully', async () => {
    const res = await listTemplates(themeDir, { userDir: join(userDir, 'nonexistent') });
    expect(res.templates).toContain('bootstrap5');
    expect(res.templates.some((t) => t.startsWith('user/'))).toBe(false);
  });
});
