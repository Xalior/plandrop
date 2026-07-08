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
  // dist/ is built once by the global setup; rebuilding here (tsup clean:true)
  // would race other workers that spawn dist/cli.js.
  packDir = mkdtempSync(join(tmpdir(), 'plandrop-pack-'));
  execFileSync('pnpm', ['pack', '--pack-destination', packDir], {
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

function runNpx(args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): RunResult {
  // Install the packed tarball into npx's cache and run its `plandrop` bin.
  // The `-p <tarball> <bin>` form is required for an absolute tarball path; a
  // bare `npx <abs-path.tgz>` is misread as a command to exec, not a package.
  try {
    const stdout = execFileSync('npx', ['--yes', '-p', tarball, 'plandrop', ...args], {
      cwd: opts.cwd ?? pkgRoot,
      env: opts.env ?? process.env,
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
  it('an unknown command exits non-zero pointing at plandrop help', () => {
    const result = runNpx(['frobnic']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unknown command: frobnic/);
    expect(result.stderr).toMatch(/plandrop help/);
  });

  it('create with no domain and closed stdin fails cleanly', () => {
    // Isolated config + cwd + closed stdin (stdio ignore) means no domain can
    // be resolved — a network-free real error, not a stub.
    const cwd = mkdtempSync(join(tmpdir(), 'plandrop-run-'));
    const cfg = mkdtempSync(join(tmpdir(), 'plandrop-cfg-'));
    try {
      const result = runNpx(['create'], {
        cwd,
        env: { ...process.env, XDG_CONFIG_HOME: cfg, PLANDROP_DOMAIN: '' },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/domain/i);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(cfg, { recursive: true, force: true });
    }
  });
});

describe('cleanup discipline', () => {
  it('leaves no tarball in the package directory', () => {
    const stray = readdirSync(pkgRoot).filter((name) => name.endsWith('.tgz'));
    expect(stray).toEqual([]);
  });
});
