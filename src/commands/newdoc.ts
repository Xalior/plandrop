import { existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { DomainError, resolveDomain } from '../domain';
import { findDotfile, readDotfile } from '../dotfile';
import { controlUrl } from '../endpoint';
import {
  requestedTemplate,
  resolveTemplate,
  UnknownTemplateError,
} from '../templates';
import type { Dispatch } from '../dispatch';
import type { TemplatesResponse } from '../types';

/**
 * The public template host newdoc falls back to when nothing else resolves a
 * domain — its static, publish-less templates make `newdoc <file>` work with no
 * configuration at all.
 */
const DEFAULT_TEMPLATE_HOST = 'https://plandrop.dev';

export async function run(dispatch: Dispatch): Promise<number> {
  const { filename, template: templateFlag, domain: domainFlag, force } = parseFlags(dispatch.params);
  if (filename === undefined) {
    process.stderr.write(
      'usage: plandrop newdoc <filename> [--template <name>] [--domain <uri>] [--force]\n',
    );
    return 2;
  }

  if (existsSync(filename) && !force) {
    process.stderr.write(`${filename} already exists; pass --force to overwrite it\n`);
    return 1;
  }

  // newdoc only scaffolds a local file — it needs the template server's domain,
  // not a host/passphrase. It resolves the domain by the usual precedence (flag >
  // PLANDROP_DOMAIN > nearest .plandrop > user config) but, unlike `create`,
  // never prompts: with nothing configured it defaults to plandrop.dev, whose
  // static, publish-less templates make `newdoc <file>` work out of the box.
  // Pointed at your own host instead, it fetches that host's self-updating ones.
  const cwd = process.cwd();
  let base: string;
  try {
    base = await resolveDomain({
      flag: domainFlag,
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
    base = DEFAULT_TEMPLATE_HOST;
    process.stderr.write(`no domain configured; using ${DEFAULT_TEMPLATE_HOST} (static templates)\n`);
  }

  let concrete: string;
  let starter: string;
  try {
    const available = await fetchTemplates(base);
    const requested = requestedTemplate(templateFlag, nearestDotfileTemplate(cwd));
    concrete = resolveTemplate(requested, available);
    starter = await fetchStarter(base, concrete);
  } catch (error) {
    if (error instanceof UnknownTemplateError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    process.stderr.write(`newdoc failed: ${(error as Error).message}\n`);
    return 1;
  }

  writeFileSync(filename, starter);
  process.stdout.write(`wrote ${filename} from template ${concrete}\n`);
  return 0;
}

/**
 * The `template` field of the nearest `.plandrop`, if there is one — a
 * preference, not a requirement. newdoc works with no dotfile at all (just a
 * `--domain`), so a missing or unreadable dotfile simply yields no preference.
 */
function nearestDotfileTemplate(cwd: string): string | undefined {
  const path = findDotfile(cwd);
  if (path === undefined) {
    return undefined;
  }
  try {
    return readDotfile(path).template;
  } catch {
    return undefined;
  }
}

async function fetchTemplates(base: string): Promise<TemplatesResponse> {
  const res = await fetch(controlUrl(base, '/api/templates'));
  if (!res.ok) {
    throw new Error(`templates request responded ${res.status}`);
  }
  const body = (await res.json()) as Partial<TemplatesResponse>;
  if (typeof body.default !== 'string' || !Array.isArray(body.templates)) {
    throw new Error('templates endpoint returned an unexpected response');
  }
  return { default: body.default, templates: body.templates };
}

async function fetchStarter(base: string, concrete: string): Promise<string> {
  const res = await fetch(controlUrl(base, `/.plandrop/${concrete}/template.html`));
  if (!res.ok) {
    throw new Error(`starter request for ${concrete} responded ${res.status}`);
  }
  return res.text();
}

interface NewdocFlags {
  filename: string | undefined;
  template: string | undefined;
  domain: string | undefined;
  force: boolean;
}

function parseFlags(params: readonly string[]): NewdocFlags {
  let filename: string | undefined;
  let template: string | undefined;
  let domain: string | undefined;
  let force = false;
  for (let i = 0; i < params.length; i += 1) {
    const param = params[i];
    if (param === '--force') {
      force = true;
    } else if (param === '--template') {
      template = params[i + 1];
      i += 1;
    } else if (param?.startsWith('--template=')) {
      template = param.slice('--template='.length);
    } else if (param === '--domain') {
      domain = params[i + 1];
      i += 1;
    } else if (param?.startsWith('--domain=')) {
      domain = param.slice('--domain='.length);
    } else if (filename === undefined && param !== undefined && !param.startsWith('--')) {
      filename = param;
    }
  }
  return { filename, template, domain, force };
}
