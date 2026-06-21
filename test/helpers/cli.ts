import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));

export interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface CliOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Written to the child's stdin then closed. Default '' = immediate EOF. */
  input?: string;
}

/** Run the built CLI (dist/cli.js) as a child process — drives it "for real". */
export function runCli(args: string[], options: CliOptions): CliResult {
  const result = spawnSync('node', [cliPath, ...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    input: options.input ?? '',
    encoding: 'utf8',
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}
