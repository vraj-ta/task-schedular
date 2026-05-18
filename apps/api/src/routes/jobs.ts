import { Router } from 'express';
import { z } from 'zod';

import { SCHEDULED_JOB_STATUSES, SCHEDULED_JOB_TYPES } from '@task-scheduler/shared-types';

import { getPrisma } from '../db.js';
import { BadRequestError, NotFoundError } from '../middleware/error-handler.js';
import { cancelJob } from '../queue/cancel.js';
import { enqueueJob } from '../queue/enqueue.js';
import { getJobById, listJobs } from '../queue/list.js';
import type { ScheduledJobView } from '../queue/types.js';

/**
 * Operator + service routes for ScheduledJob.
 *
 * - POST /            create a job (manual enqueue)
 * - GET  /            paginated list with status/type filters
 * - GET  /:id         job detail
 * - POST /:id/cancel  cancel (works on PENDING/SCHEDULED/CLAIMED/RUNNING/RETRYING)
 * - GET  /:id/artifacts  list artifacts for a job
 */

const scheduledJobTypeEnum = z.enum(SCHEDULED_JOB_TYPES);
const scheduledJobStatusEnum = z.enum(SCHEDULED_JOB_STATUSES);

const createBodySchema = z.object({
  projectConnectionId: z.string().uuid(),
  type: scheduledJobTypeEnum,
  entitySlug: z.string().min(1).max(100).optional(),
  payload: z.unknown().default({}),
  scheduledFor: z.string().datetime().optional(),
  priority: z.number().int().min(-100).max(100).default(0),
  maxAttempts: z.number().int().min(1).max(50).default(3),
  parentJobId: z.string().uuid().optional(),
});

const cancelBodySchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

const listQuerySchema = z.object({
  projectConnectionId: z.string().uuid().optional(),
  status: z
    .union([scheduledJobStatusEnum, z.array(scheduledJobStatusEnum)])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  type: z
    .union([scheduledJobTypeEnum, z.array(scheduledJobTypeEnum)])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().uuid().optional(),
});

const toJson = (j: ScheduledJobView): Record<string, unknown> => ({
  ...j,
  scheduledFor: j.scheduledFor.toISOString(),
  startedAt: j.startedAt?.toISOString() ?? null,
  completedAt: j.completedAt?.toISOString() ?? null,
  failedAt: j.failedAt?.toISOString() ?? null,
  cancelledAt: j.cancelledAt?.toISOString() ?? null,
  lockedUntil: j.lockedUntil?.toISOString() ?? null,
  createdAt: j.createdAt.toISOString(),
  updatedAt: j.updatedAt.toISOString(),
});

export const createJobsRouter = (): Router => {
  const router = Router();
  const prisma = getPrisma();

  router.post('/', async (req, res, next) => {
    try {
      const body = createBodySchema.parse(req.body);
      const triggeredBy = ((): string => {
        const adminUser = (req as { adminUser?: { id: string; email: string } }).adminUser;
        return adminUser?.email ?? adminUser?.id ?? 'service';
      })();
      try {
        const job = await enqueueJob(prisma, {
          projectConnectionId: body.projectConnectionId,
          type: body.type,
          entitySlug: body.entitySlug ?? null,
          payload: body.payload,
          priority: body.priority,
          maxAttempts: body.maxAttempts,
          scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : undefined,
          triggeredBy,
          triggerSource: 'MANUAL',
          parentJobId: body.parentJobId ?? null,
        });
        res.status(201).json({
          success: true,
          data: {
            id: job.id,
            status: job.status,
            scheduledFor: job.scheduledFor.toISOString(),
          },
        });
      } catch (err) {
        if (err !== null && typeof err === 'object' && 'code' in err && err.code === 'P2003') {
          return next(BadRequestError('projectConnectionId does not match any PlatformConnection'));
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  });

  router.get('/', async (req, res, next) => {
    try {
      const filter = listQuerySchema.parse(req.query);
      const result = await listJobs(prisma, filter);
      res.json({
        success: true,
        data: {
          items: result.items.map(toJson),
          nextCursor: result.nextCursor,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const job = await getJobById(prisma, req.params.id ?? '');
      if (!job) return next(NotFoundError('ScheduledJob'));
      res.json({ success: true, data: toJson(job) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/cancel', async (req, res, next) => {
    try {
      const body = cancelBodySchema.parse(req.body ?? {});
      const result = await cancelJob(prisma, req.params.id ?? '', body.reason ?? null);
      if (!result.ok) {
        return next(
          BadRequestError(
            'Job cannot be cancelled — already in a terminal state (SUCCEEDED, FAILED, CANCELLED, or DEAD_LETTER).',
          ),
        );
      }
      res.json({ success: true, data: { id: req.params.id, status: result.finalStatus } });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/artifacts', async (req, res, next) => {
    try {
      const rows = await prisma.jobArtifact.findMany({
        where: { jobId: req.params.id ?? '' },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          kind: true,
          filename: true,
          mimeType: true,
          sizeBytes: true,
          checksumSha256: true,
          storage: true,
          expiresAt: true,
          createdAt: true,
        },
      });
      res.json({
        success: true,
        data: rows.map((a) => ({
          ...a,
          sizeBytes: a.sizeBytes.toString(),
          expiresAt: a.expiresAt?.toISOString() ?? null,
          createdAt: a.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
