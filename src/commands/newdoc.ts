import { existsSync, writeFileSync } from 'node:fs';
import { loadContext } from '../context';
import { controlUrl } from '../endpoint';
import {
  requestedTemplate,
  resolveTemplate,
  UnknownTemplateError,
} from '../templates';
import type { Dispatch } from '../dispatch';
import type { TemplatesResponse } from '../types';

export async function run(dispatch: Dispatch): Promise<number> {
  const { filename, template: templateFlag, force } = parseFlags(dispatch.params);
  if (filename === undefined) {
    process.stderr.write('usage: plandrop newdoc <filename> [--template <name>] [--force]\n');
    return 2;
  }

  if (existsSync(filename) && !force) {
    process.stderr.write(`${filename} already exists; pass --force to overwrite it\n`);
    return 1;
  }

  let ctx;
  try {
    ctx = loadContext(process.cwd(), dispatch.hashOverride);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }

  let concrete: string;
  let starter: string;
  try {
    const available = await fetchTemplates(ctx.base);
    const requested = requestedTemplate(templateFlag, ctx.dotfile.template);
    concrete = resolveTemplate(requested, available);
    starter = await fetchStarter(ctx.base, concrete);
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
  force: boolean;
}

function parseFlags(params: readonly string[]): NewdocFlags {
  let filename: string | undefined;
  let template: string | undefined;
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
    } else if (filename === undefined && param !== undefined && !param.startsWith('--')) {
      filename = param;
    }
  }
  return { filename, template, force };
}
