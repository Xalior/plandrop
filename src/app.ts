import { run as create } from './commands/create';
import { run as remove } from './commands/remove';
import { run as rotate } from './commands/rotate';
import { run as upload } from './commands/upload';
import { parseArgs, UsageError, type CommandName, type Dispatch } from './dispatch';

const USAGE = `plandrop — push a static HTML document to a unique, secure hostname.

Usage:
  plandrop <command> [params]
  plandrop <hash> <command> [params]    # a >= 8-char hash overrides the dotfile host

Commands:
  create    mint a new host (hostname + passphrase)
  upload    push a file or directory over authed WebDAV
  rotate    change the host passphrase
  remove    delete the host
`;

const HANDLERS: Record<CommandName, (dispatch: Dispatch) => number> = {
  create,
  upload,
  rotate,
  remove,
};

/** Parse argv, route to the command handler, and return the process exit code. */
export function main(argv: readonly string[]): number {
  let dispatch: Dispatch;
  try {
    dispatch = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n\n${USAGE}`);
      return 2;
    }
    throw error;
  }
  return HANDLERS[dispatch.command](dispatch);
}
