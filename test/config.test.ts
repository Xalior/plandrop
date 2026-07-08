import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readConfigFile,
  systemConfig,
  systemConfigPaths,
  userConfigPath,
  writeUserConfig,
} from '../src/config';

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'plandrop-config-'));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe('userConfigPath', () => {
  it('honours XDG_CONFIG_HOME', () => {
    expect(userConfigPath('/xdg/home', '/home/u')).toBe('/xdg/home/plandrop/config.json');
  });

  it('defaults to ~/.config when XDG_CONFIG_HOME is unset or blank', () => {
    expect(userConfigPath(undefined, '/home/u')).toBe('/home/u/.config/plandrop/config.json');
    expect(userConfigPath('  ', '/home/u')).toBe('/home/u/.config/plandrop/config.json');
  });
});

describe('writeUserConfig', () => {
  it('creates the directory, writes mode 0600, and round-trips', () => {
    const path = join(workdir, 'deep', 'plandrop', 'config.json');
    writeUserConfig(path, { domain: 'https://a.example', template: 'darkly' });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readConfigFile(path)).toEqual({ domain: 'https://a.example', template: 'darkly' });
  });

  it('merges over an existing file, preserving unrelated keys', () => {
    const path = join(workdir, 'config.json');
    writeFileSync(path, JSON.stringify({ domain: 'https://old.example', custom: 'kept' }));
    writeUserConfig(path, { template: 'darkly' });
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    expect(raw).toEqual({ domain: 'https://old.example', custom: 'kept', template: 'darkly' });
  });
});

describe('readConfigFile', () => {
  it('treats a missing or malformed file as no preferences', () => {
    expect(readConfigFile(join(workdir, 'nope.json'))).toEqual({});
    const path = join(workdir, 'bad.json');
    writeFileSync(path, 'not json');
    expect(readConfigFile(path)).toEqual({});
  });

  it('ignores non-string values', () => {
    const path = join(workdir, 'config.json');
    writeFileSync(path, JSON.stringify({ domain: 42, template: 'darkly' }));
    expect(readConfigFile(path)).toEqual({ template: 'darkly' });
  });
});

describe('systemConfigPaths', () => {
  it('expands each XDG_CONFIG_DIRS entry, then /etc and Homebrew fallbacks', () => {
    expect(systemConfigPaths({ XDG_CONFIG_DIRS: '/a:/b' })).toEqual([
      '/a/plandrop/config.json',
      '/b/plandrop/config.json',
      '/etc/plandrop/config.json',
      '/opt/homebrew/etc/plandrop/config.json',
      '/usr/local/etc/plandrop/config.json',
    ]);
  });

  it('defaults XDG_CONFIG_DIRS to /etc/xdg', () => {
    expect(systemConfigPaths({})[0]).toBe('/etc/xdg/plandrop/config.json');
  });
});

describe('systemConfig', () => {
  it('takes each key from the first file that defines it', () => {
    const first = join(workdir, 'first');
    const second = join(workdir, 'second');
    mkdirSync(join(first, 'plandrop'), { recursive: true });
    mkdirSync(join(second, 'plandrop'), { recursive: true });
    writeFileSync(join(first, 'plandrop', 'config.json'), JSON.stringify({ template: 'darkly' }));
    writeFileSync(
      join(second, 'plandrop', 'config.json'),
      JSON.stringify({ domain: 'https://sys.example', template: 'ignored' }),
    );
    expect(systemConfig({ XDG_CONFIG_DIRS: `${first}:${second}` })).toEqual({
      domain: 'https://sys.example',
      template: 'darkly',
    });
  });

  it('is empty when nothing exists on the search path', () => {
    expect(systemConfig({ XDG_CONFIG_DIRS: join(workdir, 'missing') })).toEqual({});
  });
});
