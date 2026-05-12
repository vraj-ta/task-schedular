import type { Request, RequestHandler, Response } from 'express';

import { getPrisma } from '../db.js';
import { hashToken } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';

/**
 * Authenticates per-project worker dispatch endpoints (`/api/dispatch/*`).
 *
 * Workers present `Authorization: Bearer <hmac-token>`. We compute sha256(token)
 * and look up the matching `Worker` row. The bearer token itself is never
 * persisted — only its hash is in `Worker.bearerTokenHash`.
 *
 * Successful auth attaches `req.worker` and `req.platformConnection` to the
 * request and calls `next()`.
 */

export interface AuthenticatedWorker {
  id: string;
  workerId: string;
  capabilities: string[];
}

export interface AuthenticatedWorkerConnection {
  id: string;
  projectSlug: string;
  targetType: 'NODE' | 'DOTNET';
}

export interface WorkerAuthenticatedRequest extends Request {
  worker: AuthenticatedWorker;
  platformConnection: AuthenticatedWorkerConnection;
}

interface WorkerAuthData {
  id: string;
  workerId: string;
  capabilities: string[];
  enabled: boolean;
  projectConnection: {
    id: string;
    projectSlug: string;
    targetType: 'NODE' | 'DOTNET';
    enabled: boolean;
  };
}

export interface VerifyWorkerTokenDeps {
  findWorkerByTokenHash: (hash: string) => Promise<WorkerAuthData | null>;
}

const reject = (res: Response, code: string, message: string): Response =>
  res.status(401).json({ success: false, error: { code, message } });

export const createVerifyWorkerToken = (deps: VerifyWorkerTokenDeps): RequestHandler =>
  async (req, res, next) => {
    try {
      const authHeader = req.header('authorization');
      const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i);
      const token = bearerMatch?.[1]?.trim();
      if (!token) {
        return reject(res, 'MISSING_BEARER_TOKEN', 'Authorization: Bearer <token> is required');
      }

      const worker = await deps.findWorkerByTokenHash(hashToken(token));
      if (!worker) {
        logger.warn('worker token not recognized', { tokenHashPrefix: hashToken(token).slice(0, 8) });
        return reject(res, 'INVALID_WORKER_TOKEN', 'Worker token not recognized');
      }
      if (!worker.enabled) {
        return reject(res, 'WORKER_DISABLED', 'Worker is disabled');
      }
      if (!worker.projectConnection.enabled) {
        return reject(res, 'PROJECT_DISABLED', 'PlatformConnection is disabled');
      }

      const authReq = req as WorkerAuthenticatedRequest;
      authReq.worker = {
        id: worker.id,
        workerId: worker.workerId,
        capabilities: worker.capabilities,
      };
      authReq.platformConnection = {
        id: worker.projectConnection.id,
        projectSlug: worker.projectConnection.projectSlug,
        targetType: worker.projectConnection.targetType,
      };
      next();
    } catch (err) {
      next(err);
    }
  };

/** Production middleware bound to the Prisma client. */
export const verifyWorkerToken: RequestHandler = createVerifyWorkerToken({
  findWorkerByTokenHash: async (hash) => {
    const prisma = getPrisma();
    return prisma.worker.findFirst({
      where: { bearerTokenHash: hash },
      select: {
        id: true,
        workerId: true,
        capabilities: true,
        enabled: true,
        projectConnection: {
          select: {
            id: true,
            projectSlug: true,
            targetType: true,
            enabled: true,
          },
        },
      },
    });
  },
});
