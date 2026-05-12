import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export class CryptoError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CryptoError';
  }
}

/**
 * Resolve the AES-256-GCM key for encrypting `PlatformConnection.jwtSecretCiphertext`
 * and `credentialsCiphertext`. The key is 32 bytes, hex-encoded in the env var.
 */
export const loadEncryptionKey = (
  envValue: string | undefined = process.env.SCHEDULER_SECRET_KEY,
): Buffer => {
  if (!envValue) {
    throw new CryptoError(
      'SCHEDULER_SECRET_KEY is required to encrypt/decrypt PlatformConnection secrets ' +
        `(expected ${KEY_LENGTH}-byte hex string)`,
    );
  }
  const key = Buffer.from(envValue, 'hex');
  if (key.length !== KEY_LENGTH) {
    throw new CryptoError(
      `SCHEDULER_SECRET_KEY must decode to ${KEY_LENGTH} bytes; got ${key.length}`,
    );
  }
  return key;
};

/**
 * Encrypt with AES-256-GCM.
 * Output layout: `[iv (12) || authTag (16) || ciphertext]` — single blob suitable
 * for direct storage in a Prisma `Bytes` column.
 */
export const encrypt = (plaintext: string, key: Buffer): Buffer => {
  if (key.length !== KEY_LENGTH) {
    throw new CryptoError(`encryption key must be ${KEY_LENGTH} bytes`);
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
};

/**
 * Decrypt a blob produced by `encrypt`. Throws CryptoError on tamper, wrong key,
 * or malformed input — never returns partial data.
 */
export const decrypt = (blob: Buffer, key: Buffer): string => {
  if (key.length !== KEY_LENGTH) {
    throw new CryptoError(`decryption key must be ${KEY_LENGTH} bytes`);
  }
  if (blob.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new CryptoError('ciphertext blob is shorter than iv + authTag');
  }
  const iv = blob.subarray(0, IV_LENGTH);
  const authTag = blob.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (err) {
    throw new CryptoError('decryption failed (wrong key or tampered ciphertext)', { cause: err });
  }
};

/**
 * One-way hash for `Worker.bearerTokenHash`. The token itself is returned to
 * the worker at registration; the control-plane only persists this hash and
 * compares with constant-time equality on subsequent requests.
 */
export const hashToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

/** Constant-time hex string comparison for credential checks. */
export const safeEqualHex = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let buf1: Buffer;
  let buf2: Buffer;
  try {
    buf1 = Buffer.from(a, 'hex');
    buf2 = Buffer.from(b, 'hex');
  } catch {
    return false;
  }
  if (buf1.length !== buf2.length || buf1.length === 0) return false;
  return timingSafeEqual(buf1, buf2);
};

/** HMAC-SHA256 used by signed-URL artifact downloads. */
export const hmacSha256 = (data: string, key: Buffer | string): string =>
  createHmac('sha256', key).update(data, 'utf8').digest('hex');

/**
 * Cryptographically random hex token. Default 32 bytes = 64 hex chars,
 * which is what we issue for worker bearer tokens.
 */
export const generateToken = (byteLength = 32): string =>
  randomBytes(byteLength).toString('hex');
