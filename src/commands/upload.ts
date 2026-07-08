import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, posix, relative, sep } from 'node:path';
import { loadContext } from '../context';
import { hostBaseUri, hostUrl } from '../endpoint';
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
  // A single file reports its exact shareable URL (the path it was PUT to); a
  // directory upload spans many files, so it reports the host root.
  let uploadedUrl: string;
  try {
    if (stats.isDirectory()) {
      await uploadDirectory(client, localPath, toRemoteBase(remoteArg));
      uploadedUrl = hostUrl(ctx.base, ctx.host);
    } else {
      const remote = remoteArg === undefined ? `/${basename(localPath)}` : normalizeRemote(remoteArg);
      await ensureParent(client, remote, new Set());
      await putFile(client, remote, readFileSync(localPath));
      uploadedUrl = `${hostBaseUri(ctx.base, ctx.host)}${remote}`;
    }
  } catch (error) {
    if (error instanceof WrongTenantError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    process.stderr.write(`upload failed: ${(error as Error).message}\n`);
    return 1;
  }

  process.stdout.write(`uploaded to ${uploadedUrl}\n`);
  return 0;
}

async function uploadDirectory(
  client: ReturnType<typeof makeClient>,
  localDir: string,
  remoteBase: string,
): Promise<void> {
  const created = new Set<string>();
  for (const file of listFiles(localDir)) {
    const remote = remoteForEntry(localDir, file, remoteBase);
    await ensureParent(client, remote, created);
    await putFile(client, remote, readFileSync(file));
  }
}

/** The remote path for a file inside a directory upload, preserving structure. */
export function remoteForEntry(localDir: string, file: string, remoteBase: string): string {
  const rel = relative(localDir, file).split(sep).join('/');
  return normalizeRemote(remoteBase === '' ? rel : `${remoteBase}/${rel}`);
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

/** A remote base directory: POSIX, no leading/trailing slashes ('' = root). */
export function toRemoteBase(arg: string | undefined): string {
  if (arg === undefined) {
    return '';
  }
  return arg.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}
