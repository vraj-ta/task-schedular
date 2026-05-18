import bcrypt from 'bcryptjs';

/**
 * bcrypt wrappers for operator (`AdminUser`) credentials.
 *
 * Kept separate from `utils/crypto.ts` because that module owns symmetric
 * secrets (AES-256-GCM for PlatformConnection JWT secrets) and one-way hashes
 * for capability tokens — different threat model than user passwords.
 */

export const hashPassword = async (plaintext: string, rounds: number): Promise<string> =>
  bcrypt.hash(plaintext, rounds);

export const verifyPassword = async (plaintext: string, hash: string): Promise<boolean> =>
  bcrypt.compare(plaintext, hash);
