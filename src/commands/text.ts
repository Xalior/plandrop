import { readFileSync } from 'node:fs';
import { documentToMarkdown } from '../text';
import { printCommandHelp, wantsHelp } from '../usage';
import type { Dispatch } from '../dispatch';

/** Whether a target names something to fetch rather than something on disk. */
export function isUrl(target: string): boolean {
  return /^https?:\/\//i.test(target);
}

/**
 * Read a document as markdown and write it to stdout.
 *
 * Half the time the document you want is already published and the local copy is
 * somewhere you have not looked, so a URL is as good a target as a path. The
 * output goes to stdout so it pipes: the command reads a document, it does not
 * manage one.
 */
export async function run(dispatch: Dispatch): Promise<number> {
  if (wantsHelp(dispatch.params)) {
    printCommandHelp('text');
    return 0;
  }

  const target = dispatch.params[0];
  if (target === undefined) {
    process.stderr.write('text needs a file path or a URL (run `plandrop help text`)\n');
    return 2;
  }

  let html: string;
  try {
    html = isUrl(target) ? await fetchDocument(target) : readFileSync(target, 'utf8');
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }

  process.stdout.write(documentToMarkdown(html));
  return 0;
}

async function fetchDocument(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`cannot reach ${url}: ${(error as Error).message}`, { cause: error });
  }
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status} ${response.statusText}`);
  }
  return response.text();
}
