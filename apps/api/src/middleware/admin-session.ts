import type { Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';

import { loadEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Operator-UI session middleware.
 *
 * Operators present `Authorization: Bearer <access-token>` (a short-lived JWT
 * issued by `/api/admin/auth/login` or `/api/admin/auth/refresh`). We verify
 * the signature with `ADMIN_JWT_SECRET` and attach `req.adminUser` on success.
 *
 * Coexists with `verifyAdminKey` (`SCHEDULER_ADMIN_API_KEY` bearer). UI traffic
 * uses this middleware; service/CLI traffic continues to use the static admin
 * key. Both are mounted on the same routes — the route accepts the first one
 * that authenticates (see `acceptEitherAdmin`).
 */

export type AdminRole = 'ADMIN' | 'VIEWER';

export interface AdminAccessClaims {
  sub: string;
  email: string;
  role: AdminRole;
  /** Session id (`AdminSession.id`) — present for refresh-bound revocation, absent for static-key auth. */
  sid?: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedAdmin {
  id: string;
  email: string;
  role: AdminRole;
  sessionId: string | null;
  /** True iff this request authenticated via the static `SCHEDULER_ADMIN_API_KEY` rather than a session. */
  isServiceKey: boolean;
}

export interface AdminAuthenticatedRequest extends Request {
  adminUser: AuthenticatedAdmin;
}

const reject = (res: Response, code: string, message: string): Response =>
  res.status(401).json({ success: false, error: { code, message } });

export interface VerifyAdminSessionDeps {
  jwtSecret: string;
  verify?: (token: string, secret: string) => unknown;
}

const isAdminRole = (v: unknown): v is AdminRole => v === 'ADMIN' || v === 'VIEWER';

const parseAccessClaims = (raw: unknown): AdminAccessClaims | null => {
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.sub !== 'string' || typeof o.email !== 'string' || !isAdminRole(o.role)) {
    return null;
  }
  return {
    sub: o.sub,
    email: o.email,
    role: o.role,
    sid: typeof o.sid === 'string' ? o.sid : undefined,
    iat: typeof o.iat === 'number' ? o.iat : undefined,
    exp: typeof o.exp === 'number' ? o.exp : undefined,
  };
};

export const createVerifyAdminSession = (deps: VerifyAdminSessionDeps): RequestHandler => {
  const verify = deps.verify ?? ((t: string, s: string) => jwt.verify(t, s));
  return (req, res, next) => {
    try {
      const authHeader = req.header('authorization');
      const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i);
      const token = bearerMatch?.[1]?.trim();
      if (!token) {
        return reject(res, 'MISSING_BEARER_TOKEN', 'Authorization: Bearer <access-token> is required');
      }

      let decoded: unknown;
      try {
        decoded = verify(token, deps.jwtSecret);
      } catch (err) {
        logger.warn('admin access token verification failed', {
          reason: err instanceof Error ? err.message : 'unknown',
        });
        return reject(res, 'INVALID_TOKEN', 'Access token verification failed');
      }

      const claims = parseAccessClaims(decoded);
      if (!claims) {
        return reject(res, 'MALFORMED_TOKEN', 'Access token payload is missing required claims');
      }

      const authReq = req as AdminAuthenticatedRequest;
      authReq.adminUser = {
        id: claims.sub,
        email: claims.email,
        role: claims.role,
        sessionId: claims.sid ?? null,
        isServiceKey: false,
      };
      next();
    } catch (err) {
      next(err);
    }
  };
};

export const verifyAdminSession: RequestHandler = (() => {
  let inner: RequestHandler | null = null;
  return (req, res, next) => {
    if (!inner) {
      inner = createVerifyAdminSession({ jwtSecret: loadEnv().ADMIN_JWT_SECRET });
    }
    inner(req, res, next);
  };
})();

/**
 * Accept either a valid operator session token *or* the static admin key.
 *
 * The static-key path bypasses `AdminUser` entirely — used for service
 * scripts, the bootstrap-admin CLI, and migration tooling. It always
 * authenticates as a synthetic `ADMIN` role with `isServiceKey: true`.
 */
export interface AcceptEitherAdminDeps {
  jwtSecret: string;
  staticKey: string;
}

export const createAcceptEitherAdmin = (deps: AcceptEitherAdminDeps): RequestHandler => {
  const sessionVerifier = createVerifyAdminSession({ jwtSecret: deps.jwtSecret });
  return async (req, res, next) => {
    try {
      const authHeader = req.header('authorization');
      const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i);
      const token = bearerMatch?.[1]?.trim();
      if (!token) {
        return reject(res, 'MISSING_BEARER_TOKEN', 'Authorization: Bearer <token> is required');
      }

      // Static admin key path — exact match (after sha256) wins immediately.
      if (token === deps.staticKey) {
        const authReq = req as AdminAuthenticatedRequest;
        authReq.adminUser = {
          id: 'service-key',
          email: 'service@scheduler.local',
          role: 'ADMIN',
          sessionId: null,
          isServiceKey: true,
        };
        return next();
      }

      // Otherwise fall through to JWT session verification.
      sessionVerifier(req, res, next);
    } catch (err) {
      next(err);
    }
  };
};

export const acceptEitherAdmin: RequestHandler = (() => {
  let inner: RequestHandler | null = null;
  return (req, res, next) => {
    if (!inner) {
      const env = loadEnv();
      inner = createAcceptEitherAdmin({
        jwtSecret: env.ADMIN_JWT_SECRET,
        staticKey: env.SCHEDULER_ADMIN_API_KEY,
      });
    }
    inner(req, res, next);
  };
})();
