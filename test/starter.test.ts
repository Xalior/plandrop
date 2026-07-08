import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run as server } from '../src/commands/server';

const starterPath = fileURLToPath(new URL('../scripts/start.sh', import.meta.url));

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'plandrop-starter-'));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

function runStarter(env: NodeJS.ProcessEnv) {
  // /bin/sh absolute: the empty-PATH case must still find the shell itself.
  return spawnSync('/bin/sh', [starterPath], { cwd: workdir, encoding: 'utf8', env });
}

describe('scripts/start.sh', () => {
  it('prints a clear message and exits non-zero when Docker is missing', () => {
    // An empty PATH dir: `command -v docker` fails before anything else runs.
    const emptyBin = join(workdir, 'bin');
    mkdirSync(emptyBin);
    const result = runStarter({ PATH: emptyBin });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Docker is not installed/);
    expect(result.stderr).toMatch(/never installs/);
    expect(existsSync(join(workdir, '.env'))).toBe(false);
  });

  it('writes a localhost .env, pulls, and brings the stack up with Docker present', () => {
    // A logging docker shim stands in for the real thing; the compose file is
    // pre-placed so no network fetch happens.
    const fakeBin = join(workdir, 'fakebin');
    mkdirSync(fakeBin);
    const log = join(workdir, 'docker.log');
    writeFileSync(join(fakeBin, 'docker'), `#!/bin/sh\necho "docker $*" >> "${log}"\nexit 0\n`);
    chmodSync(join(fakeBin, 'docker'), 0o755);
    writeFileSync(join(workdir, 'compose.proxy.yml'), 'services: {}\n');

    const result = runStarter({ PATH: `${fakeBin}:/usr/bin:/bin` });
    expect(result.status).toBe(0);

    const env = readFileSync(join(workdir, '.env'), 'utf8');
    expect(env).toContain('PLANDROP_BIND=127.0.0.1');
    expect(env).toContain('PLANDROP_PROXY_PORT=8083');
    expect(env).toContain('COMPOSE_FILE=compose.proxy.yml');

    const calls = readFileSync(log, 'utf8');
    expect(calls).toContain('docker compose -f compose.proxy.yml pull');
    expect(calls).toContain('docker compose -f compose.proxy.yml up -d');

    expect(result.stdout).toContain('http://localhost:8083');
    expect(result.stdout).toContain('npx plandrop init --domain http://localhost:8083');
    expect(existsSync(join(workdir, 'data', 'hosts'))).toBe(true);
  });

  it('keeps an existing .env and reports its port', () => {
    const fakeBin = join(workdir, 'fakebin');
    mkdirSync(fakeBin);
    writeFileSync(join(fakeBin, 'docker'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(fakeBin, 'docker'), 0o755);
    writeFileSync(join(workdir, 'compose.proxy.yml'), 'services: {}\n');
    writeFileSync(join(workdir, '.env'), 'PLANDROP_PROXY_PORT=9090\n');

    const result = runStarter({ PATH: `${fakeBin}:/usr/bin:/bin` });
    expect(result.status).toBe(0);
    expect(readFileSync(join(workdir, '.env'), 'utf8')).toBe('PLANDROP_PROXY_PORT=9090\n');
    expect(result.stdout).toContain('http://localhost:9090');
  });
});

describe('server command', () => {
  it('downloads the starter and runs it, returning its exit code', async () => {
    const marker = join(workdir, 'ran');
    const script = `#!/bin/sh\necho started > "${marker}"\nexit 0\n`;
    const httpServer = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/x-shellscript' });
      res.end(script);
    });
    const url = await new Promise<string>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        resolve(`http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/start.sh`);
      });
    });
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    process.env.PLANDROP_STARTER_URL = url;
    try {
      const code = await server({ command: 'server', hashOverride: undefined, params: [] });
      expect(code).toBe(0);
      expect(readFileSync(marker, 'utf8')).toBe('started\n');
    } finally {
      delete process.env.PLANDROP_STARTER_URL;
      err.mockRestore();
      httpServer.close();
    }
  });

  it('fails cleanly when the starter cannot be fetched', async () => {
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    process.env.PLANDROP_STARTER_URL = 'http://127.0.0.1:1/start.sh';
    try {
      const code = await server({ command: 'server', hashOverride: undefined, params: [] });
      const written = err.mock.calls.map((call) => String(call[0])).join('');
      expect(code).toBe(1);
      expect(written).toMatch(/server failed:/);
    } finally {
      delete process.env.PLANDROP_STARTER_URL;
      err.mockRestore();
    }
  });
});
