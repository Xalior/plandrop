import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { userConfigPath, writeUserConfig, type UserConfig } from '../config';
import { mergeDotfileConfig } from '../dotfile';
import { normalizeBaseUri } from '../endpoint';
import { promptLine } from '../prompt';
import { fetchTemplates, PUBLIC_TEMPLATE_HOST, resolveTemplate, UnknownTemplateError } from '../templates';
import { printCommandHelp, usageLine, wantsHelp } from '../usage';
import type { Dispatch } from '../dispatch';

/**
 * First-run setup: records the domain (and optionally a default template) in a
 * config the resolvers already read — either the per-user config or a
 * project-local `.plandrop` — so the user never hand-authors the JSON. Records
 * preferences only: it never mints a host (`create`) and never runs a server
 * (`server`).
 */
export async function run(dispatch: Dispatch): Promise<number> {
  if (wantsHelp(dispatch.params)) {
    printCommandHelp('init');
    return 0;
  }
  const flags = parseFlags(dispatch.params);
  if (flags.local && flags.user) {
    process.stderr.write(`--local and --user are mutually exclusive\n${usageLine('init')}\n`);
    return 2;
  }

  const interactive = process.stdin.isTTY === true && !flags.yes;

  // 1. Default domain. The public CDN is explicitly on offer — with the caveat
  // that it serves templates only, so it covers newdoc but not publishing.
  let domain = flags.domain;
  if (domain === undefined) {
    if (interactive) {
      process.stderr.write(
        'Default domain — the plandrop server your documents publish to (and templates come from).\n' +
          `Press Enter for the public CDN ${PUBLIC_TEMPLATE_HOST} — templates only: \`newdoc\` works\n` +
          'out of the box, but publishing (create/upload) needs your own server (`plandrop help server`).\n',
      );
      const answer = await promptLine(`Domain [${PUBLIC_TEMPLATE_HOST}]: `);
      domain = answer === undefined || answer.trim() === '' ? PUBLIC_TEMPLATE_HOST : answer.trim();
    } else {
      domain = PUBLIC_TEMPLATE_HOST;
    }
  }
  try {
    domain = normalizeBaseUri(domain);
  } catch {
    process.stderr.write(`invalid domain or URI: ${domain}\n`);
    return 1;
  }

  // 2. Default template, offered from the chosen domain's live list. A flag
  // value is recorded as given (scripted runs may be offline); if the listing
  // can't be fetched the key is simply left unset — the server default applies.
  let template = flags.template;
  if (template === undefined && interactive) {
    try {
      const available = await fetchTemplates(domain);
      process.stderr.write(`Templates on ${domain}: ${available.templates.join(', ')}\n`);
      const answer = await promptLine(`Default template [${available.default}]: `);
      const requested = answer === undefined || answer.trim() === '' ? available.default : answer.trim();
      template = resolveTemplate(requested, available);
    } catch (error) {
      if (error instanceof UnknownTemplateError) {
        process.stderr.write(`${error.message}\n`);
        return 1;
      }
      process.stderr.write(
        `could not list templates from ${domain} (${(error as Error).message}); leaving the template unset\n`,
      );
    }
  }

  // 3. Where to write: the per-user config (default) or a local .plandrop.
  let target: 'user' | 'local';
  if (flags.local) {
    target = 'local';
  } else if (flags.user || !interactive) {
    target = 'user';
  } else {
    const answer = await promptLine(
      'Write the [u]ser config (~/.config/plandrop/config.json) or a [l]ocal .plandrop here? [u]: ',
    );
    target = answer !== undefined && answer.trim().toLowerCase().startsWith('l') ? 'local' : 'user';
  }

  // Overwrite guard — user tier only: the local target is a pure merge that
  // never loses a host/passphrase, but an existing personal config is not
  // touched without explicit say-so.
  const personalPath = userConfigPath(process.env.XDG_CONFIG_HOME, homedir());
  if (target === 'user' && existsSync(personalPath) && !flags.force) {
    if (interactive) {
      const answer = await promptLine(
        `${personalPath} already exists — [u]pdate it, write a [l]ocal .plandrop instead, or [a]bort? [a]: `,
      );
      const choice = (answer ?? '').trim().toLowerCase();
      if (choice.startsWith('l')) {
        target = 'local';
      } else if (!choice.startsWith('u')) {
        process.stderr.write('aborted; config untouched\n');
        return 1;
      }
    } else {
      process.stderr.write(
        `${personalPath} already exists; pass --force to update it, or --local to write a .plandrop here instead\n`,
      );
      return 1;
    }
  }

  const patch: UserConfig = { domain };
  if (template !== undefined) {
    patch.template = template;
  }
  const written =
    target === 'user'
      ? writeUserConfig(personalPath, patch)
      : mergeDotfileConfig(process.cwd(), patch);
  process.stdout.write(`wrote ${resolve(written)}\n`);
  if (domain === PUBLIC_TEMPLATE_HOST) {
    process.stdout.write(
      'next: `plandrop newdoc plan.html` — to publish, stand up your own server (`plandrop help server`)\n',
    );
  } else {
    process.stdout.write(
      'next: `plandrop create` to mint a host, `plandrop newdoc plan.html` to start a document\n',
    );
  }
  return 0;
}

interface InitFlags {
  domain: string | undefined;
  template: string | undefined;
  local: boolean;
  user: boolean;
  yes: boolean;
  force: boolean;
}

function parseFlags(params: readonly string[]): InitFlags {
  const flags: InitFlags = {
    domain: undefined,
    template: undefined,
    local: false,
    user: false,
    yes: false,
    force: false,
  };
  for (let i = 0; i < params.length; i += 1) {
    const param = params[i];
    if (param === '--local') {
      flags.local = true;
    } else if (param === '--user') {
      flags.user = true;
    } else if (param === '--yes') {
      flags.yes = true;
    } else if (param === '--force') {
      flags.force = true;
    } else if (param === '--domain') {
      flags.domain = params[i + 1];
      i += 1;
    } else if (param?.startsWith('--domain=')) {
      flags.domain = param.slice('--domain='.length);
    } else if (param === '--template') {
      flags.template = params[i + 1];
      i += 1;
    } else if (param?.startsWith('--template=')) {
      flags.template = param.slice('--template='.length);
    }
  }
  return flags;
}
