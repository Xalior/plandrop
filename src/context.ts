import { dirname } from 'node:path';
import { findDotfile, readDotfile, type Dotfile } from './dotfile';

export interface ClientContext {
  /** Full base URI (scheme + host + optional port). */
  base: string;
  /** Host label — the dotfile's, or a >= 8-char hash override. */
  host: string;
  passphrase: string;
  dotfilePath: string;
  dotfileDir: string;
  dotfile: Dotfile;
}

/**
 * Load host/passphrase/base from the nearest `.plandrop` (walking up from cwd).
 * A hash override replaces the host label only; the passphrase still comes from
 * the dotfile (a mismatch surfaces later as a wrong-tenant error).
 */
export function loadContext(cwd: string, hashOverride: string | undefined): ClientContext {
  const dotfilePath = findDotfile(cwd);
  if (dotfilePath === undefined) {
    throw new Error('no .plandrop found here or in any parent directory; run `plandrop create` first');
  }
  const dotfile = readDotfile(dotfilePath);
  return {
    base: dotfile.domain,
    host: hashOverride ?? dotfile.host,
    passphrase: dotfile.passphrase,
    dotfilePath,
    dotfileDir: dirname(dotfilePath),
    dotfile,
  };
}
