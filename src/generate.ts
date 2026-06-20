import { randomBytes } from 'node:crypto';

// RFC 4648 base32, lowercase — DNS-safe (letters + digits 2-7), no padding.
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

// 10 random bytes = 80 bits = exactly 16 base32 chars.
const LABEL_BYTES = 10;
// 16 random bytes = 128 bits = 22 base64url chars (no padding).
const PASSPHRASE_BYTES = 16;

/** A host label: 16 base32 chars (~80 bits of entropy). */
export function generateLabel(): string {
  const bytes = randomBytes(LABEL_BYTES);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(value >>> bits) & 0x1f];
    }
    value &= (1 << bits) - 1;
  }
  return out;
}

/** A passphrase: 22 base64url chars (~128 bits), ASCII-only. */
export function generatePassphrase(): string {
  return randomBytes(PASSPHRASE_BYTES).toString('base64url');
}
