import { describe, expect, it } from 'vitest';
import { generateLabel, generatePassphrase } from '../src/generate';

describe('generateLabel', () => {
  it('is 16 base32 chars (lowercase, digits 2-7)', () => {
    expect(generateLabel()).toMatch(/^[a-z2-7]{16}$/);
  });

  it('is overwhelmingly unique across many draws', () => {
    const labels = new Set(Array.from({ length: 1000 }, generateLabel));
    expect(labels.size).toBe(1000);
  });
});

describe('generatePassphrase', () => {
  it('is 22 base64url chars (ASCII-only)', () => {
    expect(generatePassphrase()).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('is unique across many draws', () => {
    const passphrases = new Set(Array.from({ length: 1000 }, generatePassphrase));
    expect(passphrases.size).toBe(1000);
  });
});
