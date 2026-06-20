import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { compareSync, hashSync } from 'bcryptjs';

const BCRYPT_COST = 10;

/**
 * Serialises htpasswd edits in-process so concurrent writes can't interleave.
 * The file is the single source of truth; every edit is read-modify-write.
 */
class Mutex {
  private tail: Promise<void> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

const lock = new Mutex();

async function readEntries(file: string): Promise<Map<string, string>> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return new Map();
    }
    throw error;
  }
  const entries = new Map<string, string>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }
    const separator = trimmed.indexOf(':');
    if (separator === -1) {
      continue;
    }
    entries.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
  }
  return entries;
}

/** Write the whole file atomically: temp file + rename, never edited in place. */
async function writeEntries(file: string, entries: Map<string, string>): Promise<void> {
  const body = [...entries].map(([user, hash]) => `${user}:${hash}`).join('\n');
  const text = body === '' ? '' : `${body}\n`;
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  await writeFile(tmp, text, { mode: 0o600 });
  await rename(tmp, file);
}

/** Create or replace the entry for `user` with a bcrypt hash of `passphrase`. */
export function setEntry(file: string, user: string, passphrase: string): Promise<void> {
  // bcryptjs emits the $2b$ tag, which Apache mod_authn_file accepts verbatim.
  const hash = hashSync(passphrase, BCRYPT_COST);
  return lock.run(async () => {
    const entries = await readEntries(file);
    entries.set(user, hash);
    await writeEntries(file, entries);
  });
}

/** Remove `user`'s entry. Resolves true if an entry was removed. */
export function removeEntry(file: string, user: string): Promise<boolean> {
  return lock.run(async () => {
    const entries = await readEntries(file);
    const existed = entries.delete(user);
    if (existed) {
      await writeEntries(file, entries);
    }
    return existed;
  });
}

export async function hasEntry(file: string, user: string): Promise<boolean> {
  return (await readEntries(file)).has(user);
}

/** True if `user` exists and `passphrase` matches their stored bcrypt hash. */
export async function verifyEntry(file: string, user: string, passphrase: string): Promise<boolean> {
  const hash = (await readEntries(file)).get(user);
  return hash !== undefined && compareSync(passphrase, hash);
}
