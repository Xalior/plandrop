import { loadContext } from '../context';
import { writeDotfile } from '../dotfile';
import { controlUrl } from '../endpoint';
import type { Dispatch } from '../dispatch';
import type { RotateResponse } from '../types';

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
    res = await fetch(controlUrl(ctx.base, `/api/hosts/${ctx.host}/rotate`), {
      method: 'POST',
      headers: { Authorization: basicAuth(ctx.host, ctx.passphrase) },
    });
  } catch (error) {
    process.stderr.write(`rotate failed: ${(error as Error).message}\n`);
    return 1;
  }

  if (res.status === 401) {
    process.stderr.write('rotate failed: 401 (wrong passphrase); .plandrop untouched\n');
    return 1;
  }
  if (!res.ok) {
    process.stderr.write(`rotate failed: control plane responded ${res.status}\n`);
    return 1;
  }

  const body = (await res.json()) as Partial<RotateResponse>;
  if (typeof body.passphrase !== 'string') {
    process.stderr.write('rotate failed: unexpected response from control plane\n');
    return 1;
  }

  writeDotfile(ctx.dotfileDir, { ...ctx.dotfile, passphrase: body.passphrase });
  process.stdout.write('passphrase rotated; .plandrop updated\n');
  return 0;
}

function basicAuth(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}
