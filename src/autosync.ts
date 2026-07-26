import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promptLine } from './prompt';
import type { DotfileConfig } from './dotfile';

/**
 * The Claude Code autosync hook: a PostToolUse hook on Write|Edit that
 * republishes a saved HTML document via `plandrop upload` when it lands under
 * the watched path — the publish-on-every-change loop a person otherwise runs
 * by hand. Offered by `create` and installed on demand by `hooks`; merged into
 * the project's .claude/settings.json without disturbing other settings or
 * hooks, and recognised on a later run by a durable fingerprint rather than
 * exact text so an upgrade can replace an older shape in place. This module
 * also holds the publish-root modes the generated hook can run under and the
 * shared prompting/recording logic `create` and `hooks` both use to choose
 * and remember them.
 */

export const DEFAULT_WATCH_GLOB = 'docs/**/*.html';

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
 * directory (no wildcard, no extension) watches its HTML files at any depth;
 * leading `./` and stray slashes are trimmed; empty input means the default.
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
    return `${trimmed}/**/*.html`;
  }
  return trimmed;
}

/**
 * The directory portion of a normalized watch glob, e.g. `docs` for
 * `docs/**\/*.html` or `a/b` for `a/b/*.html`. `''` means the glob has no
 * directory of its own (e.g. `*.html`) — there is nothing to be "relative to"
 * below the project root.
 */
export function watchDirOf(glob: string): string {
  const segments = glob.split('/');
  segments.pop();
  if (segments[segments.length - 1] === '**') {
    segments.pop();
  }
  return segments.join('/');
}

/**
 * The three publish-root shapes the generated hook can run under. The root is
 * always the directory the hook `cd`s into before calling `upload`, whose own
 * cwd-relative mirroring places the file — this module only ever decides
 * *where to cd*, never how the upload itself resolves a remote path.
 *  - `mirror`: the project root — the silent default, unchanged since this
 *    hook's first shape.
 *  - `root`: a fixed directory under the project root (`--local-root <dir>`).
 *  - `flat`: the saved file's own directory, recomputed on every run
 *    (`--hook-flat`) — the file always lands at the host root by basename.
 */
export type PublishMode = { kind: 'mirror' } | { kind: 'root'; dir: string } | { kind: 'flat' };

export const MIRROR_MODE: PublishMode = { kind: 'mirror' };
export const FLAT_MODE: PublishMode = { kind: 'flat' };

/**
 * Normalize a `--local-root` value the same way a watch path is trimmed:
 * leading `./` and stray slashes gone. Unlike a watch glob, an empty result is
 * not defaulted to anything of its own — `publishRootMode` treats it as "no
 * root", collapsing to the mirror mode.
 */
export function normalizeHookRoot(input: string): string {
  return input.trim().replace(/^\.\//, '').replace(/^\/+|\/+$/g, '');
}

/**
 * The `root` mode for a given directory — or the `mirror` mode, when the
 * directory normalizes to nothing (an empty `--local-root`, or a watch glob
 * with no directory of its own used as the interactive default).
 */
export function publishRootMode(dir: string): PublishMode {
  const normalized = normalizeHookRoot(dir);
  return normalized === '' ? MIRROR_MODE : { kind: 'root', dir: normalized };
}

/** A human label for a mode, used in status lines and the replace-diff. */
export function describeMode(mode: PublishMode): string {
  if (mode.kind === 'root') {
    return `relative to ${mode.dir}`;
  }
  return mode.kind === 'flat' ? 'flat at the host root' : 'mirrors the project path';
}

/** The recorded `.plandrop` fields this module reads back as defaults. */
type RecordedHookConfig = Pick<DotfileConfig, 'hookPublish' | 'localRoot'>;

/** The mode a recorded `.plandrop` names, or undefined if it names none. */
export function modeFromConfig(config: RecordedHookConfig): PublishMode | undefined {
  if (config.hookPublish === 'flat') {
    return FLAT_MODE;
  }
  if (config.hookPublish === 'root') {
    return publishRootMode(config.localRoot ?? '');
  }
  return config.hookPublish === 'mirror' ? MIRROR_MODE : undefined;
}

/**
 * The `.plandrop` patch that records a chosen watch glob + publish mode, for
 * the merge in dotfile.ts. `localRoot` is explicitly cleared (not merely
 * omitted) when the mode isn't `root`, so switching away from `--local-root`
 * doesn't leave a stale directory behind once `hookPublish` no longer names it.
 */
export function hookConfigPatch(watchGlob: string, mode: PublishMode): DotfileConfig {
  return {
    hookWatch: normalizeWatchGlob(watchGlob),
    hookPublish: mode.kind,
    localRoot: mode.kind === 'root' ? mode.dir : undefined,
  };
}

const PROJECT_DIR_EXPR = '${CLAUDE_PROJECT_DIR:-.}';

/** The directory the generated hook `cd`s into for a given mode. */
function cdTargetFor(mode: PublishMode): string {
  if (mode.kind === 'flat') {
    return '$(dirname "$f")';
  }
  return mode.kind === 'root' ? `${PROJECT_DIR_EXPR}/${mode.dir}` : PROJECT_DIR_EXPR;
}

interface HookShape {
  command: string;
  casePattern: string;
  cdTarget: string;
}

/**
 * The shell command the hook runs: read the saved file's path from the hook
 * payload, and if it matches the watched glob, `cd` to the mode's root and
 * upload the file by its path relative to that root — `upload` mirrors that
 * path remotely, so a document publishes where the root places it. A save
 * whose path doesn't fall under the root (or, for `mirror`/`root`, isn't under
 * the project at all) keeps its unstripped path, which `upload` itself falls
 * back to publishing by bare basename. The trailing `|| true` keeps a failed
 * publish from failing the edit; jq extracts the path (Write reports
 * tool_input.file_path, Edit's response carries filePath).
 */
function buildHookShape(watchGlob: string, mode: PublishMode): HookShape {
  const glob = normalizeWatchGlob(watchGlob);
  // `*` spans `/` in a shell case pattern, so a recursive `**/` marker is
  // redundant there — dropping it keeps a file directly in the watched
  // directory matching as well as one nested below it.
  const casePattern = `*/${glob.replace(/\*\*\//g, '')}`;
  const cdTarget = cdTargetFor(mode);
  const command =
    `jq -r '.tool_input.file_path // .tool_response.filePath' | ` +
    `{ read -r f; case "$f" in ${casePattern}) ` +
    `cd "${cdTarget}" && npx -y plandrop upload "\${f#"$PWD"/}";; esac; } ` +
    `2>/dev/null || true`;
  return { command, casePattern, cdTarget };
}

/** The generated hook command for a watch glob and publish mode (default: mirror). */
export function autosyncCommand(watchGlob: string, mode: PublishMode = MIRROR_MODE): string {
  return buildHookShape(watchGlob, mode).command;
}

const PLANDROP_STATUS_MESSAGE = 'Publishing to plandrop…';

function hookEntry(command: string): HookCommand {
  return { type: 'command', command, timeout: 120, statusMessage: PLANDROP_STATUS_MESSAGE };
}

/**
 * True for any PostToolUse hook this tool could have installed, however it is
 * shaped: the fingerprint is the status line plandrop always sets and/or a
 * command that invokes `plandrop upload`, not equality against the exact
 * command plandrop would generate today. A hand-rolled or older-format hook —
 * say, one that re-prefixes the watched directory itself rather than relying
 * on `upload`'s own cwd-relative mirroring — still matches, so an upgrade
 * finds and replaces it in place instead of leaving two behind.
 */
function isPlandropHook(hook: unknown): boolean {
  if (!isRecord(hook)) {
    return false;
  }
  const command = typeof hook.command === 'string' ? hook.command : '';
  const statusMessage = typeof hook.statusMessage === 'string' ? hook.statusMessage : '';
  return statusMessage === PLANDROP_STATUS_MESSAGE || command.includes('plandrop upload');
}

function extractCasePattern(command: string): string | undefined {
  return /case "\$f" in ([^)]+)\)/.exec(command)?.[1];
}

function extractCdTarget(command: string): string | undefined {
  return /cd "([^"]*)"/.exec(command)?.[1];
}

export interface MergeResult {
  json: string;
  outcome: 'unchanged' | 'added' | 'replaced';
  /** Present only when outcome === 'replaced': what changed, for a status line. */
  change?: { watch: { from: string; to: string }; root: { from: string; to: string } };
}

/**
 * Merge the autosync hook into a settings.json body, preserving every existing
 * setting and hook. An existing plandrop hook (found by fingerprint, not exact
 * text) that already matches the wanted shape is a no-op; one that differs is
 * replaced in place (never left alongside a second one); anything else in the
 * file — other hooks, other matcher groups, unrelated settings — is untouched.
 * Malformed existing JSON throws: the caller must not clobber a file a human
 * needs to look at.
 */
export function mergeAutosyncHook(
  existingJson: string | undefined,
  watchGlob: string,
  mode: PublishMode = MIRROR_MODE,
): MergeResult {
  const settings =
    existingJson === undefined || existingJson.trim() === ''
      ? {}
      : (JSON.parse(existingJson) as Record<string, unknown>);
  const shape = buildHookShape(watchGlob, mode);

  const hooks = isRecord(settings.hooks) ? settings.hooks : {};
  const post = Array.isArray(hooks.PostToolUse) ? (hooks.PostToolUse as HookMatcher[]) : [];
  const writeEdit = post.find(
    (entry) => entry.matcher === 'Write|Edit' && Array.isArray(entry.hooks),
  );
  const existingHooks = writeEdit !== undefined ? (writeEdit.hooks as unknown[]) : [];
  const plandropIndex = existingHooks.findIndex(isPlandropHook);

  if (plandropIndex !== -1) {
    const existingHook = existingHooks[plandropIndex] as Record<string, unknown>;
    const existingCommand = typeof existingHook.command === 'string' ? existingHook.command : '';
    if (existingCommand === shape.command) {
      return { json: `${JSON.stringify(settings, null, 2)}\n`, outcome: 'unchanged' };
    }
    // Replace in place, collapsing any further plandrop-fingerprinted entries
    // in the same group — there is never more than one afterwards.
    const replaced = existingHooks.filter(
      (hook, index) => index === plandropIndex || !isPlandropHook(hook),
    );
    replaced[replaced.indexOf(existingHook)] = hookEntry(shape.command);
    (writeEdit as HookMatcher).hooks = replaced;
    hooks.PostToolUse = post;
    settings.hooks = hooks;
    return {
      json: `${JSON.stringify(settings, null, 2)}\n`,
      outcome: 'replaced',
      change: {
        watch: { from: extractCasePattern(existingCommand) ?? '(unrecognized)', to: shape.casePattern },
        root: { from: extractCdTarget(existingCommand) ?? 'custom (no cd)', to: describeMode(mode) },
      },
    };
  }

  const entry = hookEntry(shape.command);
  if (writeEdit !== undefined) {
    (writeEdit.hooks as unknown[]).push(entry);
  } else {
    post.push({ matcher: 'Write|Edit', hooks: [entry] });
  }
  hooks.PostToolUse = post;
  settings.hooks = hooks;
  return { json: `${JSON.stringify(settings, null, 2)}\n`, outcome: 'added' };
}

/**
 * Merge the autosync hook into `<projectDir>/.claude/settings.json`, creating
 * the directory and file as needed. Reports the path and what happened
 * ('unchanged' leaves the file untouched); 'replaced' also reports the
 * watch/root change for the caller to print.
 */
export function writeAutosyncHook(
  projectDir: string,
  watchGlob: string,
  mode: PublishMode = MIRROR_MODE,
): { path: string; outcome: MergeResult['outcome']; change?: MergeResult['change'] } {
  const dir = join(projectDir, '.claude');
  const path = join(dir, 'settings.json');
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  const result = mergeAutosyncHook(existing, watchGlob, mode);
  if (result.outcome !== 'unchanged') {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, result.json);
  }
  return { path, outcome: result.outcome, change: result.change };
}

/** The status line for `create`/`hooks` to print after installing/updating the hook. */
export function describeHookOutcome(
  path: string,
  glob: string,
  mode: PublishMode,
  outcome: MergeResult['outcome'],
  change: MergeResult['change'] | undefined,
): string {
  if (outcome === 'unchanged') {
    return `an equivalent hook is already in ${path}; nothing changed\n`;
  }
  if (outcome === 'replaced' && change !== undefined) {
    return (
      `updated the plandrop autosync hook in ${path}:\n` +
      `  watch: ${change.watch.from} → ${change.watch.to}\n` +
      `  root:  ${change.root.from} → ${change.root.to}\n`
    );
  }
  const suffix = mode.kind === 'mirror' ? '' : ` (${describeMode(mode)})`;
  return `wrote ${path} — saving a file matching ${glob} now auto-publishes it${suffix}\n`;
}

/** The publish-mode question's wording, marking whichever option is the default. */
export function publishModePrompt(defaultMode: PublishMode, dirLabel: string): string {
  const tag = (kind: PublishMode['kind']): string => (kind === defaultMode.kind ? ' (default)' : '');
  const letter = defaultMode.kind === 'mirror' ? 'm' : defaultMode.kind === 'flat' ? 'f' : 'r';
  return (
    `Publish [m]irroring the project path${tag('mirror')}, ` +
    `[r]elative to ${dirLabel}${tag('root')}, ` +
    `or [f]lat at the host root${tag('flat')}? [${letter}]: `
  );
}

/**
 * The publish-mode answer: only `m`/`f`/`r` prefixes pick a mode explicitly —
 * a bare Enter, a closed prompt, or anything else falls to the shown default,
 * the same liberal-fallback shape as `hookOfferAccepted` and the watch-path
 * prompt.
 */
export function parsePublishAnswer(
  answer: string | undefined,
  defaultMode: PublishMode,
  rootDir: string,
): PublishMode {
  const choice = (answer ?? '').trim().toLowerCase();
  if (choice.startsWith('m')) {
    return MIRROR_MODE;
  }
  if (choice.startsWith('f')) {
    return FLAT_MODE;
  }
  if (choice.startsWith('r')) {
    return publishRootMode(rootDir);
  }
  return defaultMode;
}

/**
 * Ask what to watch, defaulting from a recorded glob (a prior `create`/`hooks`
 * run) or DEFAULT_WATCH_GLOB when nothing is recorded yet.
 */
export async function promptWatchGlob(recordedGlob: string | undefined): Promise<string> {
  const shown = recordedGlob ?? DEFAULT_WATCH_GLOB;
  const answer = await promptLine(`Path to watch [${shown}]: `);
  const typed = answer !== undefined && answer.trim() !== '' ? answer : undefined;
  return normalizeWatchGlob(typed ?? recordedGlob ?? '');
}

/**
 * Ask how to publish, defaulting from a recorded mode (a prior `create`/`hooks`
 * run) or "relative to the watched directory" when nothing is recorded yet.
 */
export async function promptPublishMode(
  glob: string,
  recorded: RecordedHookConfig | undefined,
): Promise<PublishMode> {
  const rootDir = watchDirOf(glob);
  const dirLabel = rootDir === '' ? 'the project root' : rootDir;
  const defaultMode = modeFromConfig(recorded ?? {}) ?? publishRootMode(rootDir);
  const answer = await promptLine(publishModePrompt(defaultMode, dirLabel));
  return parsePublishAnswer(answer, defaultMode, rootDir);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
