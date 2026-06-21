import { homedir } from 'node:os';
import { DomainError, resolveDomain } from '../domain';
import { dotfileExists, hostUrl, writeDotfile } from '../dotfile';
import { promptLine } from '../prompt';
import type { Dispatch } from '../dispatch';
import type { CreateResponse } from '../types';

export async function run(dispatch: Dispatch): Promise<number> {
  const { force, domain: domainFlag } = parseFlags(dispatch.params);
  const cwd = process.cwd();

  if (dotfileExists(cwd) && !force) {
    process.stderr.write('a .plandrop already exists here; pass --force to replace it\n');
    return 1;
  }

  let domain: string;
  try {
    domain = await resolveDomain({
      flag: domainFlag,
      env: process.env,
      cwd,
      configHome: process.env.XDG_CONFIG_HOME,
      home: homedir(),
      prompt: () => promptLine('Domain: '),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }

  let created: CreateResponse;
  try {
    created = await createHost(domain);
  } catch (error) {
    process.stderr.write(`create failed: ${(error as Error).message}\n`);
    return 1;
  }

  // Only written on success, so a failed create never leaves a dotfile behind.
  const path = writeDotfile(cwd, { domain, host: created.host, passphrase: created.passphrase });
  process.stdout.write(`created ${hostUrl(created.host, domain)}\n`);
  process.stdout.write(`wrote ${path} (mode 0600) — it holds your passphrase; don't commit it\n`);
  return 0;
}

async function createHost(domain: string): Promise<CreateResponse> {
  const res = await fetch(`http://${domain}/api/hosts`, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`control plane responded ${res.status}`);
  }
  const body = (await res.json()) as Partial<CreateResponse>;
  if (typeof body.host !== 'string' || typeof body.passphrase !== 'string') {
    throw new Error('control plane returned an unexpected response');
  }
  return { host: body.host, passphrase: body.passphrase };
}

function parseFlags(params: readonly string[]): { force: boolean; domain: string | undefined } {
  let force = false;
  let domain: string | undefined;
  for (let i = 0; i < params.length; i += 1) {
    const param = params[i];
    if (param === '--force') {
      force = true;
    } else if (param === '--domain') {
      domain = params[i + 1];
      i += 1;
    } else if (param?.startsWith('--domain=')) {
      domain = param.slice('--domain='.length);
    }
  }
  return { force, domain };
}
