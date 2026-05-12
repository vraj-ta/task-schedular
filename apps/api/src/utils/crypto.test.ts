import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  CryptoError,
  decrypt,
  encrypt,
  generateToken,
  hashToken,
  hmacSha256,
  loadEncryptionKey,
  safeEqualHex,
} from './crypto.js';

const freshKey = (): Buffer => randomBytes(32);

describe('encrypt / decrypt (AES-256-GCM)', () => {
  it('round-trips an arbitrary string', () => {
    const key = freshKey();
    const plain = 'super-secret-jwt-signing-key-for-project-X';
    const blob = encrypt(plain, key);
    expect(decrypt(blob, key)).toBe(plain);
  });

  it('produces different ciphertext each call (random IV)', () => {
    const key = freshKey();
    const plain = 'identical input';
    const a = encrypt(plain, key);
    const b = encrypt(plain, key);
    expect(a.equals(b)).toBe(false);
    expect(decrypt(a, key)).toBe(plain);
    expect(decrypt(b, key)).toBe(plain);
  });

  it('rejects a tampered authTag', () => {
    const key = freshKey();
    const blob = encrypt('hello', key);
    // Flip a bit inside the authTag region (bytes 12..27).
    blob[15] = blob[15]! ^ 0x01;
    expect(() => decrypt(blob, key)).toThrow(CryptoError);
  });

  it('rejects a tampered ciphertext byte', () => {
    const key = freshKey();
    const blob = encrypt('hello world this is long enough to mutate', key);
    blob[blob.length - 1] = blob[blob.length - 1]! ^ 0xff;
    expect(() => decrypt(blob, key)).toThrow(CryptoError);
  });

  it('rejects the wrong key', () => {
    const blob = encrypt('secret', freshKey());
    expect(() => decrypt(blob, freshKey())).toThrow(CryptoError);
  });

  it('rejects a key of wrong length', () => {
    expect(() => encrypt('x', randomBytes(16))).toThrow(/32 bytes/);
    expect(() => decrypt(Buffer.alloc(64), randomBytes(16))).toThrow(/32 bytes/);
  });

  it('rejects a truncated blob', () => {
    expect(() => decrypt(Buffer.alloc(10), freshKey())).toThrow(/shorter than/);
  });
});

describe('loadEncryptionKey', () => {
  it('parses a valid 32-byte hex key', () => {
    const key = randomBytes(32).toString('hex');
    expect(loadEncryptionKey(key)).toHaveLength(32);
  });

  it('throws when the env var is missing', () => {
    expect(() => loadEncryptionKey(undefined)).toThrow(CryptoError);
  });

  it('throws when the key decodes to the wrong length', () => {
    expect(() => loadEncryptionKey(randomBytes(16).toString('hex'))).toThrow(/32 bytes/);
  });
});

describe('hashToken', () => {
  it('is deterministic and 64 hex chars (sha256)', () => {
    const t = 'abc';
    const h = hashToken(t);
    expect(h).toHaveLength(64);
    expect(hashToken(t)).toBe(h);
  });

  it('differs across inputs', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});

describe('safeEqualHex', () => {
  it('returns true for identical hex strings', () => {
    expect(safeEqualHex('deadbeef', 'deadbeef')).toBe(true);
  });

  it('returns false for different lengths', () => {
    expect(safeEqualHex('dead', 'deadbeef')).toBe(false);
  });

  it('returns false for different values of equal length', () => {
    expect(safeEqualHex('dead0000', 'beef0000')).toBe(false);
  });

  it('returns false for non-hex input rather than throwing', () => {
    expect(safeEqualHex('zzzz', 'zzzz')).toBe(false);
  });

  it('returns false for empty strings', () => {
    expect(safeEqualHex('', '')).toBe(false);
  });
});

describe('hmacSha256', () => {
  it('matches a known vector', () => {
    // RFC 4231 test case 1: key='\x0b'*20, data='Hi There' → first 64 hex chars
    const key = Buffer.alloc(20, 0x0b);
    expect(hmacSha256('Hi There', key)).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    );
  });
});

describe('generateToken', () => {
  it('returns 64 hex chars by default (32 bytes)', () => {
    const t = generateToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it('respects custom byte lengths', () => {
    expect(generateToken(16)).toHaveLength(32);
  });

  it('does not repeat across calls', () => {
    expect(generateToken()).not.toBe(generateToken());
  });
});
