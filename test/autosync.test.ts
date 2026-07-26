import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  autosyncCommand,
  DEFAULT_WATCH_GLOB,
  describeHookOutcome,
  describeMode,
  FLAT_MODE,
  hookConfigPatch,
  mergeAutosyncHook,
  MIRROR_MODE,
  modeFromConfig,
  normalizeHookRoot,
  normalizeWatchGlob,
  parsePublishAnswer,
  publishModePrompt,
  publishRootMode,
  watchDirOf,
  writeAutosyncHook,
} from '../src/autosync';

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'plandrop-hook-'));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

interface Settings {
  hooks?: {
    PostToolUse?: {
      matcher?: string;
      hooks?: { command?: string; type?: string; statusMessage?: string }[];
    }[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

describe('normalizeWatchGlob', () => {
  it('defaults empty input', () => {
    expect(normalizeWatchGlob('')).toBe(DEFAULT_WATCH_GLOB);
    expect(normalizeWatchGlob('  ')).toBe(DEFAULT_WATCH_GLOB);
  });

  it('watches HTML at any depth below a bare directory', () => {
    expect(normalizeWatchGlob('plans')).toBe('plans/**/*.html');
    expect(normalizeWatchGlob('./plans/')).toBe('plans/**/*.html');
  });

  it('keeps an explicit glob as given', () => {
    expect(normalizeWatchGlob('docs/**/*.html')).toBe('docs/**/*.html');
    expect(normalizeWatchGlob('docs/*.html')).toBe('docs/*.html');
    expect(normalizeWatchGlob('a/b/*.html')).toBe('a/b/*.html');
  });

  it('defaults to watching HTML at any depth under docs', () => {
    expect(DEFAULT_WATCH_GLOB).toBe('docs/**/*.html');
  });
});

describe('watchDirOf', () => {
  it('takes the directory below a recursive glob', () => {
    expect(watchDirOf('docs/**/*.html')).toBe('docs');
  });

  it('takes the directory below a flat glob', () => {
    expect(watchDirOf('plans/*.html')).toBe('plans');
  });

  it('takes a nested directory', () => {
    expect(watchDirOf('a/b/*.html')).toBe('a/b');
  });

  it('reports no directory for a root-level glob', () => {
    expect(watchDirOf('*.html')).toBe('');
  });
});

describe('normalizeHookRoot / publishRootMode', () => {
  it('trims the same way a watch path is trimmed', () => {
    expect(normalizeHookRoot('./docs/')).toBe('docs');
    expect(normalizeHookRoot('/plans/')).toBe('plans');
  });

  it('collapses an empty root to the mirror mode', () => {
    expect(publishRootMode('')).toEqual(MIRROR_MODE);
    expect(publishRootMode('   ')).toEqual(MIRROR_MODE);
  });

  it('names a root mode for a real directory', () => {
    expect(publishRootMode('docs')).toEqual({ kind: 'root', dir: 'docs' });
  });
});

describe('modeFromConfig', () => {
  it('reports nothing when the config names no mode', () => {
    expect(modeFromConfig({})).toBeUndefined();
  });

  it('reconstructs mirror and flat directly', () => {
    expect(modeFromConfig({ hookPublish: 'mirror' })).toEqual(MIRROR_MODE);
    expect(modeFromConfig({ hookPublish: 'flat' })).toEqual(FLAT_MODE);
  });

  it('reconstructs root from hookPublish + localRoot', () => {
    expect(modeFromConfig({ hookPublish: 'root', localRoot: 'docs' })).toEqual({
      kind: 'root',
      dir: 'docs',
    });
  });
});

describe('hookConfigPatch', () => {
  it('records the normalized glob and mode kind', () => {
    expect(hookConfigPatch('plans', MIRROR_MODE)).toEqual({
      hookWatch: 'plans/**/*.html',
      hookPublish: 'mirror',
      localRoot: undefined,
    });
  });

  it('records the root directory only in root mode', () => {
    expect(hookConfigPatch(DEFAULT_WATCH_GLOB, { kind: 'root', dir: 'docs' })).toEqual({
      hookWatch: DEFAULT_WATCH_GLOB,
      hookPublish: 'root',
      localRoot: 'docs',
    });
  });

  it('clears localRoot (rather than omitting it) outside root mode', () => {
    expect(hookConfigPatch(DEFAULT_WATCH_GLOB, FLAT_MODE).localRoot).toBeUndefined();
    expect(Object.keys(hookConfigPatch(DEFAULT_WATCH_GLOB, FLAT_MODE))).toContain('localRoot');
  });
});

describe('publishModePrompt / parsePublishAnswer', () => {
  it('marks the default option and shows its letter as the bracket default', () => {
    expect(publishModePrompt(MIRROR_MODE, 'docs')).toContain('[m]irroring the project path (default)');
    expect(publishModePrompt(MIRROR_MODE, 'docs')).toMatch(/\[m\]: $/);
    expect(publishModePrompt({ kind: 'root', dir: 'docs' }, 'docs')).toContain(
      '[r]elative to docs (default)',
    );
    expect(publishModePrompt(FLAT_MODE, 'docs')).toContain('[f]lat at the host root (default)');
  });

  it('picks a mode from its letter regardless of the default', () => {
    expect(parsePublishAnswer('m', FLAT_MODE, 'docs')).toEqual(MIRROR_MODE);
    expect(parsePublishAnswer('mirror', FLAT_MODE, 'docs')).toEqual(MIRROR_MODE);
    expect(parsePublishAnswer('f', MIRROR_MODE, 'docs')).toEqual(FLAT_MODE);
    expect(parsePublishAnswer('r', MIRROR_MODE, 'docs')).toEqual({ kind: 'root', dir: 'docs' });
  });

  it('falls to the default on a bare Enter, a closed prompt, or gibberish', () => {
    expect(parsePublishAnswer('', FLAT_MODE, 'docs')).toEqual(FLAT_MODE);
    expect(parsePublishAnswer(undefined, FLAT_MODE, 'docs')).toEqual(FLAT_MODE);
    expect(parsePublishAnswer('whatever', MIRROR_MODE, 'docs')).toEqual(MIRROR_MODE);
  });
});

describe('describeMode', () => {
  it('labels each mode plainly', () => {
    expect(describeMode(MIRROR_MODE)).toBe('mirrors the project path');
    expect(describeMode({ kind: 'root', dir: 'docs' })).toBe('relative to docs');
    expect(describeMode(FLAT_MODE)).toBe('flat at the host root');
  });
});

describe('autosyncCommand', () => {
  it('matches the proven hook shape for the default glob (mirror, the silent default)', () => {
    const command = autosyncCommand(DEFAULT_WATCH_GLOB);
    expect(command).toBe(
      'jq -r \'.tool_input.file_path // .tool_response.filePath\' | ' +
        '{ read -r f; case "$f" in */docs/*.html) ' +
        'cd "${CLAUDE_PROJECT_DIR:-.}" && npx -y plandrop upload "${f#"$PWD"/}";; esac; } ' +
        '2>/dev/null || true',
    );
    expect(autosyncCommand(DEFAULT_WATCH_GLOB, MIRROR_MODE)).toBe(command);
  });

  it('uploads the saved file by its project-relative path, not a flat basename', () => {
    const command = autosyncCommand('plans/**/*.html');
    expect(command).toContain('plandrop upload "${f#"$PWD"/}"');
    expect(command).not.toContain('basename');
  });

  it('drops the recursive marker from the case gate, which already spans /', () => {
    expect(autosyncCommand('docs/**/*.html')).toContain('case "$f" in */docs/*.html)');
    expect(autosyncCommand('**/*.html')).toContain('case "$f" in */*.html)');
  });

  it('gates on a root glob without a directory', () => {
    expect(autosyncCommand('*.html')).toContain('case "$f" in */*.html)');
  });

  it('cds into the project root + dir in root mode', () => {
    const command = autosyncCommand(DEFAULT_WATCH_GLOB, { kind: 'root', dir: 'docs' });
    expect(command).toContain('cd "${CLAUDE_PROJECT_DIR:-.}/docs" && npx -y plandrop upload "${f#"$PWD"/}"');
  });

  it('cds into the saved file\'s own directory in flat mode', () => {
    const command = autosyncCommand(DEFAULT_WATCH_GLOB, FLAT_MODE);
    expect(command).toContain('cd "$(dirname "$f")" && npx -y plandrop upload "${f#"$PWD"/}"');
  });
});

describe('mergeAutosyncHook', () => {
  it('yields valid settings with the hook from nothing', () => {
    const { json, outcome } = mergeAutosyncHook(undefined, DEFAULT_WATCH_GLOB);
    expect(outcome).toBe('added');
    const settings = JSON.parse(json) as Settings;
    const entry = settings.hooks?.PostToolUse?.[0];
    expect(entry?.matcher).toBe('Write|Edit');
    expect(entry?.hooks?.[0]?.type).toBe('command');
    expect(entry?.hooks?.[0]?.command).toBe(autosyncCommand(DEFAULT_WATCH_GLOB));
    expect(entry?.hooks?.[0]?.statusMessage).toBe('Publishing to plandrop…');
  });

  it('preserves existing settings and hooks when merging', () => {
    const existing = JSON.stringify({
      model: 'opus',
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'echo hi' }] }],
        PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo bash' }] }],
      },
    });
    const { json, outcome } = mergeAutosyncHook(existing, DEFAULT_WATCH_GLOB);
    expect(outcome).toBe('added');
    const settings = JSON.parse(json) as Settings;
    expect(settings.model).toBe('opus');
    expect(settings.hooks?.SessionStart).toBeDefined();
    const post = settings.hooks?.PostToolUse ?? [];
    expect(post).toHaveLength(2);
    expect(post[0]?.matcher).toBe('Bash');
    expect(post[1]?.matcher).toBe('Write|Edit');
  });

  it('appends to an existing Write|Edit matcher group', () => {
    const existing = JSON.stringify({
      hooks: {
        PostToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'echo x' }] }],
      },
    });
    const settings = JSON.parse(mergeAutosyncHook(existing, DEFAULT_WATCH_GLOB).json) as Settings;
    const post = settings.hooks?.PostToolUse ?? [];
    expect(post).toHaveLength(1);
    expect(post[0]?.hooks).toHaveLength(2);
  });

  it('reports nothing added when an equivalent hook exists', () => {
    const first = mergeAutosyncHook(undefined, DEFAULT_WATCH_GLOB).json;
    const second = mergeAutosyncHook(first, DEFAULT_WATCH_GLOB);
    expect(second.outcome).toBe('unchanged');
    expect(JSON.parse(second.json)).toEqual(JSON.parse(first));
  });

  it('throws on malformed existing JSON rather than clobbering it', () => {
    expect(() => mergeAutosyncHook('not json', DEFAULT_WATCH_GLOB)).toThrow();
  });

  describe('upgrade by fingerprint', () => {
    it('recognizes a hand-rolled 0.3.0-era hook by its status message, not its text', () => {
      // An early shape that re-prefixed the watched directory itself instead of
      // relying on upload's own cwd-relative mirroring — structurally nothing
      // like today's generated command, but still plandrop's hook.
      const oldCommand =
        'jq -r \'.tool_input.file_path\' | { read -r f; case "$f" in */docs/*.html) ' +
        'npx -y plandrop upload "docs/${f#*/docs/}";; esac; } 2>/dev/null || true';
      const existing = JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: 'Write|Edit',
              hooks: [
                { type: 'command', command: oldCommand, timeout: 60, statusMessage: 'Publishing to plandrop…' },
              ],
            },
          ],
        },
      });

      const result = mergeAutosyncHook(existing, DEFAULT_WATCH_GLOB);
      expect(result.outcome).toBe('replaced');
      expect(result.change?.root.from).toBe('custom (no cd)');
      expect(result.change?.root.to).toBe(describeMode(MIRROR_MODE));

      const settings = JSON.parse(result.json) as Settings;
      const post = settings.hooks?.PostToolUse ?? [];
      expect(post).toHaveLength(1);
      expect(post[0]?.hooks).toHaveLength(1);
      expect(post[0]?.hooks?.[0]?.command).toBe(autosyncCommand(DEFAULT_WATCH_GLOB));
    });

    it('recognizes a hook by its command mentioning plandrop upload even without the status message', () => {
      const existing = JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: 'Write|Edit',
              hooks: [{ type: 'command', command: 'npx -y plandrop upload "$f"', timeout: 30 }],
            },
          ],
        },
      });
      expect(mergeAutosyncHook(existing, DEFAULT_WATCH_GLOB).outcome).toBe('replaced');
    });

    it('is a no-op when the recognized hook already matches exactly', () => {
      const installed = mergeAutosyncHook(undefined, DEFAULT_WATCH_GLOB, { kind: 'root', dir: 'docs' }).json;
      const again = mergeAutosyncHook(installed, DEFAULT_WATCH_GLOB, { kind: 'root', dir: 'docs' });
      expect(again.outcome).toBe('unchanged');
    });

    it('replaces a different mode in place rather than adding a second hook', () => {
      const mirrorInstalled = mergeAutosyncHook(undefined, DEFAULT_WATCH_GLOB, MIRROR_MODE).json;
      const upgraded = mergeAutosyncHook(mirrorInstalled, DEFAULT_WATCH_GLOB, { kind: 'root', dir: 'docs' });
      expect(upgraded.outcome).toBe('replaced');
      expect(upgraded.change).toEqual({
        watch: { from: '*/docs/*.html', to: '*/docs/*.html' },
        root: { from: '${CLAUDE_PROJECT_DIR:-.}', to: 'relative to docs' },
      });
      const settings = JSON.parse(upgraded.json) as Settings;
      const post = settings.hooks?.PostToolUse ?? [];
      expect(post).toHaveLength(1);
      expect(post[0]?.hooks).toHaveLength(1);
      expect(post[0]?.hooks?.[0]?.command).toBe(autosyncCommand(DEFAULT_WATCH_GLOB, { kind: 'root', dir: 'docs' }));
    });

    it('never leaves two plandrop hooks behind, even if duplicates existed', () => {
      const existing = JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: 'Write|Edit',
              hooks: [
                { type: 'command', command: 'npx -y plandrop upload "a"', statusMessage: 'Publishing to plandrop…' },
                { type: 'command', command: 'echo unrelated' },
                { type: 'command', command: 'npx -y plandrop upload "b"', statusMessage: 'Publishing to plandrop…' },
              ],
            },
          ],
        },
      });
      const result = mergeAutosyncHook(existing, DEFAULT_WATCH_GLOB);
      expect(result.outcome).toBe('replaced');
      const settings = JSON.parse(result.json) as Settings;
      const hooks = settings.hooks?.PostToolUse?.[0]?.hooks ?? [];
      expect(hooks).toHaveLength(2);
      expect(hooks.filter((hook) => hook.command?.includes('plandrop upload'))).toHaveLength(1);
      expect(hooks.some((hook) => hook.command === 'echo unrelated')).toBe(true);
    });
  });
});

describe('writeAutosyncHook', () => {
  it('creates .claude/settings.json when absent', () => {
    const { path, outcome } = writeAutosyncHook(workdir, DEFAULT_WATCH_GLOB);
    expect(outcome).toBe('added');
    expect(path).toBe(join(workdir, '.claude', 'settings.json'));
    const settings = JSON.parse(readFileSync(path, 'utf8')) as Settings;
    expect(settings.hooks?.PostToolUse?.[0]?.matcher).toBe('Write|Edit');
  });

  it('leaves the file untouched when the hook is already present', () => {
    writeAutosyncHook(workdir, DEFAULT_WATCH_GLOB);
    const path = join(workdir, '.claude', 'settings.json');
    const before = readFileSync(path, 'utf8');
    const again = writeAutosyncHook(workdir, DEFAULT_WATCH_GLOB);
    expect(again.outcome).toBe('unchanged');
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('merges alongside an operator-authored settings file', () => {
    mkdirSync(join(workdir, '.claude'));
    writeFileSync(join(workdir, '.claude', 'settings.json'), JSON.stringify({ env: { A: '1' } }));
    const { outcome } = writeAutosyncHook(workdir, 'plans/*.html');
    expect(outcome).toBe('added');
    const settings = JSON.parse(
      readFileSync(join(workdir, '.claude', 'settings.json'), 'utf8'),
    ) as Settings;
    expect(settings.env).toEqual({ A: '1' });
    expect(settings.hooks?.PostToolUse?.[0]?.hooks?.[0]?.command).toContain(
      'case "$f" in */plans/*.html)',
    );
  });

  it('rewrites the file when upgrading a different mode', () => {
    writeAutosyncHook(workdir, DEFAULT_WATCH_GLOB, MIRROR_MODE);
    const { outcome, change } = writeAutosyncHook(workdir, DEFAULT_WATCH_GLOB, FLAT_MODE);
    expect(outcome).toBe('replaced');
    expect(change?.root.to).toBe('flat at the host root');
    const settings = JSON.parse(
      readFileSync(join(workdir, '.claude', 'settings.json'), 'utf8'),
    ) as Settings;
    expect(settings.hooks?.PostToolUse?.[0]?.hooks?.[0]?.command).toBe(
      autosyncCommand(DEFAULT_WATCH_GLOB, FLAT_MODE),
    );
  });
});

describe('describeHookOutcome', () => {
  it('describes a fresh install, naming the mode only when it is not the silent default', () => {
    expect(describeHookOutcome('/p/.claude/settings.json', DEFAULT_WATCH_GLOB, MIRROR_MODE, 'added', undefined)).toBe(
      'wrote /p/.claude/settings.json — saving a file matching docs/**/*.html now auto-publishes it\n',
    );
    expect(
      describeHookOutcome('/p/.claude/settings.json', DEFAULT_WATCH_GLOB, FLAT_MODE, 'added', undefined),
    ).toContain('(flat at the host root)');
  });

  it('describes a no-op', () => {
    expect(describeHookOutcome('/p/.claude/settings.json', DEFAULT_WATCH_GLOB, MIRROR_MODE, 'unchanged', undefined)).toBe(
      'an equivalent hook is already in /p/.claude/settings.json; nothing changed\n',
    );
  });

  it('describes a replace with the old->new watch/root change', () => {
    const change = { watch: { from: 'a', to: 'b' }, root: { from: 'c', to: 'd' } };
    const message = describeHookOutcome('/p/.claude/settings.json', DEFAULT_WATCH_GLOB, MIRROR_MODE, 'replaced', change);
    expect(message).toContain('watch: a → b');
    expect(message).toContain('root:  c → d');
  });
});

/**
 * The generated shell is POSIX and is proven here by actually running it — a
 * fake `npx` on PATH records the cwd and args `plandrop upload` was invoked
 * with (or that it was never invoked), across sh/bash/zsh and every mode, for
 * a nested save, a top-level save, a save outside the configured root, and a
 * non-watched file.
 */
describe('the generated shell, run for real', () => {
  const shells = (['sh', 'bash', 'zsh'] as const).filter((shell) => hasBinary(shell));
  if (shells.length === 0) {
    it.skip('no POSIX shell found on PATH', () => {});
    return;
  }

  let projectDir: string;
  let binDir: string;
  let resultsFile: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'plandrop-shell-project-'));
    binDir = mkdtempSync(join(tmpdir(), 'plandrop-shell-bin-'));
    resultsFile = join(mkdtempSync(join(tmpdir(), 'plandrop-shell-out-')), 'results.txt');
    writeFileSync(resultsFile, '');
    // A stand-in for the real `npx -y plandrop upload <path>`: records the
    // shell's cwd and its own argv rather than touching the network.
    const fakeNpx = `#!/bin/sh\n{ printf 'PWD=%s\\n' "$PWD"; printf 'ARGS=%s\\n' "$*"; } >> "$RESULTS_FILE"\n`;
    writeFileSync(join(binDir, 'npx'), fakeNpx, { mode: 0o755 });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
    rmSync(join(resultsFile, '..'), { recursive: true, force: true });
  });

  function run(shell: string, command: string, savedFile: string): string {
    writeFileSync(resultsFile, '');
    execFileSync(shell, ['-c', command], {
      input: JSON.stringify({ tool_input: { file_path: savedFile } }),
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, CLAUDE_PROJECT_DIR: projectDir, RESULTS_FILE: resultsFile },
    });
    return readFileSync(resultsFile, 'utf8');
  }

  for (const shell of shells) {
    describe(shell, () => {
      it('mirror mode: uploads a nested save by its project-relative path', () => {
        const file = join(projectDir, 'docs', 'plans', 'x.html');
        mkdirSync(join(projectDir, 'docs', 'plans'), { recursive: true });
        const out = run(shell, autosyncCommand(DEFAULT_WATCH_GLOB, MIRROR_MODE), file);
        expect(out).toContain(`PWD=${projectDir}`);
        expect(out).toContain('ARGS=-y plandrop upload docs/plans/x.html');
      });

      it('mirror mode: uploads a top-level save by its project-relative path', () => {
        const file = join(projectDir, 'docs', 'y.html');
        mkdirSync(join(projectDir, 'docs'), { recursive: true });
        const out = run(shell, autosyncCommand(DEFAULT_WATCH_GLOB, MIRROR_MODE), file);
        expect(out).toContain('ARGS=-y plandrop upload docs/y.html');
      });

      it('mirror mode: skips a file that does not match the watch glob', () => {
        const file = join(projectDir, 'docs', 'data.json');
        const out = run(shell, autosyncCommand(DEFAULT_WATCH_GLOB, MIRROR_MODE), file);
        expect(out).toBe('');
      });

      it('root mode: publishes relative to the configured root, not the project', () => {
        const file = join(projectDir, 'docs', 'plans', 'x.html');
        mkdirSync(join(projectDir, 'docs', 'plans'), { recursive: true });
        const out = run(shell, autosyncCommand('**/*.html', { kind: 'root', dir: 'docs' }), file);
        expect(out).toContain(`PWD=${join(projectDir, 'docs')}`);
        expect(out).toContain('ARGS=-y plandrop upload plans/x.html');
      });

      it('root mode: a save outside the configured root keeps its full path (upload\'s own fallback applies)', () => {
        // The root dir itself must exist for `cd` to succeed — a save outside
        // it doesn't mean the root is missing, just that this particular file
        // isn't under it.
        mkdirSync(join(projectDir, 'docs'), { recursive: true });
        const file = join(projectDir, 'notes.html');
        const out = run(shell, autosyncCommand('**/*.html', { kind: 'root', dir: 'docs' }), file);
        // The shell couldn't strip $PWD/ (the file isn't under it), so the
        // full path is passed through unchanged — upload.ts's own
        // cwd-relative mirroring is what falls back to a bare basename.
        expect(out).toContain(`ARGS=-y plandrop upload ${file}`);
      });

      it('flat mode: a nested save publishes by its own basename', () => {
        const file = join(projectDir, 'docs', 'plans', 'x.html');
        mkdirSync(join(projectDir, 'docs', 'plans'), { recursive: true });
        const out = run(shell, autosyncCommand(DEFAULT_WATCH_GLOB, FLAT_MODE), file);
        expect(out).toContain(`PWD=${join(projectDir, 'docs', 'plans')}`);
        expect(out).toContain('ARGS=-y plandrop upload x.html');
      });

      it('flat mode: a top-level save also publishes by its own basename', () => {
        const file = join(projectDir, 'docs', 'y.html');
        mkdirSync(join(projectDir, 'docs'), { recursive: true });
        const out = run(shell, autosyncCommand(DEFAULT_WATCH_GLOB, FLAT_MODE), file);
        expect(out).toContain('ARGS=-y plandrop upload y.html');
      });

      it('flat mode: skips a file that does not match the watch glob', () => {
        const file = join(projectDir, 'docs', 'data.json');
        const out = run(shell, autosyncCommand(DEFAULT_WATCH_GLOB, FLAT_MODE), file);
        expect(out).toBe('');
      });
    });
  }
});

function hasBinary(name: string): boolean {
  try {
    execFileSync('which', [name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
