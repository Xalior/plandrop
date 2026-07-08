import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  autosyncCommand,
  DEFAULT_WATCH_GLOB,
  mergeAutosyncHook,
  normalizeWatchGlob,
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
    PostToolUse?: { matcher?: string; hooks?: { command?: string; type?: string }[] }[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

describe('normalizeWatchGlob', () => {
  it('defaults empty input', () => {
    expect(normalizeWatchGlob('')).toBe(DEFAULT_WATCH_GLOB);
    expect(normalizeWatchGlob('  ')).toBe(DEFAULT_WATCH_GLOB);
  });

  it('turns a bare directory into its HTML glob', () => {
    expect(normalizeWatchGlob('plans')).toBe('plans/*.html');
    expect(normalizeWatchGlob('./plans/')).toBe('plans/*.html');
  });

  it('keeps an explicit glob as given', () => {
    expect(normalizeWatchGlob('docs/*.html')).toBe('docs/*.html');
    expect(normalizeWatchGlob('a/b/*.html')).toBe('a/b/*.html');
  });
});

describe('autosyncCommand', () => {
  it('matches the proven hook shape for the default glob', () => {
    const command = autosyncCommand(DEFAULT_WATCH_GLOB);
    expect(command).toBe(
      'jq -r \'.tool_input.file_path // .tool_response.filePath\' | ' +
        '{ read -r f; case "$f" in */docs/*.html) ' +
        'cd "${CLAUDE_PROJECT_DIR:-.}" && npx -y plandrop upload "docs/$(basename "$f")";; esac; } ' +
        '2>/dev/null || true',
    );
  });

  it('uploads at the top level for a root glob', () => {
    const command = autosyncCommand('*.html');
    expect(command).toContain('case "$f" in */*.html)');
    expect(command).toContain('plandrop upload "$(basename "$f")"');
  });
});

describe('mergeAutosyncHook', () => {
  it('yields valid settings with the hook from nothing', () => {
    const { json, added } = mergeAutosyncHook(undefined, DEFAULT_WATCH_GLOB);
    expect(added).toBe(true);
    const settings = JSON.parse(json) as Settings;
    const entry = settings.hooks?.PostToolUse?.[0];
    expect(entry?.matcher).toBe('Write|Edit');
    expect(entry?.hooks?.[0]?.type).toBe('command');
    expect(entry?.hooks?.[0]?.command).toBe(autosyncCommand(DEFAULT_WATCH_GLOB));
  });

  it('preserves existing settings and hooks when merging', () => {
    const existing = JSON.stringify({
      model: 'opus',
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'echo hi' }] }],
        PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo bash' }] }],
      },
    });
    const { json, added } = mergeAutosyncHook(existing, DEFAULT_WATCH_GLOB);
    expect(added).toBe(true);
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
    expect(second.added).toBe(false);
    expect(JSON.parse(second.json)).toEqual(JSON.parse(first));
  });

  it('throws on malformed existing JSON rather than clobbering it', () => {
    expect(() => mergeAutosyncHook('not json', DEFAULT_WATCH_GLOB)).toThrow();
  });
});

describe('writeAutosyncHook', () => {
  it('creates .claude/settings.json when absent', () => {
    const { path, added } = writeAutosyncHook(workdir, DEFAULT_WATCH_GLOB);
    expect(added).toBe(true);
    expect(path).toBe(join(workdir, '.claude', 'settings.json'));
    const settings = JSON.parse(readFileSync(path, 'utf8')) as Settings;
    expect(settings.hooks?.PostToolUse?.[0]?.matcher).toBe('Write|Edit');
  });

  it('leaves the file untouched when the hook is already present', () => {
    writeAutosyncHook(workdir, DEFAULT_WATCH_GLOB);
    const path = join(workdir, '.claude', 'settings.json');
    const before = readFileSync(path, 'utf8');
    const again = writeAutosyncHook(workdir, DEFAULT_WATCH_GLOB);
    expect(again.added).toBe(false);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('merges alongside an operator-authored settings file', () => {
    mkdirSync(join(workdir, '.claude'));
    writeFileSync(join(workdir, '.claude', 'settings.json'), JSON.stringify({ env: { A: '1' } }));
    const { added } = writeAutosyncHook(workdir, 'plans/*.html');
    expect(added).toBe(true);
    const settings = JSON.parse(
      readFileSync(join(workdir, '.claude', 'settings.json'), 'utf8'),
    ) as Settings;
    expect(settings.env).toEqual({ A: '1' });
    expect(settings.hooks?.PostToolUse?.[0]?.hooks?.[0]?.command).toContain('plans/$(basename "$f")');
  });
});
