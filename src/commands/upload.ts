import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { loadContext } from '../context';
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

  const client = makeClient(ctx.base, ctx.host, ctx.passphrase);
  const baseUri = hostBaseUri(ctx.base, ctx.host);
  // Every published file reports its own URL, so a directory upload prints a
  // shareable link per file.
  const report = (local: string, remote: string): void => {
    process.stdout.write(`uploaded ${local} → ${baseUri}${remote}\n`);
  };

  try {
    if (stats.isDirectory()) {
      const count = await uploadDirectory(
        client,
        localPath,
        remoteBaseForDirectory(localPath, remoteArg),
        report,
      );
      if (count === 0) {
        process.stdout.write(`nothing to upload: no files under ${localPath}\n`);
      }
    } else {
      const remote =
        remoteArg === undefined
          ? mirrorRemote(process.cwd(), localPath)
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
): Promise<number> {
  const created = new Set<string>();
  let count = 0;
  for (const file of listFiles(localDir)) {
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
 * names that collection; without one the directory's own name is used, so
 * `upload ./evidence` publishes `evidence/…`. `.` names the host root — the
 * explicit way to spill a directory's contents into it.
 *
 * The cwd itself is the exception to the own-name default: `upload .` means
 * "publish what's here", and the cwd's basename is incidental — the user never
 * typed it — so it maps to the host root rather than minting a folder named
 * after wherever the command happened to run.
 */
export function remoteBaseForDirectory(localDir: string, remoteArg: string | undefined): string {
  if (remoteArg === undefined && resolve(localDir) === process.cwd()) {
    return '';
  }
  return toRemoteBase(remoteArg ?? basename(resolve(localDir)));
}

/**
 * The remote path a single file publishes to when no remote is named: the
 * place it occupies under the cwd, so a document stays where its author keeps
 * it. A file outside the cwd has no mirror image inside the host, so it falls
 * back to its bare name — a remote path never contains `..`.
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

function listFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
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
