import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, relative } from 'node:path';
import { DomainError, resolveDomain } from '../domain';
import { findDotfile, readDotfileConfig } from '../dotfile';
import { countLocalAssetRefs, qualifyAssetUrls } from '../templates';
import { printCommandHelp, wantsHelp } from '../usage';
import { listFiles, mirrorAnchor } from './upload';
import type { Dispatch } from '../dispatch';

/** The extensions a document is recognized by — the files a browser renders. */
const HTML_EXTENSIONS = new Set(['.html', '.htm']);

export async function run(dispatch: Dispatch): Promise<number> {
  if (wantsHelp(dispatch.params)) {
    printCommandHelp('fixcss');
    return 0;
  }

  const cwd = process.cwd();
  const dotfilePath = findDotfile(cwd);
  if (dotfilePath === undefined) {
    process.stderr.write(
      'no .plandrop found here or in any parent directory; run `plandrop create` first\n',
    );
    return 1;
  }

  let localRoot: string | undefined;
  try {
    localRoot = readDotfileConfig(dotfilePath).localRoot;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }

  // The same anchor an upload mirrors against: the recorded localRoot under the
  // dotfile's own directory, or the cwd when none is recorded. Fixing exactly
  // the tree that gets published is the point — a document rewritten here and a
  // document uploaded from here name the same file.
  const root = mirrorAnchor(dirname(dotfilePath), localRoot, cwd);

  let base: string;
  try {
    base = await resolveDomain({
      flag: undefined,
      env: process.env,
      cwd,
      configHome: process.env.XDG_CONFIG_HOME,
      home: homedir(),
      prompt: async () => undefined,
    });
  } catch (error) {
    if (!(error instanceof DomainError)) {
      throw error;
    }
    process.stderr.write(`${error.message}\n`);
    return 1;
  }

  try {
    if (!statSync(root).isDirectory()) {
      process.stderr.write(`not a directory: ${root}\n`);
      return 1;
    }
  } catch {
    process.stderr.write(`no such directory: ${root}\n`);
    return 1;
  }

  process.stdout.write(`fixing theme asset links under ${root} against ${base}\n`);

  let scanned = 0;
  let fixed = 0;
  let rewritten = 0;
  // The walk skips hidden directories, so a .git full of stored HTML is never
  // rewritten — the same pruning an upload does, for the same reason it is safe
  // to apply blindly here: nothing hidden is a published document.
  for (const file of listFiles(root, () => undefined)) {
    if (!HTML_EXTENSIONS.has(extname(file).toLowerCase())) {
      continue;
    }
    scanned += 1;
    const html = readFileSync(file, 'utf8');
    const count = countLocalAssetRefs(html);
    if (count === 0) {
      continue;
    }
    writeFileSync(file, qualifyAssetUrls(html, base));
    fixed += 1;
    rewritten += count;
    process.stdout.write(`fixed ${relative(root, file)} (${plural(count, 'reference')})\n`);
  }

  process.stdout.write(
    fixed === 0
      ? `nothing to fix (${plural(scanned, 'document')} scanned)\n`
      : `fixed ${plural(rewritten, 'reference')} in ${plural(fixed, 'document')} (${scanned} scanned)\n`,
  );
  return 0;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
