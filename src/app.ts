import { run as index } from './commands/autoindex';
import { run as create } from './commands/create';
import { run as deleteFile } from './commands/delete';
import { run as fixcss } from './commands/fixcss';
import { run as help } from './commands/help';
import { run as hooks } from './commands/hooks';
import { run as init } from './commands/init';
import { run as newdoc } from './commands/newdoc';
import { run as remove } from './commands/remove';
import { run as rotate } from './commands/rotate';
import { run as server } from './commands/server';
import { run as text } from './commands/text';
import { run as upload } from './commands/upload';
import { parseArgs, UsageError, VersionRequested, type CommandName, type Dispatch } from './dispatch';

type Handler = (dispatch: Dispatch) => number | Promise<number>;

const HANDLERS: Record<CommandName, Handler> = {
  create,
  newdoc,
  upload,
  index,
  fixcss,
  rotate,
  remove,
  delete: deleteFile,
  text,
  init,
  server,
  hooks,
  help,
};

/** Parse argv, route to the command handler, and return the process exit code. */
export async function main(argv: readonly string[]): Promise<number> {
  let dispatch: Dispatch;
  try {
    dispatch = parseArgs(argv);
  } catch (error) {
    if (error instanceof VersionRequested) {
      process.stdout.write(`${__PLANDROP_VERSION__}\n`);
      return 0;
    }
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    throw error;
  }
  return HANDLERS[dispatch.command](dispatch);
}
