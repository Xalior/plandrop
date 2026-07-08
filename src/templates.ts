import { readdir } from 'node:fs/promises';
import { controlUrl, timedFetch } from './endpoint';
import type { TemplatesResponse } from './types';

/**
 * The public template host the client falls back to when nothing else resolves
 * a domain — its static, publish-less templates make `newdoc <file>` work with
 * no configuration at all. Templates only: it accepts no published documents.
 */
export const PUBLIC_TEMPLATE_HOST = 'https://plandrop.dev';

/** Fetch and validate a server's /api/templates listing. */
export async function fetchTemplates(base: string): Promise<TemplatesResponse> {
  const res = await timedFetch(controlUrl(base, '/api/templates'));
  if (!res.ok) {
    throw new Error(`templates request responded ${res.status}`);
  }
  const body = (await res.json()) as Partial<TemplatesResponse>;
  if (typeof body.default !== 'string' || !Array.isArray(body.templates)) {
    throw new Error('templates endpoint returned an unexpected response');
  }
  return { default: body.default, templates: body.templates };
}

/**
 * The fallback concrete template `default` resolves to when the operator
 * configures no other. A doc stores the resolved concrete name, never
 * "default", so changing this never breaks an existing doc.
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

/**
 * Theme-volume directory names that are NOT selectable templates and must never
 * be advertised by `/api/templates`:
 *   - `default` — the seed-copied autoindex-chrome mirror.
 *   - `shared`  — the theme-neutral shared assets (e.g. selfupdate.js), served
 *     at `.plandrop/shared/…`; carries no header/plan/footer.
 */
export const RESERVED_TEMPLATE_DIRS: ReadonlySet<string> = new Set([DEFAULT_ALIAS, 'shared']);

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
 * then the dotfile's `template` field, then the user config's (the tier `init`
 * writes), then the `default` alias.
 */
export function requestedTemplate(
  flag: string | undefined,
  dotfileTemplate: string | undefined,
  configTemplate?: string | undefined,
): string {
  return flag ?? dotfileTemplate ?? configTemplate ?? DEFAULT_ALIAS;
}

/**
 * Resolve the operator-configured default to a concrete template that actually
 * exists. An unknown/empty configured value falls back to `bootstrap5` (warning
 * to stderr) so a typo in `PLANDROP_DEFAULT_TEMPLATE` never makes `/api/templates`
 * advertise a default that `newdoc` can't fetch.
 */
export function resolveConfiguredDefault(
  configured: string | undefined,
  available: readonly string[],
): string {
  const wanted = configured && configured.length > 0 ? configured : DEFAULT_TEMPLATE;
  if (available.includes(wanted)) {
    return wanted;
  }
  if (wanted !== DEFAULT_TEMPLATE) {
    process.stderr.write(
      `PLANDROP_DEFAULT_TEMPLATE="${wanted}" names no available template; falling back to ${DEFAULT_TEMPLATE}\n`,
    );
  }
  return DEFAULT_TEMPLATE;
}

/**
 * Enumerate template folders. The built-in theme tree contributes its top-level
 * directories directly; the optional separate user mount contributes its
 * directories namespaced `user/<name>` (kept apart so the fresh-seed of the
 * built-ins never wipes operator templates). The reported `default` is the
 * operator-configured one, validated against the available set.
 */
export async function listTemplates(
  themeDir: string,
  options: { userDir?: string; configuredDefault?: string } = {},
): Promise<TemplatesResponse> {
  // Drop the reserved dirs (`default/` chrome mirror, `shared/` assets) so the
  // list never advertises them as concrete templates — docs always carry
  // concrete, selectable names.
  const builtins = (await readTemplateDirs(themeDir)).filter(
    (name) => !RESERVED_TEMPLATE_DIRS.has(name),
  );
  const userNames = options.userDir ? await readTemplateDirs(options.userDir) : [];
  const names = [...builtins, ...userNames.map((name) => `user/${name}`)];
  const defaultTemplate = resolveConfiguredDefault(options.configuredDefault, names);
  return buildTemplatesResponse(names, defaultTemplate);
}

/** The directory names directly under `dir`, or [] if it does not exist. */
async function readTemplateDirs(dir: string): Promise<string[]> {
  try {
    const dirents = await readdir(dir, { withFileTypes: true });
    return dirents.filter((dirent) => dirent.isDirectory()).map((dirent) => dirent.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}
