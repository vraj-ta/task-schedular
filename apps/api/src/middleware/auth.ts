import type { Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { getPrisma } from '../db.js';
import { decrypt, loadEncryptionKey } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';

/**
 * Shape of the JWT payload the generated admin/user backend issues
 * (see ReactAIClientConfiguration/app/backend/src/generators/backend/controllers.ts).
 * `role` is required so route-level authorization can branch on it. `audience`
 * tells us whether the caller came in through the admin- or user-backend.
 */
const userJwtClaimsSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email().optional(),
  role: z.string().min(1),
  audience: z.string().optional(),
});

export type UserJwtClaims = z.infer<typeof userJwtClaimsSchema>;

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  role: string;
  audience: string | null;
}

export interface AuthenticatedConnection {
  id: string;
  projectSlug: string;
  targetType: 'NODE' | 'DOTNET';
}

/** Express request augmented after `verifyUserJwt` has run successfully. */
export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
  platformConnection: AuthenticatedConnection;
}

interface ConnectionAuthData {
  id: string;
  projectSlug: string;
  targetType: 'NODE' | 'DOTNET';
  enabled: boolean;
  jwtSecretCiphertext: Uint8Array | Buffer;
}

/**
 * Dependencies injected into `createVerifyUserJwt` so tests can substitute
 * fake connection lookups and verifiers without mocking the Prisma client
 * or the jsonwebtoken module.
 */
export interface VerifyUserJwtDeps {
  findConnection: (slug: string) => Promise<ConnectionAuthData | null>;
  loadKey: () => Buffer;
  verifyJwt: (token: string, secret: string) => unknown;
}

const reject = (res: Response, code: string, message: string): Response =>
  res.status(401).json({ success: false, error: { code, message } });

const toBuffer = (bytes: Uint8Array | Buffer): Buffer =>
  Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

/**
 * Verify a forwarded user JWT against the per-project signing secret stored
 * (encrypted) in `PlatformConnection.jwtSecretCiphertext`. On success,
 * `req.user` and `req.platformConnection` are populated and `next()` is called.
 *
 * Required headers:
 *   - `X-Project-Id: <projectSlug>`
 *   - `Authorization: Bearer <jwt>`
 */
export const createVerifyUserJwt = (deps: VerifyUserJwtDeps): RequestHandler =>
  async (req, res, next) => {
    try {
      const projectSlug = req.header('x-project-id');
      if (!projectSlug) {
        return reject(res, 'MISSING_PROJECT_ID', 'X-Project-Id header is required');
      }

      const authHeader = req.header('authorization');
      const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i);
      const token = bearerMatch?.[1]?.trim();
      if (!token) {
        return reject(res, 'MISSING_BEARER_TOKEN', 'Authorization: Bearer <token> is required');
      }

      const connection = await deps.findConnection(projectSlug);
      if (!connection) {
        return reject(
          res,
          'UNKNOWN_PROJECT',
          `No PlatformConnection registered for project '${projectSlug}'`,
        );
      }
      if (!connection.enabled) {
        return reject(res, 'PROJECT_DISABLED', 'PlatformConnection is disabled');
      }

      const jwtSecret = decrypt(toBuffer(connection.jwtSecretCiphertext), deps.loadKey());

      let decoded: unknown;
      try {
        decoded = deps.verifyJwt(token, jwtSecret);
      } catch (err) {
        logger.warn('JWT verification failed', {
          projectSlug,
          reason: err instanceof Error ? err.message : 'unknown',
        });
        return reject(res, 'INVALID_TOKEN', 'JWT verification failed');
      }

      const claims = userJwtClaimsSchema.safeParse(decoded);
      if (!claims.success) {
        return reject(res, 'MALFORMED_TOKEN', 'JWT payload is missing required claims');
      }

      const authReq = req as AuthenticatedRequest;
      authReq.user = {
        id: claims.data.userId,
        email: claims.data.email ?? null,
        role: claims.data.role,
        audience: claims.data.audience ?? null,
      };
      authReq.platformConnection = {
        id: connection.id,
        projectSlug: connection.projectSlug,
        targetType: connection.targetType,
      };
      next();
    } catch (err) {
      next(err);
    }
  };

/** Production middleware wired to the Prisma client and process env. */
export const verifyUserJwt: RequestHandler = createVerifyUserJwt({
  findConnection: async (slug) => {
    const prisma = getPrisma();
    return prisma.platformConnection.findUnique({
      where: { projectSlug: slug },
      select: {
        id: true,
        projectSlug: true,
        targetType: true,
        enabled: true,
        jwtSecretCiphertext: true,
      },
    });
  },
  loadKey: () => loadEncryptionKey(),
  verifyJwt: (token, secret) => jwt.verify(token, secret),
});
