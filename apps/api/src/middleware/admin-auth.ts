import type { RequestHandler, Response } from 'express';

import { loadEnv } from '../config/env.js';
import { hashToken, safeEqualHex } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';

/**
 * Authentication for the operator-facing admin surface (`/api/platforms/*`).
 *
 * Callers present `Authorization: Bearer <SCHEDULER_ADMIN_API_KEY>`. We
 * compare the **sha256 of the provided key** to the sha256 of the expected
 * key in constant time; the key itself is never compared directly.
 */
export interface VerifyAdminKeyDeps {
  expectedKey: string;
}

const reject = (res: Response, code: string, message: string): Response =>
  res.status(401).json({ success: false, error: { code, message } });

export const createVerifyAdminKey = (deps: VerifyAdminKeyDeps): RequestHandler => {
  const expectedHash = hashToken(deps.expectedKey);

  return (req, res, next) => {
    try {
      const authHeader = req.header('authorization');
      const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i);
      const token = bearerMatch?.[1]?.trim();
      if (!token) {
        return reject(res, 'MISSING_BEARER_TOKEN', 'Authorization: Bearer <admin-key> is required');
      }

      if (!safeEqualHex(hashToken(token), expectedHash)) {
        logger.warn('admin key mismatch', { path: req.path });
        return reject(res, 'INVALID_ADMIN_KEY', 'Admin key not recognized');
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

/**
 * Production middleware. Lazy-creates the verifier on first invocation so
 * tests don't need SCHEDULER_ADMIN_API_KEY set just to import this module.
 */
export const verifyAdminKey: RequestHandler = (() => {
  let inner: RequestHandler | null = null;
  return (req, res, next) => {
    if (!inner) {
      inner = createVerifyAdminKey({ expectedKey: loadEnv().SCHEDULER_ADMIN_API_KEY });
    }
    inner(req, res, next);
  };
})();
