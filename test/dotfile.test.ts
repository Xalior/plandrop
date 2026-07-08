import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  dotfileExists,
  findDotfile,
  mergeDotfileConfig,
  readDotfile,
  readDotfileConfig,
  writeDotfile,
} from '../src/dotfile';

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'plandrop-dotfile-'));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

const sample = {
  domain: 'https://plandrop.test',
  host: 'abcdefghij234567',
  passphrase: 'pass1234pass1234pass12',
};

describe('dotfile read/write', () => {
  it('writes mode 0600 with three fields and round-trips', () => {
    const path = writeDotfile(workdir, sample);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readDotfile(path)).toEqual(sample);
  });

  it('reports existence at a directory', () => {
    expect(dotfileExists(workdir)).toBe(false);
    writeDotfile(workdir, sample);
    expect(dotfileExists(workdir)).toBe(true);
  });

  it('rejects a malformed dotfile', () => {
    const path = join(workdir, '.plandrop');
    writeFileSync(path, JSON.stringify({ domain: 'x' }));
    expect(() => readDotfile(path)).toThrow();
  });

  it('round-trips the optional template field', () => {
    const withTemplate = { ...sample, template: 'darkly' };
    const path = writeDotfile(workdir, withTemplate);
    expect(readDotfile(path)).toEqual(withTemplate);
  });

  it('reads a dotfile with no template field (backward compatible)', () => {
    const path = writeDotfile(workdir, sample);
    expect(readDotfile(path).template).toBeUndefined();
  });

  it('rejects a non-string template field', () => {
    const path = join(workdir, '.plandrop');
    writeFileSync(path, JSON.stringify({ ...sample, template: 42 }));
    expect(() => readDotfile(path)).toThrow();
  });
});

describe('readDotfileConfig', () => {
  it('reads the preference keys of a full dotfile', () => {
    const path = writeDotfile(workdir, { ...sample, template: 'darkly' });
    expect(readDotfileConfig(path)).toEqual({ domain: sample.domain, template: 'darkly' });
  });

  it('tolerates a config-only dotfile with no host/passphrase', () => {
    const path = join(workdir, '.plandrop');
    writeFileSync(path, JSON.stringify({ domain: 'https://x.example' }));
    expect(readDotfileConfig(path)).toEqual({ domain: 'https://x.example' });
  });

  it('ignores non-string preference values', () => {
    const path = join(workdir, '.plandrop');
    writeFileSync(path, JSON.stringify({ domain: 42, template: 'darkly' }));
    expect(readDotfileConfig(path)).toEqual({ template: 'darkly' });
  });
});

describe('mergeDotfileConfig', () => {
  it('creates a config-only dotfile when none exists, mode 0600', () => {
    const path = mergeDotfileConfig(workdir, { domain: 'https://x.example' });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ domain: 'https://x.example' });
  });

  it('preserves host, passphrase, and unknown keys while updating preferences', () => {
    const path = join(workdir, '.plandrop');
    writeFileSync(path, JSON.stringify({ ...sample, extra: 'kept' }));
    mergeDotfileConfig(workdir, { domain: 'https://new.example', template: 'darkly' });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      ...sample,
      extra: 'kept',
      domain: 'https://new.example',
      template: 'darkly',
    });
  });
});

describe('findDotfile walk-up', () => {
  it('finds the nearest .plandrop walking up from a nested dir', () => {
    writeDotfile(workdir, sample);
    const nested = join(workdir, 'a', 'b', 'c');
    mkdirSync(nested, { recursive: true });
    expect(findDotfile(nested)).toBe(join(workdir, '.plandrop'));
  });

  it('returns undefined when none exists up the tree', () => {
    const nested = join(workdir, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    expect(findDotfile(nested)).toBeUndefined();
  });
});
