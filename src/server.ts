import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { generateLabel, generatePassphrase } from './generate';
import { hasEntry, setEntry } from './htpasswd';
import type { CreateResponse } from './types';

// The control plane is domain-free: it mints bare host labels and the shared
// htpasswd. The client composes the full host.domain name from its own domain.
const HOSTS_DIR = process.env.PLANDROP_HOSTS_DIR ?? '/srv/hosts';
const AUTH_FILE = process.env.PLANDROP_AUTH_FILE ?? '/srv/auth/htpasswd';
const PORT = Number(process.env.PLANDROP_CONTROL_PORT ?? '8081');
const MAX_COLLISION_RETRIES = 10;

export const app = new Hono();

// No auth: anyone who can reach the control plane may create a host.
app.post('/api/hosts', async (c) => {
  const created = await createHost();
  return c.json(created, 201);
});

async function createHost(): Promise<CreateResponse> {
  for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt += 1) {
    const host = generateLabel();
    if ((await pathExists(join(HOSTS_DIR, host))) || (await hasEntry(AUTH_FILE, host))) {
      continue;
    }
    const passphrase = generatePassphrase();
    await mkdir(join(HOSTS_DIR, host, 'www'), { recursive: true });
    await setEntry(AUTH_FILE, host, passphrase);
    return { host, passphrase };
  }
  throw new Error('could not allocate a unique host label');
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' });
