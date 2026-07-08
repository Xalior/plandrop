import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALIAS,
  requestedTemplate,
  resolveTemplate,
  UnknownTemplateError,
} from '../src/templates';
import type { TemplatesResponse } from '../src/types';

const available: TemplatesResponse = {
  default: 'bootstrap5',
  templates: ['bootstrap5', 'darkly'],
};

describe('requestedTemplate precedence', () => {
  it('uses the --template flag when given (highest precedence)', () => {
    expect(requestedTemplate('darkly', 'bootstrap5')).toBe('darkly');
  });

  it('falls back to the dotfile template when no flag', () => {
    expect(requestedTemplate(undefined, 'darkly')).toBe('darkly');
  });

  it('falls back to the user config template below the dotfile', () => {
    expect(requestedTemplate(undefined, 'darkly', 'sketchy')).toBe('darkly');
    expect(requestedTemplate(undefined, undefined, 'sketchy')).toBe('sketchy');
  });

  it('falls back to the default alias when nothing is set', () => {
    expect(requestedTemplate(undefined, undefined)).toBe(DEFAULT_ALIAS);
    expect(requestedTemplate(undefined, undefined, undefined)).toBe(DEFAULT_ALIAS);
  });
});

describe('resolveTemplate', () => {
  it('resolves the default alias to the concrete default', () => {
    expect(resolveTemplate(DEFAULT_ALIAS, available)).toBe('bootstrap5');
  });

  it('passes a known concrete name through', () => {
    expect(resolveTemplate('darkly', available)).toBe('darkly');
  });

  it('rejects an unknown name, listing what is available', () => {
    expect(() => resolveTemplate('nope', available)).toThrow(UnknownTemplateError);
    try {
      resolveTemplate('nope', available);
    } catch (error) {
      expect((error as Error).message).toContain('bootstrap5');
      expect((error as Error).message).toContain('darkly');
    }
  });
});
