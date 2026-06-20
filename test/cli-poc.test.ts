import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The runnable proof: build the package, pack it to a tarball, then drive it
// through a real `npx <tarball>` invocation exactly as an end user would.
const pkgRoot = fileURLToPath(new URL('..', import.meta.url));
let packDir: string;
let tarball: string;

beforeAll(() => {
  execFileSync('npm', ['run', 'build'], { cwd: pkgRoot, stdio: 'pipe' });
  packDir = mkdtempSync(join(tmpdir(), 'plandrop-pack-'));
  execFileSync('npm', ['pack', '--pack-destination', packDir], {
    cwd: pkgRoot,
    stdio: 'pipe',
  });
  const file = readdirSync(packDir).find((name) => name.endsWith('.tgz'));
  if (file === undefined) {
    throw new Error('npm pack produced no tarball');
  }
  tarball = join(packDir, file);
});

afterAll(() => {
  if (packDir !== undefined) {
    rmSync(packDir, { recursive: true, force: true });
  }
});

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runNpx(args: string[]): RunResult {
  // Install the packed tarball into npx's cache and run its `plandrop` bin.
  // The `-p <tarball> <bin>` form is required for an absolute tarball path; a
  // bare `npx <abs-path.tgz>` is misread as a command to exec, not a package.
  try {
    const stdout = execFileSync('npx', ['--yes', '-p', tarball, 'plandrop', ...args], {
      cwd: pkgRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const result = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  }
}

describe('build output', () => {
  it('produces dist/cli.js with a node shebang', () => {
    const cli = join(pkgRoot, 'dist', 'cli.js');
    expect(existsSync(cli)).toBe(true);
    expect(readFileSync(cli, 'utf8').startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('makes dist/cli.js executable', () => {
    const { mode } = statSync(join(pkgRoot, 'dist', 'cli.js'));
    expect(mode & 0o111).not.toBe(0);
  });
});

describe('npx invocation', () => {
  it('create prints the stub and exits 0', () => {
    const result = runNpx(['create']);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/would create/i);
    expect(result.stdout).toMatch(/hash source: dotfile/);
  });

  it('a >= 8-char hash before the command takes the override path', () => {
    const result = runNpx(['abcdef123456', 'create']);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/hash source: override \(abcdef123456\)/);
  });

  it('an unknown command exits non-zero with usage on stderr', () => {
    const result = runNpx(['frobnic']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Usage:/);
  });
});

describe('cleanup discipline', () => {
  it('leaves no tarball in the package directory', () => {
    const stray = readdirSync(pkgRoot).filter((name) => name.endsWith('.tgz'));
    expect(stray).toEqual([]);
  });
});
