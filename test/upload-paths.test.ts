import { describe, expect, it } from 'vitest';
import {
  mirrorRemote,
  normalizeRemote,
  remoteBaseForDirectory,
  remoteForEntry,
  toRemoteBase,
} from '../src/commands/upload';

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

  it('reads a base resolving to or above the root as the root', () => {
    expect(toRemoteBase('.')).toBe('');
    expect(toRemoteBase('./')).toBe('');
    expect(toRemoteBase('/')).toBe('');
    expect(toRemoteBase('..')).toBe('');
    expect(toRemoteBase('../elsewhere')).toBe('');
  });
});

describe('mirrorRemote', () => {
  it('mirrors a nested cwd-relative path', () => {
    expect(mirrorRemote('/work/proj', 'docs/plans/x.html')).toBe('/docs/plans/x.html');
    expect(mirrorRemote('/work/proj', './docs/plans/x.html')).toBe('/docs/plans/x.html');
  });

  it('keeps a basename-only path at the root', () => {
    expect(mirrorRemote('/work/proj', 'x.html')).toBe('/x.html');
  });

  it('mirrors an absolute path that lies inside the cwd', () => {
    expect(mirrorRemote('/work/proj', '/work/proj/docs/x.html')).toBe('/docs/x.html');
  });

  it('falls back to the basename for a path escaping the cwd', () => {
    expect(mirrorRemote('/work/proj', '../elsewhere/x.html')).toBe('/x.html');
    expect(mirrorRemote('/work/proj', 'docs/../../elsewhere/x.html')).toBe('/x.html');
    expect(mirrorRemote('/work/proj', '/tmp/probe.jpg')).toBe('/probe.jpg');
  });
});

describe('remoteBaseForDirectory', () => {
  it('defaults to the uploaded directory own name', () => {
    expect(remoteBaseForDirectory('/work/proj/evidence', undefined)).toBe('evidence');
    expect(remoteBaseForDirectory('/work/proj/evidence/', undefined)).toBe('evidence');
  });

  it('takes the named remote base instead', () => {
    expect(remoteBaseForDirectory('/work/proj/evidence', 'photos')).toBe('photos');
    expect(remoteBaseForDirectory('/work/proj/evidence', 'photos/')).toBe('photos');
    expect(remoteBaseForDirectory('/work/proj/evidence', '/photos/2026/')).toBe('photos/2026');
  });

  it('spills the contents into the host root when the base is `.`', () => {
    expect(remoteBaseForDirectory('/work/proj/evidence', '.')).toBe('');
  });

  it('maps the bare cwd to the host root, not the cwd basename', () => {
    expect(remoteBaseForDirectory('.', undefined)).toBe('');
    expect(remoteBaseForDirectory('./', undefined)).toBe('');
    expect(remoteBaseForDirectory(process.cwd(), undefined)).toBe('');
  });

  it('still names a cwd-resolving directory given an explicit remote', () => {
    expect(remoteBaseForDirectory('.', 'photos')).toBe('photos');
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

  it('publishes a directory under its own name by default', () => {
    const base = remoteBaseForDirectory('/local/evidence', undefined);
    expect(remoteForEntry('/local/evidence', '/local/evidence/a.jpg', base)).toBe('/evidence/a.jpg');
    expect(remoteForEntry('/local/evidence', '/local/evidence/inner/b.jpg', base)).toBe(
      '/evidence/inner/b.jpg',
    );
  });
});
