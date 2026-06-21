import { readdir } from 'node:fs/promises';
import type { TemplatesResponse } from './types';

/**
 * The concrete template `default` resolves to in Phase 1. A doc stores the
 * resolved concrete name, never "default", so changing this never breaks an
 * existing doc. (Made operator-configurable in a later phase.)
 */
export const DEFAULT_TEMPLATE = 'bootstrap5';

/**
 * Build the /api/templates payload from the names found in the theme volume.
 * Pure so the listing logic is unit-testable without a filesystem: enumeration
 * happens at request time (a static manifest would go stale the moment an
 * operator drops a template folder in), so the input is the live directory set.
 */
export function buildTemplatesResponse(
  entries: readonly string[],
  defaultTemplate: string = DEFAULT_TEMPLATE,
): TemplatesResponse {
  const templates = [...entries].sort((a, b) => a.localeCompare(b));
  return { default: defaultTemplate, templates };
}

/** Enumerate template folders (each directory in the theme tree is a template). */
export async function listTemplates(themeDir: string): Promise<TemplatesResponse> {
  let names: string[];
  try {
    const dirents = await readdir(themeDir, { withFileTypes: true });
    names = dirents.filter((dirent) => dirent.isDirectory()).map((dirent) => dirent.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      names = [];
    } else {
      throw error;
    }
  }
  return buildTemplatesResponse(names);
}
