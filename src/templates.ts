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

/** The alias that resolves to whatever the server currently calls the default. */
export const DEFAULT_ALIAS = 'default';

/** Thrown when a requested template name is not among the available ones. */
export class UnknownTemplateError extends Error {
  constructor(requested: string, available: readonly string[]) {
    super(
      `unknown template "${requested}"; available: ${[DEFAULT_ALIAS, ...available].join(', ')}`,
    );
  }
}

/**
 * Resolve a requested template name to a concrete one, given the server's list.
 * `default` is an alias resolved at creation time to a concrete name, so the
 * written doc never says "default" and later default drift can't break it.
 * Precedence (requested) is decided by the caller: --template > dotfile > default.
 */
export function resolveTemplate(
  requested: string,
  available: TemplatesResponse,
): string {
  const concrete = requested === DEFAULT_ALIAS ? available.default : requested;
  if (!available.templates.includes(concrete)) {
    throw new UnknownTemplateError(requested, available.templates);
  }
  return concrete;
}

/**
 * The template name to request, by precedence: an explicit `--template` flag,
 * then the dotfile's `template` field, then the `default` alias.
 */
export function requestedTemplate(
  flag: string | undefined,
  dotfileTemplate: string | undefined,
): string {
  return flag ?? dotfileTemplate ?? DEFAULT_ALIAS;
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
