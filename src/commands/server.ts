import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { timedFetch } from '../endpoint';
import { printCommandHelp, wantsHelp } from '../usage';
import type { Dispatch } from '../dispatch';

/**
 * Where the canonical starter script is published. Overridable via
 * PLANDROP_STARTER_URL (tests, mirrors); the script itself is committed in the
 * repo at scripts/start.sh and served from plandrop.dev as a static asset.
 */
const STARTER_URL = 'https://plandrop.dev/start.sh';

/**
 * Download the plandrop.dev starter and run it in the current directory — the
 * one sanctioned CLI-drives-Docker path. The script does the real work (check
 * Docker, write a localhost .env, fetch the compose file, pull + up); this
 * command just makes it discoverable without remembering a URL.
 */
export async function run(dispatch: Dispatch): Promise<number> {
  if (wantsHelp(dispatch.params)) {
    printCommandHelp('server');
    return 0;
  }

  const url = process.env.PLANDROP_STARTER_URL ?? STARTER_URL;
  let script: string;
  try {
    const res = await timedFetch(url);
    if (!res.ok) {
      throw new Error(`starter request responded ${res.status}`);
    }
    script = await res.text();
  } catch (error) {
    process.stderr.write(`server failed: ${(error as Error).message}\n`);
    return 1;
  }

  const path = join(mkdtempSync(join(tmpdir(), 'plandrop-server-')), 'start.sh');
  writeFileSync(path, script, { mode: 0o700 });
  process.stderr.write(`running the plandrop server starter (${url}) ...\n`);
  try {
    return await runScript(path);
  } catch (error) {
    process.stderr.write(`server failed: ${(error as Error).message}\n`);
    return 1;
  }
}

function runScript(path: string): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('sh', [path], { stdio: 'inherit' });
    child.on('error', rejectPromise);
    child.on('exit', (code) => resolvePromise(code ?? 1));
  });
}
