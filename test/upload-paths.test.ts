import { describe, expect, it } from 'vitest';
import { normalizeRemote, remoteForEntry, toRemoteBase } from '../src/commands/upload';

describe('normalizeRemote', () => {
  it('adds a single leading slash and collapses duplicates', () => {
    expect(normalizeRemote('index.html')).toBe('/index.html');
    expect(normalizeRemote('/a//b')).toBe('/a/b');
    expect(normalizeRemote('a\\b\\c')).toBe('/a/b/c');
  });
});

describe('toRemoteBase', () => {
  it('is empty for no argument and trims slashes otherwise', () => {
    expect(toRemoteBase(undefined)).toBe('');
    expect(toRemoteBase('/foo/bar/')).toBe('foo/bar');
  });
});

describe('remoteForEntry', () => {
  it('preserves the relative structure under the root', () => {
    expect(remoteForEntry('/local/site', '/local/site/index.html', '')).toBe('/index.html');
    expect(remoteForEntry('/local/site', '/local/site/css/a.css', '')).toBe('/css/a.css');
  });

  it('places entries under a remote base when given', () => {
    expect(remoteForEntry('/local/site', '/local/site/css/a.css', 'dest')).toBe('/dest/css/a.css');
  });
});
