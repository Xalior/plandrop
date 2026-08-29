import { loadContext } from '../context';
import { hostBaseUri } from '../endpoint';
import { printCommandHelp, usageLine, wantsHelp } from '../usage';
import {
  deleteFile,
  isRemoteDirectory,
  makeClient,
  RemoteNotFoundError,
  WrongTenantError,
} from '../webdav';
import { normalizeRemote } from './upload';
import type { Dispatch } from '../dispatch';

export async function run(dispatch: Dispatch): Promise<number> {
  if (wantsHelp(dispatch.params)) {
    printCommandHelp('delete');
    return 0;
  }
  const target = dispatch.params[0];
  if (target === undefined) {
    process.stderr.write(`${usageLine('delete')}\n`);
    return 2;
  }
  const remote = normalizeRemote(target);

  let ctx;
  try {
    ctx = loadContext(process.cwd(), dispatch.hashOverride);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }

  const client = makeClient(ctx.base, ctx.host, ctx.passphrase);
  const baseUri = hostBaseUri(ctx.base, ctx.host);

  try {
    if (await isRemoteDirectory(client, remote)) {
      process.stderr.write(
        `refusing to delete ${remote}: it is a directory, and deleting it would remove ` +
          `everything inside it. Name the exact file you want to remove.\n`,
      );
      return 1;
    }
    await deleteFile(client, remote);
  } catch (error) {
    if (error instanceof RemoteNotFoundError || error instanceof WrongTenantError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    process.stderr.write(`delete failed: ${(error as Error).message}\n`);
    return 1;
  }

  process.stdout.write(`deleted ${baseUri}${remote}\n`);
  return 0;
}
