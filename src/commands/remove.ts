import { unlinkSync } from 'node:fs';
import { loadContext } from '../context';
import { controlUrl } from '../endpoint';
import type { Dispatch } from '../dispatch';

export async function run(dispatch: Dispatch): Promise<number> {
  let ctx;
  try {
    ctx = loadContext(process.cwd(), dispatch.hashOverride);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }

  let res: Response;
  try {
    res = await fetch(controlUrl(ctx.base, `/api/hosts/${ctx.host}`), {
      method: 'DELETE',
      headers: { Authorization: basicAuth(ctx.host, ctx.passphrase) },
    });
  } catch (error) {
    process.stderr.write(`remove failed: ${(error as Error).message}\n`);
    return 1;
  }

  if (res.status === 401) {
    process.stderr.write('remove failed: 401 (wrong passphrase); .plandrop untouched\n');
    return 1;
  }
  if (!res.ok) {
    process.stderr.write(`remove failed: control plane responded ${res.status}\n`);
    return 1;
  }

  unlinkSync(ctx.dotfilePath);
  process.stdout.write('host removed; local .plandrop deleted\n');
  return 0;
}

function basicAuth(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}
