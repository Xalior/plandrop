import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hasEntry, removeEntry, setEntry, verifyEntry } from '../src/htpasswd';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'plandrop-htpasswd-'));
  file = join(dir, 'auth', 'htpasswd');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('htpasswd manager', () => {
  it('writes a $2b$ bcrypt entry that verifies', async () => {
    await setEntry(file, 'alpha', 'secret-pass');
    const line = readFileSync(file, 'utf8').trim();
    expect(line.startsWith('alpha:$2b$')).toBe(true);
    expect(await verifyEntry(file, 'alpha', 'secret-pass')).toBe(true);
    expect(await verifyEntry(file, 'alpha', 'wrong-pass')).toBe(false);
  });

  it('reports presence and verifies unknown users as false', async () => {
    expect(await hasEntry(file, 'ghost')).toBe(false);
    expect(await verifyEntry(file, 'ghost', 'x')).toBe(false);
    await setEntry(file, 'ghost', 'boo');
    expect(await hasEntry(file, 'ghost')).toBe(true);
  });

  it('replaces an existing entry in place without duplicating', async () => {
    await setEntry(file, 'beta', 'first');
    await setEntry(file, 'beta', 'second');
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines.filter((l) => l.startsWith('beta:'))).toHaveLength(1);
    expect(await verifyEntry(file, 'beta', 'second')).toBe(true);
    expect(await verifyEntry(file, 'beta', 'first')).toBe(false);
  });

  it('removes entries and reports whether one existed', async () => {
    await setEntry(file, 'gamma', 'pw');
    expect(await removeEntry(file, 'gamma')).toBe(true);
    expect(await removeEntry(file, 'gamma')).toBe(false);
    expect(await hasEntry(file, 'gamma')).toBe(false);
  });

  it('serialises concurrent writes without losing entries or leaving temp files', async () => {
    const users = Array.from({ length: 20 }, (_, i) => `user${i}`);
    await Promise.all(users.map((u) => setEntry(file, u, `pw-${u}`)));
    const entries = readFileSync(file, 'utf8').trim().split('\n');
    expect(entries).toHaveLength(users.length);
    for (const u of users) {
      expect(await verifyEntry(file, u, `pw-${u}`)).toBe(true);
    }
    const leftovers = readdirSync(join(dir, 'auth')).filter((f) => f.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });
});
