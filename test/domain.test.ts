import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DomainError, resolveDomain, type DomainSources } from '../src/domain';

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'plandrop-domain-'));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

function sources(overrides: Partial<DomainSources>): DomainSources {
  return {
    flag: undefined,
    env: {},
    cwd: join(workdir, 'empty'),
    configHome: join(workdir, 'no-config'),
    home: join(workdir, 'no-home'),
    prompt: () => Promise.resolve(undefined),
    ...overrides,
  };
}

function writeRepoDotfile(domain: string): string {
  const dir = join(workdir, 'repo');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.plandrop'), JSON.stringify({ domain, host: 'h', passphrase: 'p' }));
  return dir;
}

function writeUserConfig(domain: string): string {
  const configHome = join(workdir, 'xdg');
  mkdirSync(join(configHome, 'plandrop'), { recursive: true });
  writeFileSync(join(configHome, 'plandrop', 'config.json'), JSON.stringify({ domain }));
  return configHome;
}

describe('resolveDomain precedence', () => {
  it('prefers the flag over everything else (bare hostname -> https)', async () => {
    const domain = await resolveDomain(
      sources({
        flag: 'flag.example',
        env: { PLANDROP_DOMAIN: 'env.example' },
        cwd: writeRepoDotfile('https://repo.example'),
        configHome: writeUserConfig('https://user.example'),
        prompt: () => Promise.resolve('prompt.example'),
      }),
    );
    expect(domain).toBe('https://flag.example');
  });

  it('preserves an explicit http URI from the flag', async () => {
    const domain = await resolveDomain(sources({ flag: 'http://localhost:8080' }));
    expect(domain).toBe('http://localhost:8080');
  });

  it('falls to env when no flag', async () => {
    const domain = await resolveDomain(
      sources({
        env: { PLANDROP_DOMAIN: 'env.example' },
        cwd: writeRepoDotfile('https://repo.example'),
      }),
    );
    expect(domain).toBe('https://env.example');
  });

  it('falls to the repo .plandrop over the user config', async () => {
    const domain = await resolveDomain(
      sources({
        cwd: writeRepoDotfile('https://repo.example'),
        configHome: writeUserConfig('https://user.example'),
      }),
    );
    expect(domain).toBe('https://repo.example');
  });

  it('falls to the user config when no flag/env/repo', async () => {
    const domain = await resolveDomain(sources({ configHome: writeUserConfig('https://user.example') }));
    expect(domain).toBe('https://user.example');
  });

  it('falls to the prompt as a last resort', async () => {
    const domain = await resolveDomain(sources({ prompt: () => Promise.resolve('prompt.example') }));
    expect(domain).toBe('https://prompt.example');
  });

  it('ignores a blank flag and an empty prompt, then errors', async () => {
    await expect(
      resolveDomain(sources({ flag: '   ', prompt: () => Promise.resolve(undefined) })),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
