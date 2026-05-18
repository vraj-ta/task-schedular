import { Router } from 'express';

import { getPrisma } from '../db.js';
import { NotFoundError } from '../middleware/error-handler.js';

/**
 * Read-only operator view of registered workers.
 *
 * The in-process worker shows up as one Worker row per PlatformConnection
 * with `workerId = 'in-process'`. External workers (Phase 2) will appear
 * here too once they register through `/api/dispatch/register`.
 */
export const createWorkersRouter = (): Router => {
  const router = Router();
  const prisma = getPrisma();

  router.get('/', async (req, res, next) => {
    try {
      const projectConnectionId =
        typeof req.query.projectConnectionId === 'string'
          ? req.query.projectConnectionId
          : undefined;
      const list = await prisma.worker.findMany({
        where: projectConnectionId ? { projectConnectionId } : undefined,
        orderBy: { lastSeenAt: 'desc' },
        select: {
          id: true,
          projectConnectionId: true,
          workerId: true,
          capabilities: true,
          enabled: true,
          lastSeenAt: true,
          createdAt: true,
          updatedAt: true,
          projectConnection: { select: { projectSlug: true } },
        },
      });
      res.json({
        success: true,
        data: list.map((w) => ({
          id: w.id,
          projectConnectionId: w.projectConnectionId,
          projectSlug: w.projectConnection.projectSlug,
          workerId: w.workerId,
          capabilities: w.capabilities,
          enabled: w.enabled,
          lastSeenAt: w.lastSeenAt.toISOString(),
          createdAt: w.createdAt.toISOString(),
          updatedAt: w.updatedAt.toISOString(),
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      await prisma.worker.delete({ where: { id: req.params.id ?? '' } });
      res.status(204).end();
    } catch (err) {
      if (err !== null && typeof err === 'object' && 'code' in err && err.code === 'P2025') {
        return next(NotFoundError('Worker'));
      }
      next(err);
    }
  });

  return router;
};
