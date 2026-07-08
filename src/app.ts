import { run as create } from './commands/create';
import { run as help } from './commands/help';
import { run as init } from './commands/init';
import { run as newdoc } from './commands/newdoc';
import { run as remove } from './commands/remove';
import { run as rotate } from './commands/rotate';
import { run as server } from './commands/server';
import { run as upload } from './commands/upload';
import { parseArgs, UsageError, type CommandName, type Dispatch } from './dispatch';

type Handler = (dispatch: Dispatch) => number | Promise<number>;

const HANDLERS: Record<CommandName, Handler> = {
  create,
  newdoc,
  upload,
  rotate,
  remove,
  init,
  server,
  help,
};

/** Parse argv, route to the command handler, and return the process exit code. */
export async function main(argv: readonly string[]): Promise<number> {
  let dispatch: Dispatch;
  try {
    dispatch = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    throw error;
  }
  return HANDLERS[dispatch.command](dispatch);
}
