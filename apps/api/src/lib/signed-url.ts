import { hmacSha256, safeEqualHex } from '../utils/crypto.js';

/**
 * HMAC-signed artifact download URLs.
 *
 * Token format (URL query strings): `e=<unixExpiry>&s=<hexSignature>`
 * Signature is `hmac-sha256(secret, "<artifactId>:<unixExpiry>")`. Verified
 * with constant-time equality + an expiry check.
 *
 * Kept separate from `utils/crypto.ts` because the artifact signing key is
 * distinct from the AES key (different blast radius if leaked).
 */
export interface ArtifactSignerDeps {
  signingKey: string;
}

export interface SignedArtifactToken {
  expiresAt: Date;
  signature: string;
}

export const signArtifact = (
  artifactId: string,
  ttlSeconds: number,
  deps: ArtifactSignerDeps,
  now: Date = new Date(),
): SignedArtifactToken => {
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  const expiryUnix = Math.floor(expiresAt.getTime() / 1000);
  const signature = hmacSha256(`${artifactId}:${expiryUnix}`, deps.signingKey);
  return { expiresAt, signature };
};

export const buildSignedDownloadUrl = (
  baseUrl: string,
  artifactId: string,
  ttlSeconds: number,
  deps: ArtifactSignerDeps,
): { url: string; expiresAt: Date } => {
  const { expiresAt, signature } = signArtifact(artifactId, ttlSeconds, deps);
  const expiryUnix = Math.floor(expiresAt.getTime() / 1000);
  const u = new URL(`/api/artifacts/${artifactId}/download`, baseUrl);
  u.searchParams.set('e', String(expiryUnix));
  u.searchParams.set('s', signature);
  return { url: u.toString(), expiresAt };
};

export interface VerifyResult {
  valid: boolean;
  reason?: 'expired' | 'bad_signature' | 'malformed';
}

export const verifyArtifactSignature = (
  artifactId: string,
  expiryUnix: number | string | undefined,
  signature: string | undefined,
  deps: ArtifactSignerDeps,
  now: Date = new Date(),
): VerifyResult => {
  if (!expiryUnix || !signature) return { valid: false, reason: 'malformed' };
  const expiry = typeof expiryUnix === 'string' ? parseInt(expiryUnix, 10) : expiryUnix;
  if (!Number.isFinite(expiry) || expiry <= 0) return { valid: false, reason: 'malformed' };
  if (now.getTime() / 1000 > expiry) return { valid: false, reason: 'expired' };
  const expected = hmacSha256(`${artifactId}:${expiry}`, deps.signingKey);
  if (!safeEqualHex(expected, signature)) return { valid: false, reason: 'bad_signature' };
  return { valid: true };
};
