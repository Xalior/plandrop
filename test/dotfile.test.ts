import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  dotfileExists,
  findDotfile,
  hostUrl,
  readDotfile,
  writeDotfile,
} from '../src/dotfile';

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'plandrop-dotfile-'));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

const sample = { domain: 'plandrop.test', host: 'abcdefghij234567', passphrase: 'pass1234pass1234pass12' };

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

describe('hostUrl', () => {
  it('formats the shareable URL as host.domain', () => {
    expect(hostUrl('abc', 'plandrop.test')).toBe('http://abc.plandrop.test/');
  });
});
