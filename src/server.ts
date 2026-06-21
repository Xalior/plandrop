import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { generateLabel, generatePassphrase } from './generate';
import { hasEntry, removeEntry, setEntry, verifyEntry } from './htpasswd';
import type { CreateResponse, RotateResponse } from './types';

// The control plane is domain-free: it mints bare host labels and the shared
// htpasswd. The client composes the full host.domain name from its own domain.
const HOSTS_DIR = process.env.PLANDROP_HOSTS_DIR ?? '/srv/hosts';
const AUTH_FILE = process.env.PLANDROP_AUTH_FILE ?? '/srv/auth/htpasswd';
const PORT = Number(process.env.PLANDROP_CONTROL_PORT ?? '8081');
const MAX_COLLISION_RETRIES = 10;

export const app = new Hono();

// Host labels are 16 base32 chars; reject anything else before it reaches the
// filesystem or htpasswd lookup (defence against path traversal in :host).
const LABEL_PATTERN = /^[a-z2-7]{16}$/;

// No auth: anyone who can reach the control plane may create a host.
app.post('/api/hosts', async (c) => {
  const created = await createHost();
  return c.json(created, 201);
});

// Manage an existing host: Basic host:passphrase, where the username must equal
// the URL :host and the passphrase verifies against that host's htpasswd entry.
app.post('/api/hosts/:host/rotate', async (c) => {
  const host = c.req.param('host');
  if (!(await authorize(host, c.req.header('authorization')))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const passphrase = generatePassphrase();
  await setEntry(AUTH_FILE, host, passphrase);
  return c.json({ passphrase } satisfies RotateResponse);
});

app.delete('/api/hosts/:host', async (c) => {
  const host = c.req.param('host');
  if (!(await authorize(host, c.req.header('authorization')))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await rm(join(HOSTS_DIR, host), { recursive: true, force: true });
  await removeEntry(AUTH_FILE, host);
  return c.body(null, 204);
});

interface BasicCredentials {
  user: string;
  pass: string;
}

function parseBasic(header: string | undefined): BasicCredentials | null {
  if (header === undefined || !header.startsWith('Basic ')) {
    return null;
  }
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator === -1) {
    return null;
  }
  return { user: decoded.slice(0, separator), pass: decoded.slice(separator + 1) };
}

/** True only if the creds are Basic, the user equals :host, and the passphrase verifies. */
async function authorize(host: string, header: string | undefined): Promise<boolean> {
  if (!LABEL_PATTERN.test(host)) {
    return false;
  }
  const creds = parseBasic(header);
  return (
    creds !== null && creds.user === host && (await verifyEntry(AUTH_FILE, host, creds.pass))
  );
}

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
