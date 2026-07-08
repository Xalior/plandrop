import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The Claude Code autosync hook: a PostToolUse hook on Write|Edit that
 * republishes a saved HTML document via `plandrop upload` when it lands under
 * the watched path — the publish-on-every-change loop a person otherwise runs
 * by hand. Scaffolded (opt-in) by `create`; merged into the project's
 * .claude/settings.json without disturbing other settings or hooks.
 */

export const DEFAULT_WATCH_GLOB = 'docs/*.html';

/** The hook command entry shape Claude Code expects. */
interface HookCommand {
  type: 'command';
  command: string;
  timeout: number;
  statusMessage: string;
}

/** One PostToolUse matcher group: a tool-name pattern and its hooks. */
interface HookMatcher {
  matcher?: unknown;
  hooks?: unknown;
}

/**
 * Normalize a user-supplied watch path to a `<dir>/<pattern>` glob. A bare
 * directory (no wildcard, no extension) watches its HTML files; leading `./`
 * and stray slashes are trimmed; empty input means the default.
 */
export function normalizeWatchGlob(input: string): string {
  const trimmed = input
    .trim()
    .replace(/^\.\//, '')
    .replace(/^\/+|\/+$/g, '');
  if (trimmed === '') {
    return DEFAULT_WATCH_GLOB;
  }
  const last = trimmed.split('/').pop() ?? '';
  if (!last.includes('*') && !last.includes('.')) {
    return `${trimmed}/*.html`;
  }
  return trimmed;
}

/**
 * The shell command the hook runs: read the saved file's path from the hook
 * payload, and if it matches the watched glob, upload it under the watched
 * directory. The trailing `|| true` keeps a failed publish from failing the
 * edit; jq extracts the path (Write reports tool_input.file_path, Edit's
 * response carries filePath).
 */
export function autosyncCommand(watchGlob: string): string {
  const glob = normalizeWatchGlob(watchGlob);
  const slash = glob.lastIndexOf('/');
  const dir = slash === -1 ? '' : glob.slice(0, slash);
  const casePattern = `*/${glob}`;
  const uploadPath = dir === '' ? '$(basename "$f")' : `${dir}/$(basename "$f")`;
  return (
    `jq -r '.tool_input.file_path // .tool_response.filePath' | ` +
    `{ read -r f; case "$f" in ${casePattern}) ` +
    `cd "\${CLAUDE_PROJECT_DIR:-.}" && npx -y plandrop upload "${uploadPath}";; esac; } ` +
    `2>/dev/null || true`
  );
}

/**
 * Merge the autosync hook into a settings.json body, preserving every existing
 * setting and hook. Returns the merged JSON and whether anything was added —
 * an equivalent hook (same command) already present means nothing to do.
 * Malformed existing JSON throws: the caller must not clobber a file a human
 * needs to look at.
 */
export function mergeAutosyncHook(
  existingJson: string | undefined,
  watchGlob: string,
): { json: string; added: boolean } {
  const settings =
    existingJson === undefined || existingJson.trim() === ''
      ? {}
      : (JSON.parse(existingJson) as Record<string, unknown>);
  const command = autosyncCommand(watchGlob);

  const hooks = isRecord(settings.hooks) ? settings.hooks : {};
  const post = Array.isArray(hooks.PostToolUse) ? (hooks.PostToolUse as HookMatcher[]) : [];

  if (post.some((entry) => hasCommand(entry, command))) {
    return { json: `${JSON.stringify(settings, null, 2)}\n`, added: false };
  }

  const hookEntry: HookCommand = {
    type: 'command',
    command,
    timeout: 120,
    statusMessage: 'Publishing to plandrop…',
  };

  const writeEdit = post.find(
    (entry) => entry.matcher === 'Write|Edit' && Array.isArray(entry.hooks),
  );
  if (writeEdit !== undefined) {
    (writeEdit.hooks as unknown[]).push(hookEntry);
  } else {
    post.push({ matcher: 'Write|Edit', hooks: [hookEntry] });
  }

  hooks.PostToolUse = post;
  settings.hooks = hooks;
  return { json: `${JSON.stringify(settings, null, 2)}\n`, added: true };
}

/**
 * Merge the autosync hook into `<projectDir>/.claude/settings.json`, creating
 * the directory and file as needed. Reports the path and whether the hook was
 * added (false = an equivalent one was already there; the file is untouched).
 */
export function writeAutosyncHook(
  projectDir: string,
  watchGlob: string,
): { path: string; added: boolean } {
  const dir = join(projectDir, '.claude');
  const path = join(dir, 'settings.json');
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  const { json, added } = mergeAutosyncHook(existing, watchGlob);
  if (added) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, json);
  }
  return { path, added };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasCommand(entry: HookMatcher, command: string): boolean {
  if (!Array.isArray(entry.hooks)) {
    return false;
  }
  return entry.hooks.some(
    (hook: unknown) => isRecord(hook) && hook.command === command,
  );
}
