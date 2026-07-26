import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listFiles,
  mirrorAnchor,
  mirrorRemote,
  normalizeRemote,
  remoteBaseForDirectory,
  remoteForEntry,
  run as upload,
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

describe('mirrorAnchor', () => {
  it('anchors at dotfileDir/localRoot when one is recorded, wherever the shell sits', () => {
    expect(mirrorAnchor('/work/proj', 'docs', '/work/proj')).toBe('/work/proj/docs');
    expect(mirrorAnchor('/work/proj', 'docs', '/work/proj/docs/plans')).toBe('/work/proj/docs');
  });

  it('anchors at the cwd when no localRoot is recorded', () => {
    expect(mirrorAnchor('/work/proj', undefined, '/somewhere/else')).toBe('/somewhere/else');
    expect(mirrorAnchor('/work/proj', '', '/somewhere/else')).toBe('/somewhere/else');
  });

  it('composes with mirrorRemote to land a file where the hook publishes it', () => {
    const anchor = mirrorAnchor('/work/proj', 'docs', '/work/proj');
    expect(mirrorRemote(anchor, '/work/proj/docs/plans/x.html')).toBe('/plans/x.html');
    // Outside the root there is no mirror image — bare basename, the same
    // fallback the hook's own out-of-root saves take.
    expect(mirrorRemote(anchor, '/work/proj/README.html')).toBe('/README.html');
  });
});

describe('remoteBaseForDirectory', () => {
  it('defaults to the directory place under the anchor', () => {
    expect(remoteBaseForDirectory('/work/proj', '/work/proj/evidence', undefined)).toBe('evidence');
    expect(remoteBaseForDirectory('/work/proj', '/work/proj/evidence/', undefined)).toBe('evidence');
    expect(remoteBaseForDirectory('/work/proj', '/work/proj/docs/plans', undefined)).toBe(
      'docs/plans',
    );
  });

  it('takes the named remote base instead', () => {
    expect(remoteBaseForDirectory('/work/proj', '/work/proj/evidence', 'photos')).toBe('photos');
    expect(remoteBaseForDirectory('/work/proj', '/work/proj/evidence', 'photos/')).toBe('photos');
    expect(remoteBaseForDirectory('/work/proj', '/work/proj/evidence', '/photos/2026/')).toBe(
      'photos/2026',
    );
  });

  it('spills the contents into the host root when the base is `.`', () => {
    expect(remoteBaseForDirectory('/work/proj', '/work/proj/evidence', '.')).toBe('');
  });

  it('maps the anchor itself to the host root, not its basename', () => {
    expect(remoteBaseForDirectory(process.cwd(), '.', undefined)).toBe('');
    expect(remoteBaseForDirectory(process.cwd(), './', undefined)).toBe('');
    expect(remoteBaseForDirectory(process.cwd(), process.cwd(), undefined)).toBe('');
  });

  it('still names an anchor-resolving directory given an explicit remote', () => {
    expect(remoteBaseForDirectory(process.cwd(), '.', 'photos')).toBe('photos');
  });

  it('falls back to the bare name for a directory outside the anchor', () => {
    expect(remoteBaseForDirectory('/work/proj', '/elsewhere/evidence', undefined)).toBe('evidence');
    expect(remoteBaseForDirectory('/work/proj/docs', '/work/proj/build', undefined)).toBe('build');
  });

  // The cwd's basename is never typed, so an unmirrored cwd publishes what's
  // here rather than a folder named after wherever the command ran.
  it('maps an unmirrored cwd to the host root, not its basename', () => {
    const anchor = join(process.cwd(), 'docs');
    expect(remoteBaseForDirectory(anchor, '.', undefined)).toBe('');
    expect(remoteBaseForDirectory(anchor, process.cwd(), undefined)).toBe('');
  });

  // localRoot names the local root remote paths resolve against, so a directory
  // upload lands its contents where the same files land one at a time.
  it('treats a recorded localRoot as the host root, matching a single file', () => {
    const anchor = mirrorAnchor('/work/proj', 'docs', '/work/proj');
    expect(remoteBaseForDirectory(anchor, '/work/proj/docs', undefined)).toBe('');
    expect(remoteBaseForDirectory(anchor, '/work/proj/docs/plans', undefined)).toBe('plans');
    expect(mirrorRemote(anchor, '/work/proj/docs/plans/x.html')).toBe('/plans/x.html');
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
    const base = remoteBaseForDirectory('/local', '/local/evidence', undefined);
    expect(remoteForEntry('/local/evidence', '/local/evidence/a.jpg', base)).toBe('/evidence/a.jpg');
    expect(remoteForEntry('/local/evidence', '/local/evidence/inner/b.jpg', base)).toBe(
      '/evidence/inner/b.jpg',
    );
  });
});

// Hidden names hold configuration and private data by convention — the CLI's
// own passphrase dotfile among them — and everything published is
// world-readable, so nothing hidden rides along on a directory upload.
describe('listFiles hidden-name pruning', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'plandrop-walk-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function rel(paths: string[]): string[] {
    return paths.map((path) => path.slice(root.length + 1)).sort();
  }

  function walk(): { files: string[]; skipped: [string, string][] } {
    const skipped: [string, string][] = [];
    const files = listFiles(root, (path, reason) => skipped.push([path, reason]));
    return { files, skipped };
  }

  it('omits hidden files at the root and at every depth, reporting each once', () => {
    mkdirSync(join(root, 'plans', 'deep'), { recursive: true });
    writeFileSync(join(root, '.plandrop'), '{}');
    writeFileSync(join(root, '.env'), 'SECRET=1');
    writeFileSync(join(root, 'index.html'), 'root');
    writeFileSync(join(root, 'plans', '.plandrop'), '{}');
    writeFileSync(join(root, 'plans', 'deep', '.plandrop'), '{}');
    writeFileSync(join(root, 'plans', 'deep', 'x.html'), 'deep');

    const { files, skipped } = walk();

    expect(rel(files)).toEqual(['index.html', 'plans/deep/x.html']);
    expect(rel(skipped.map(([path]) => path))).toEqual([
      '.env',
      '.plandrop',
      'plans/.plandrop',
      'plans/deep/.plandrop',
    ]);
  });

  it('names the credential family as such and the rest as merely hidden', () => {
    writeFileSync(join(root, '.plandrop'), '{}');
    writeFileSync(join(root, '.plandrop.bak'), '{}');
    writeFileSync(join(root, '.plandrop~'), '{}');
    writeFileSync(join(root, '.env'), 'SECRET=1');
    writeFileSync(join(root, '.npmrc'), '');

    const reasons = new Map(
      walk().skipped.map(([path, reason]) => [path.slice(root.length + 1), reason]),
    );

    expect(reasons.get('.plandrop')).toBe('plandrop credential file');
    expect(reasons.get('.plandrop.bak')).toBe('plandrop credential file');
    expect(reasons.get('.plandrop~')).toBe('plandrop credential file');
    expect(reasons.get('.env')).toBe('hidden');
    expect(reasons.get('.npmrc')).toBe('hidden');
  });

  it('leaves a name that is merely plandrop-ish alone', () => {
    writeFileSync(join(root, 'x.plandrop'), 'named after it');
    writeFileSync(join(root, 'plandrop'), 'no dot');
    writeFileSync(join(root, 'plandrop.html'), 'a document');
    writeFileSync(join(root, 'config.json'), '{"plandrop": true}');

    const { files, skipped } = walk();

    expect(rel(files)).toEqual(['config.json', 'plandrop', 'plandrop.html', 'x.plandrop']);
    expect(skipped).toEqual([]);
  });

  // Apache names the per-directory autoindex chrome as dotfiles so it stays out
  // of the listing it decorates — content a tenant publishes on purpose, and the
  // one thing the blanket hidden-name ban has to let through.
  it('publishes the tenant autoindex chrome at any depth, without a skip line', () => {
    mkdirSync(join(root, 'plans'), { recursive: true });
    writeFileSync(join(root, '.header.html'), '<header>');
    writeFileSync(join(root, '.footer.html'), '</footer>');
    writeFileSync(join(root, 'plans', '.header.html'), '<header>');
    writeFileSync(join(root, 'plans', '.footer.html'), '</footer>');
    writeFileSync(join(root, 'index.html'), 'root');

    const { files, skipped } = walk();

    expect(rel(files)).toEqual([
      '.footer.html',
      '.header.html',
      'index.html',
      'plans/.footer.html',
      'plans/.header.html',
    ]);
    expect(skipped).toEqual([]);
  });

  it('allows the two chrome names only, not anything shaped like them', () => {
    writeFileSync(join(root, '.header.html'), '<header>');
    writeFileSync(join(root, '.header.html.bak'), 'backup');
    writeFileSync(join(root, '.footer.html~'), 'editor leftover');
    writeFileSync(join(root, '.header.htm'), 'nearly');
    writeFileSync(join(root, '.headers.html'), 'nearly');

    const { files, skipped } = walk();

    expect(rel(files)).toEqual(['.header.html']);
    expect(rel(skipped.map(([path]) => path))).toEqual([
      '.footer.html~',
      '.header.htm',
      '.header.html.bak',
      '.headers.html',
    ]);
  });

  it('prunes a hidden directory whole, in one line, without descending', () => {
    mkdirSync(join(root, '.git', 'objects', 'ab'), { recursive: true });
    writeFileSync(join(root, '.git', 'config'), 'url = private');
    writeFileSync(join(root, '.git', 'objects', 'ab', 'cdef'), 'blob');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'keep.txt'), 'yes');

    const { files, skipped } = walk();

    expect(rel(files)).toEqual(['src/keep.txt']);
    expect(skipped).toEqual([[join(root, '.git') + sep, 'hidden']]);
  });
});

describe('upload refuses an explicitly named hidden path', () => {
  function captureStderr(): { text: () => string } {
    const spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    return {
      text: () => {
        const written = spy.mock.calls.map((call) => String(call[0])).join('');
        spy.mockRestore();
        return written;
      },
    };
  }

  /**
   * A path under a directory that does not exist, so nothing here can ever
   * publish anything. `upload` resolves its context from the CWD upwards, and
   * a developer's checkout may well sit under a real `.plandrop` pointing at a
   * real host — so a case that got past the name check must die on the missing
   * file, never on a live PUT. The name check runs on the basename alone, so
   * an unreachable path proves it exactly as well as a real one.
   */
  const absent = join(tmpdir(), `plandrop-absent-${process.pid}`, 'work');

  async function refusalFor(name: string): Promise<{ code: number; text: string }> {
    const { text } = captureStderr();
    const code = await upload({
      command: 'upload',
      hashOverride: undefined,
      params: [join(absent, name)],
    });
    return { code, text: text() };
  }

  // Naming one explicitly is not consent to publish it — the refusal comes
  // before anything is read or any host is contacted.
  it.each(['.plandrop', '.plandrop.bak', '.plandrop~', '.plandrop.save'])(
    'refuses `upload %s` as the credential file it is',
    async (name) => {
      const { code, text } = await refusalFor(name);
      expect(code).toBe(1);
      expect(text).toContain(`refusing to upload ${name}: it holds this host's passphrase`);
      expect(text).toContain('Rename it');
    },
  );

  it.each(['.env', '.git', '.ssh', '.npmrc'])(
    'refuses `upload %s` with the general hidden-name reason',
    async (name) => {
      const { code, text } = await refusalFor(name);
      expect(code).toBe(1);
      expect(text).toContain(`refusing to upload ${name}`);
      expect(text).toContain('hidden names are configuration or private data by convention');
      expect(text).toContain('Rename it');
    },
  );

  it.each(['.header.html.bak', '.footer.html~', '.header.htm', '.headers.html'])(
    'refuses `upload %s` — the chrome exception is the exact names, nothing near them',
    async (name) => {
      const { code, text } = await refusalFor(name);
      expect(code).toBe(1);
      expect(text).toContain('hidden names are configuration or private data by convention');
    },
  );

  it.each([
    'config.json',
    'x.plandrop',
    'plandrop.html',
    'plandrop',
    // The tenant autoindex chrome: hidden, but published on purpose.
    '.header.html',
    '.footer.html',
  ])('lets `upload %s` through the name check', async (name) => {
    const { code, text } = await refusalFor(name);
    expect(code).toBe(1);
    expect(text).not.toContain('refusing to upload');
    expect(text).toContain('no such file or directory');
  });
});
