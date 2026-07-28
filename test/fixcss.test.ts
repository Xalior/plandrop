import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run as fixcss } from '../src/commands/fixcss';

/**
 * Every case runs under a throwaway root with its own `.plandrop`, entered with
 * chdir. `fixcss` resolves both its publish root and its domain by walking up
 * from the CWD, and a developer's checkout may well sit under a real
 * `.plandrop` pointing at a real host — running in place would rewrite this
 * repository's own documents against a live domain.
 */
describe('fixcss', () => {
  let root: string;
  let cwd: string;
  let savedDomain: string | undefined;

  const DOMAIN = 'https://plandrop.example';

  beforeEach(() => {
    cwd = process.cwd();
    // realpath: macOS hands out a symlinked temp path, and fixcss reports paths
    // relative to the root it resolved from the CWD.
    root = realpathSync(mkdtempSync(join(tmpdir(), 'plandrop-fixcss-')));
    // PLANDROP_DOMAIN outranks the dotfile, so an exported one on the developer's
    // machine would decide what the fixtures get rewritten against.
    savedDomain = process.env.PLANDROP_DOMAIN;
    delete process.env.PLANDROP_DOMAIN;
    process.chdir(root);
  });

  afterEach(() => {
    process.chdir(cwd);
    if (savedDomain === undefined) {
      delete process.env.PLANDROP_DOMAIN;
    } else {
      process.env.PLANDROP_DOMAIN = savedDomain;
    }
    rmSync(root, { recursive: true, force: true });
  });

  function dotfile(extra: Record<string, unknown> = {}): void {
    writeFileSync(
      join(root, '.plandrop'),
      JSON.stringify({ domain: DOMAIN, host: 'abcdefgh12345678', passphrase: 'x', ...extra }),
    );
  }

  function write(relPath: string, contents: string): void {
    const full = join(root, relPath);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }

  function read(relPath: string): string {
    return readFileSync(join(root, relPath), 'utf8');
  }

  async function run(): Promise<{ code: number; out: string; err: string }> {
    const outSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const errSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const code = await fixcss({ command: 'fixcss', hashOverride: undefined, params: [] });
    const out = outSpy.mock.calls.map((call) => String(call[0])).join('');
    const err = errSpy.mock.calls.map((call) => String(call[0])).join('');
    outSpy.mockRestore();
    errSpy.mockRestore();
    return { code, out, err };
  }

  it('names the server in every origin-less asset link, in place', async () => {
    dotfile();
    write(
      'plan.html',
      '<link href="/.plandrop/darkly/css/bootstrap.min.css">\n' +
        '<link href=".plandrop/shared/css/plandrop.css">\n' +
        '<script src="../.plandrop/shared/js/selfupdate.js"></script>\n',
    );

    const { code, out } = await run();

    expect(code).toBe(0);
    expect(read('plan.html')).toBe(
      `<link href="${DOMAIN}/.plandrop/darkly/css/bootstrap.min.css">\n` +
        `<link href="${DOMAIN}/.plandrop/shared/css/plandrop.css">\n` +
        `<script src="${DOMAIN}/.plandrop/shared/js/selfupdate.js"></script>\n`,
    );
    expect(out).toContain('fixed plan.html (3 references)');
    expect(out).toContain('fixed 3 references in 1 document (1 scanned)');
  });

  it('descends into subdirectories and leaves the rest of the document alone', async () => {
    dotfile();
    write(
      'plans/deep/x.html',
      '<h1>Plan</h1><a href="../index.html">up</a><link href=".plandrop/minty/css/bootstrap.min.css">',
    );

    const { code, out } = await run();

    expect(code).toBe(0);
    expect(read('plans/deep/x.html')).toBe(
      `<h1>Plan</h1><a href="../index.html">up</a><link href="${DOMAIN}/.plandrop/minty/css/bootstrap.min.css">`,
    );
    expect(out).toContain('fixed plans/deep/x.html (1 reference)');
  });

  it('leaves a document that already names an origin untouched', async () => {
    dotfile();
    const already = `<link href="https://plandrop.dev/.plandrop/bootstrap5/css/bootstrap.min.css">`;
    write('static.html', already);

    const { code, out } = await run();

    expect(code).toBe(0);
    expect(read('static.html')).toBe(already);
    expect(out).toContain('nothing to fix (1 document scanned)');
  });

  // The publish root is the tree that actually ships; a document kept outside it
  // is not published from here, so fixcss has no business rewriting it.
  it('confines itself to the recorded localRoot', async () => {
    dotfile({ localRoot: 'docs' });
    const link = '<link href=".plandrop/lux/css/bootstrap.min.css">';
    write('docs/inside.html', link);
    write('elsewhere/outside.html', link);

    const { code } = await run();

    expect(code).toBe(0);
    expect(read('docs/inside.html')).toBe(`<link href="${DOMAIN}/.plandrop/lux/css/bootstrap.min.css">`);
    expect(read('elsewhere/outside.html')).toBe(link);
  });

  it('anchors on the current directory when no localRoot is recorded', async () => {
    dotfile();
    const link = '<link href=".plandrop/lux/css/bootstrap.min.css">';
    write('docs/a.html', link);
    write('elsewhere/b.html', link);

    const { code } = await run();

    expect(code).toBe(0);
    expect(read('docs/a.html')).toContain(DOMAIN);
    expect(read('elsewhere/b.html')).toContain(DOMAIN);
  });

  it('skips hidden directories and non-HTML files', async () => {
    dotfile();
    const link = '<link href=".plandrop/lux/css/bootstrap.min.css">';
    write('.git/stored.html', link);
    write('notes.md', link);
    write('page.htm', link);

    const { code, out } = await run();

    expect(code).toBe(0);
    expect(read('.git/stored.html')).toBe(link);
    expect(read('notes.md')).toBe(link);
    expect(read('page.htm')).toBe(`<link href="${DOMAIN}/.plandrop/lux/css/bootstrap.min.css">`);
    expect(out).not.toContain('.git');
    expect(out).not.toContain('notes.md');
  });

  it('refuses clearly when no .plandrop resolves', async () => {
    const { code, err } = await run();

    expect(code).toBe(1);
    expect(err).toContain('no .plandrop found here or in any parent directory');
  });
});
