import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { loadContext } from '../context';
import { DOTFILE_NAME } from '../dotfile';
import { hostBaseUri } from '../endpoint';
import { printCommandHelp, usageLine, wantsHelp } from '../usage';
import { makeClient, makeDir, putFile, WrongTenantError } from '../webdav';
import type { Dispatch } from '../dispatch';

export async function run(dispatch: Dispatch): Promise<number> {
  if (wantsHelp(dispatch.params)) {
    printCommandHelp('upload');
    return 0;
  }
  const localPath = dispatch.params[0];
  if (localPath === undefined) {
    process.stderr.write(`${usageLine('upload')}\n`);
    return 2;
  }
  // The name as TYPED, not as resolved: `upload .` names the cwd, whose own
  // basename may well be hidden without the user having asked for anything of
  // the sort.
  const named = basename(localPath);
  if (isWithheld(named)) {
    process.stderr.write(`${refusal(named)}\n`);
    return 1;
  }
  const remoteArg = dispatch.params[1];

  let ctx;
  try {
    ctx = loadContext(process.cwd(), dispatch.hashOverride);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }

  let stats;
  try {
    stats = statSync(localPath);
  } catch {
    process.stderr.write(`no such file or directory: ${localPath}\n`);
    return 1;
  }

  const anchor = mirrorAnchor(ctx.dotfileDir, ctx.dotfile.localRoot, process.cwd());
  const client = makeClient(ctx.base, ctx.host, ctx.passphrase);
  const baseUri = hostBaseUri(ctx.base, ctx.host);
  // Every published file reports its own URL, so a directory upload prints a
  // shareable link per file.
  const report = (local: string, remote: string): void => {
    process.stdout.write(`uploaded ${local} → ${baseUri}${remote}\n`);
  };
  // An omission is reported as loudly as an upload: a silent skip leaves the
  // author believing the whole tree published.
  const reportSkip = (local: string, reason: string): void => {
    process.stdout.write(`skipped ${local} (${reason})\n`);
  };

  try {
    if (stats.isDirectory()) {
      const count = await uploadDirectory(
        client,
        localPath,
        remoteBaseForDirectory(anchor, localPath, remoteArg),
        report,
        reportSkip,
      );
      if (count === 0) {
        process.stdout.write(`nothing to upload: no files under ${localPath}\n`);
      }
    } else {
      const remote =
        remoteArg === undefined
          ? mirrorRemote(anchor, resolve(process.cwd(), localPath))
          : normalizeRemote(remoteArg);
      await ensureParent(client, remote, new Set());
      await putFile(client, remote, readFileSync(localPath));
      report(localPath, remote);
    }
  } catch (error) {
    if (error instanceof WrongTenantError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    process.stderr.write(`upload failed: ${(error as Error).message}\n`);
    return 1;
  }

  return 0;
}

async function uploadDirectory(
  client: ReturnType<typeof makeClient>,
  localDir: string,
  remoteBase: string,
  report: (local: string, remote: string) => void,
  reportSkip: (local: string, reason: string) => void,
): Promise<number> {
  const created = new Set<string>();
  let count = 0;
  for (const file of listFiles(localDir, reportSkip)) {
    const remote = remoteForEntry(localDir, file, remoteBase);
    await ensureParent(client, remote, created);
    await putFile(client, remote, readFileSync(file));
    report(file, remote);
    count += 1;
  }
  return count;
}

/** The remote path for a file inside a directory upload, preserving structure. */
export function remoteForEntry(localDir: string, file: string, remoteBase: string): string {
  const rel = relative(localDir, file).split(sep).join('/');
  return normalizeRemote(remoteBase === '' ? rel : `${remoteBase}/${rel}`);
}

/**
 * The collection a directory upload's contents land in. The remote argument
 * names that collection outright; without one the directory mirrors the place
 * it occupies under the anchor (see mirrorAnchor), exactly as a single file
 * does — so with localRoot `docs`, `upload docs` fills the host root and
 * `upload docs/plans` fills `plans/`, matching where the same files land one
 * at a time. With no localRoot the anchor is the cwd, so `upload ./evidence`
 * publishes `evidence/…` and `upload .` publishes "what's here" to the root.
 *
 * A directory outside the anchor has no mirror image on the host, so it falls
 * back to its own name — a remote base never contains `..`. The cwd is the
 * exception: `upload .` means "publish what's here" and the cwd's basename is
 * incidental — the user never typed it — so a cwd with no mirror publishes to
 * the root rather than minting a folder named after wherever the command ran.
 * `.` as the remote argument is the explicit way to spill any directory's
 * contents into the root.
 */
export function remoteBaseForDirectory(
  anchor: string,
  localDir: string,
  remoteArg: string | undefined,
): string {
  if (remoteArg !== undefined) {
    return toRemoteBase(remoteArg);
  }
  const full = resolve(localDir);
  const rel = relative(anchor, full);
  if (rel === '') {
    return '';
  }
  if (isAbsolute(rel) || rel.split(sep)[0] === '..') {
    return full === process.cwd() ? '' : toRemoteBase(basename(full));
  }
  return toRemoteBase(rel.split(sep).join('/'));
}

/**
 * The directory a no-remote single-file upload mirrors against. A recorded
 * `localRoot` names it, under the dotfile's own directory: remote paths
 * anchor to that root however deep the shell happens to sit, landing exactly
 * where the autosync hook (which `cd`s to the same root) publishes the same
 * file — `localRoot` names the local root remote paths are resolved against,
 * not a hook-only setting. Without one, the cwd anchors.
 */
export function mirrorAnchor(
  dotfileDir: string,
  localRoot: string | undefined,
  cwd: string,
): string {
  return localRoot !== undefined && localRoot !== '' ? join(dotfileDir, localRoot) : cwd;
}

/**
 * The remote path a single file publishes to when no remote is named: the
 * place it occupies under the anchor directory (see mirrorAnchor), so a
 * document stays where its author keeps it. A file outside the anchor has no
 * mirror image inside the host, so it falls back to its bare name — a remote
 * path never contains `..`.
 */
export function mirrorRemote(cwd: string, localPath: string): string {
  const full = resolve(cwd, localPath);
  const rel = relative(cwd, full);
  if (rel === '' || isAbsolute(rel) || rel.split(sep)[0] === '..') {
    return normalizeRemote(basename(full));
  }
  return normalizeRemote(rel.split(sep).join('/'));
}

async function ensureParent(
  client: ReturnType<typeof makeClient>,
  remote: string,
  created: Set<string>,
): Promise<void> {
  const dir = posix.dirname(remote);
  if (dir === '/' || dir === '.' || created.has(dir)) {
    return;
  }
  await makeDir(client, dir);
  created.add(dir);
}

/**
 * Every file under `dir`, depth-first, minus the hidden ones a tenant is not
 * publishing on purpose (see PUBLISHABLE_HIDDEN_NAMES). `onSkip` is called once
 * per omission, with the reason to print: a hidden directory is pruned whole
 * and never descended into, so a `.git` costs one line rather than thousands,
 * and a hidden file costs one line of its own.
 */
export function listFiles(
  dir: string,
  onSkip: (path: string, reason: string) => void,
): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (isWithheld(entry.name)) {
      if (entry.isDirectory()) {
        onSkip(`${full}${sep}`, HIDDEN_REASON);
        continue;
      }
      onSkip(full, reasonFor(entry.name));
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...listFiles(full, onSkip));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

/**
 * A hidden name: dot-prefixed. `.` and `..` are the current and parent
 * directory, not hidden names, and a user who types either has named an
 * ordinary directory.
 */
function isHidden(name: string): boolean {
  return name.startsWith('.') && name !== '.' && name !== '..';
}

/**
 * The hidden names a tenant publishes on purpose: the header and footer that
 * wrap a directory listing in the tenant's own chrome. Apache names them as
 * dotfiles (HeaderName/ReadmeName) so they stay out of the listing they
 * decorate, which puts them under the blanket hidden-name ban despite being
 * ordinary content — hence the exception. Exact basenames, honoured at any
 * depth, because the chrome is per-directory.
 */
const PUBLISHABLE_HIDDEN_NAMES = ['.header.html', '.footer.html'];

/** Hidden, and not one of the few hidden names a tenant publishes on purpose. */
function isWithheld(name: string): boolean {
  return isHidden(name) && !PUBLISHABLE_HIDDEN_NAMES.includes(name);
}

/**
 * The `.plandrop*` family: the credential dotfile itself plus the copies
 * editors and backup schemes leave beside it (`.plandrop.bak`, `.plandrop~`,
 * `.plandrop.save`). Each one holds the host's passphrase — the write key for
 * everything published there — so each is worth naming as such rather than
 * lumping in with the rest of the hidden files.
 */
function isCredential(name: string): boolean {
  return name.startsWith(DOTFILE_NAME);
}

const HIDDEN_REASON = 'hidden';

function reasonFor(name: string): string {
  return isCredential(name) ? 'plandrop credential file' : HIDDEN_REASON;
}

/**
 * Why an explicitly-named hidden path is not published. Naming one is not
 * consent to leak it: hidden names hold configuration and private data by
 * convention, and everything plandrop publishes is world-readable to anyone
 * who can reach the host. The escape hatch is a rename, which makes the
 * intent explicit in a way an argument cannot.
 */
function refusal(name: string): string {
  const escape = `Rename it if you really mean to publish something of that name.`;
  if (isCredential(name)) {
    return (
      `refusing to upload ${name}: it holds this host's passphrase, and everything published ` +
      `is world-readable — publishing it hands any reader write access to the host. ${escape}`
    );
  }
  return (
    `refusing to upload ${name}: hidden names are configuration or private data by convention, ` +
    `and everything plandrop publishes is world-readable. ${escape}`
  );
}

/** A remote file path: POSIX, single leading slash. */
export function normalizeRemote(path: string): string {
  const cleaned = path
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\//, '');
  return `/${cleaned}`;
}

/**
 * A remote base directory: POSIX, no leading/trailing slashes ('' = root).
 * A base that resolves to or above the root ('.', '..', '/') is the root, so
 * no upload can address a collection outside the host.
 */
export function toRemoteBase(arg: string | undefined): string {
  if (arg === undefined) {
    return '';
  }
  const cleaned = posix.normalize(arg.replace(/\\/g, '/')).replace(/^\/+|\/+$/g, '');
  return cleaned === '.' || cleaned === '..' || cleaned.startsWith('../') ? '' : cleaned;
}
