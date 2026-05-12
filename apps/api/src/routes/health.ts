import { Router } from 'express';

import { getPrisma } from '../db.js';
import { logger } from '../utils/logger.js';

/**
 * Health routes.
 * - `GET /healthz` — liveness; always 200 if the process can run a handler.
 * - `GET /readyz` — readiness; 200 only if the control-plane DB responds.
 *
 * DI lets tests substitute a fake `checkDb`; production wiring uses Prisma.
 */

export interface HealthDeps {
  checkDb: () => Promise<void>;
}

export const createHealthRouter = (deps: HealthDeps): Router => {
  const router = Router();

  router.get('/healthz', (_req, res) => {
    res.json({ success: true, data: { status: 'ok' } });
  });

  router.get('/readyz', async (_req, res) => {
    try {
      await deps.checkDb();
      res.json({ success: true, data: { status: 'ready' } });
    } catch (err) {
      logger.warn('readyz failed', {
        reason: err instanceof Error ? err.message : 'unknown',
      });
      res.status(503).json({
        success: false,
        error: { code: 'DB_UNREACHABLE', message: 'Database connection failed' },
      });
    }
  });

  return router;
};

/** Production router wired to Prisma. */
export const healthRouter: Router = createHealthRouter({
  checkDb: async () => {
    await getPrisma().$queryRaw`SELECT 1`;
  },
});
