import { existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { readConfigFile, userConfigPath } from '../config';
import { DomainError, resolveDomain } from '../domain';
import { findDotfile, readDotfileConfig } from '../dotfile';
import { controlUrl, timedFetch } from '../endpoint';
import {
  fetchTemplates,
  PUBLIC_TEMPLATE_HOST,
  qualifyAssetUrls,
  requestedTemplate,
  resolveTemplate,
  UnknownTemplateError,
} from '../templates';
import { printCommandHelp, usageLine, wantsHelp } from '../usage';
import type { Dispatch } from '../dispatch';

export async function run(dispatch: Dispatch): Promise<number> {
  if (wantsHelp(dispatch.params)) {
    printCommandHelp('newdoc');
    return 0;
  }
  const { filename, template: templateFlag, domain: domainFlag, force } = parseFlags(dispatch.params);
  if (filename === undefined) {
    process.stderr.write(`${usageLine('newdoc')}\n`);
    return 2;
  }

  if (existsSync(filename) && !force) {
    process.stderr.write(`${filename} already exists; pass --force to overwrite it\n`);
    return 1;
  }

  // newdoc only scaffolds a local file — it needs the template server's domain,
  // not a host/passphrase. It resolves the domain by the usual precedence (flag >
  // PLANDROP_DOMAIN > nearest .plandrop > user config) but, unlike `create`,
  // never prompts: with nothing configured it defaults to plandrop.dev, so
  // `newdoc <file>` works out of the box. Whichever server answers, its own
  // origin is what the scaffolded document's assets name (see qualifyAssetUrls),
  // so the file renders on disk before it is ever published.
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
    base = PUBLIC_TEMPLATE_HOST;
    process.stderr.write(`no domain configured; using ${PUBLIC_TEMPLATE_HOST} (static templates)\n`);
  }

  let concrete: string;
  let starter: string;
  try {
    const available = await fetchTemplates(base);
    const requested = requestedTemplate(templateFlag, nearestDotfileTemplate(cwd), userConfigTemplate());
    concrete = resolveTemplate(requested, available);
    // Against the server the template came from, so the scaffolded file renders
    // on disk as well as published (see qualifyAssetUrls).
    starter = qualifyAssetUrls(await fetchStarter(base, concrete), base);
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
    return readDotfileConfig(path).template;
  } catch {
    return undefined;
  }
}

/** The per-user config's `template` preference (the tier `init` writes). */
function userConfigTemplate(): string | undefined {
  return readConfigFile(userConfigPath(process.env.XDG_CONFIG_HOME, homedir())).template;
}

async function fetchStarter(base: string, concrete: string): Promise<string> {
  const res = await timedFetch(controlUrl(base, `/.plandrop/${concrete}/template.html`));
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
