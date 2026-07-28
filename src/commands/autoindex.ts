import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { readConfigFile, userConfigPath } from '../config';
import { loadContext } from '../context';
import { controlUrl, hostBaseUri, timedFetch } from '../endpoint';
import {
  fetchTemplates,
  requestedTemplate,
  resolveTemplate,
  UnknownTemplateError,
} from '../templates';
import { printCommandHelp, wantsHelp } from '../usage';
import { makeClient, putFile, WrongTenantError } from '../webdav';
import type { Dispatch } from '../dispatch';

/**
 * `plandrop index` — publish the directory-listing chrome. The module is not
 * named index.ts because that name makes it the barrel module for
 * src/commands/, which any `from '../commands'` would silently resolve to.
 */

/**
 * Apache reads the chrome from these two per-directory dotfiles (HeaderName /
 * ReadmeName in apache/httpd.conf). Both sit at the host root: the chrome the
 * root serves is what a visitor arriving at the bare hostname sees.
 */
const HEADER_REMOTE = '/.header.html';
const FOOTER_REMOTE = '/.footer.html';

/**
 * The class the shared stylesheet scopes all of its listing rules to
 * (templates/shared/css/plandrop.css). mod_autoindex emits a bare table with no
 * id or class of its own, so without this marker on <body> the listing renders
 * with none of the table, hover, or file-icon styling — a correctly themed page
 * wrapped around an unstyled index.
 */
const AUTOINDEX_BODY_CLASS = 'plandrop-autoindex';

export async function run(dispatch: Dispatch): Promise<number> {
  if (wantsHelp(dispatch.params)) {
    printCommandHelp('index');
    return 0;
  }

  const { heroPath, template: templateFlag } = parseFlags(dispatch.params);

  let ctx;
  try {
    ctx = loadContext(process.cwd(), dispatch.hashOverride);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }

  let hero: string | undefined;
  if (heroPath !== undefined) {
    try {
      hero = readFileSync(heroPath, 'utf8');
    } catch {
      process.stderr.write(`no such file: ${heroPath}\n`);
      return 1;
    }
  }

  let concrete: string;
  try {
    const available = await fetchTemplates(ctx.base);
    concrete = resolveTemplate(
      requestedTemplate(templateFlag, ctx.dotfile.template, userConfigTemplate()),
      available,
    );
  } catch (error) {
    if (error instanceof UnknownTemplateError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    process.stderr.write(`could not resolve a template: ${(error as Error).message}\n`);
    return 1;
  }

  let header: string;
  let footer: string;
  try {
    [header, footer] = await Promise.all([
      fetchChromePart(ctx.base, concrete, 'header.html'),
      fetchChromePart(ctx.base, concrete, 'footer.html'),
    ]);
  } catch (error) {
    process.stderr.write(`could not fetch the ${concrete} chrome: ${(error as Error).message}\n`);
    return 1;
  }

  const client = makeClient(ctx.base, ctx.host, ctx.passphrase);
  const baseUri = hostBaseUri(ctx.base, ctx.host);
  try {
    await putFile(client, HEADER_REMOTE, Buffer.from(buildHeader(header, hero), 'utf8'));
    await putFile(client, FOOTER_REMOTE, Buffer.from(footer, 'utf8'));
  } catch (error) {
    if (error instanceof WrongTenantError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    process.stderr.write(`index failed: ${(error as Error).message}\n`);
    return 1;
  }

  process.stdout.write(
    `published ${concrete} listing chrome${hero === undefined ? '' : ' with a hero block'} → ${baseUri}/\n`,
  );
  return 0;
}

/** The per-user config's `template` preference (the tier `init` writes). */
function userConfigTemplate(): string | undefined {
  return readConfigFile(userConfigPath(process.env.XDG_CONFIG_HOME, homedir())).template;
}

/**
 * One half of a template's chrome, straight from the theme volume. The server
 * assembles a template.html from header + plan + footer for `newdoc`, but the
 * three parts stay individually addressable, and a listing wants the two
 * wrapper halves without the document body between them.
 */
async function fetchChromePart(base: string, concrete: string, part: string): Promise<string> {
  const res = await timedFetch(controlUrl(base, `/.plandrop/${concrete}/${part}`));
  if (!res.ok) {
    throw new Error(`${part} responded ${res.status}`);
  }
  return res.text();
}

/**
 * The header half as the listing needs it: carrying the marker class, and the
 * hero (when given) as the last thing before Apache's table. The theme's header
 * ends on an open `<main>`, so appending lands the hero inside the page
 * container, directly above the listing.
 */
export function buildHeader(header: string, hero: string | undefined): string {
  const marked = markAutoindexBody(header);
  return hero === undefined ? marked : `${marked.trimEnd()}\n${heroBlock(hero)}\n`;
}

/**
 * The hero wrapper. Stock Bootstrap utilities only — every theme in the set is
 * a Bootstrap build, so the block picks up that theme's own surface and
 * spacing rather than needing a rule of its own.
 */
function heroBlock(hero: string): string {
  return `<div class="p-4 p-md-5 mb-4 rounded-3 bg-body-tertiary plandrop-hero">\n${hero.trim()}\n</div>`;
}

/**
 * Add the listing marker class to a document's `<body>`, preserving whatever
 * the tag already carries: an existing class list gains the marker, other
 * attributes are left untouched, and a body already marked is returned as-is
 * so re-running the command is a no-op rather than a growing class list.
 */
export function markAutoindexBody(html: string): string {
  return html.replace(/<body\b([^>]*)>/i, (whole, attrs: string) => {
    const existing = /\bclass\s*=\s*("|')(.*?)\1/i.exec(attrs);
    if (existing === null) {
      return `<body${attrs} class="${AUTOINDEX_BODY_CLASS}">`;
    }
    const classes = existing[2] ?? '';
    if (classes.split(/\s+/).includes(AUTOINDEX_BODY_CLASS)) {
      return whole;
    }
    const quote = existing[1] ?? '"';
    const merged = `class=${quote}${classes === '' ? '' : `${classes} `}${AUTOINDEX_BODY_CLASS}${quote}`;
    return `<body${attrs.slice(0, existing.index)}${merged}${attrs.slice(existing.index + existing[0].length)}>`;
  });
}

interface IndexFlags {
  heroPath: string | undefined;
  template: string | undefined;
}

function parseFlags(params: readonly string[]): IndexFlags {
  let heroPath: string | undefined;
  let template: string | undefined;
  for (let i = 0; i < params.length; i += 1) {
    const param = params[i];
    if (param === '--template') {
      template = params[i + 1];
      i += 1;
    } else if (param?.startsWith('--template=')) {
      template = param.slice('--template='.length);
    } else if (heroPath === undefined && param !== undefined && !param.startsWith('--')) {
      heroPath = param;
    }
  }
  return { heroPath, template };
}
