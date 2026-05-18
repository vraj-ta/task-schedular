import { Router } from 'express';
import { z } from 'zod';

import { SCHEDULED_JOB_TYPES } from '@task-scheduler/shared-types';

import { loadEnv } from '../config/env.js';
import { getPrisma } from '../db.js';
import type { WorkerAuthenticatedRequest } from '../middleware/worker-auth.js';
import { verifyWorkerToken } from '../middleware/worker-auth.js';
import { BadRequestError, NotFoundError } from '../middleware/error-handler.js';
import { claimNextJob } from '../queue/claim.js';
import { completeJob } from '../queue/complete.js';
import { heartbeat } from '../queue/heartbeat.js';
import { generateToken, hashToken } from '../utils/crypto.js';

/**
 * Dispatch surface — used by external per-project worker processes.
 *
 *   POST /register                  -> issue worker bearer token
 *   GET  /claim                     -> long-poll, return one assigned job or 204
 *   POST /heartbeat/:jobId          -> extend lock, peek for cancellation
 *   POST /complete/:jobId           -> finalize the job (success/fail/cancel)
 *
 * The in-process worker bypasses this surface entirely — it uses the queue
 * functions directly because it shares the Prisma client and process. Both
 * paths converge on the same SQL.
 */

const scheduledJobTypeEnum = z.enum(SCHEDULED_JOB_TYPES);

const registerBodySchema = z.object({
  projectSlug: z.string().min(1).max(100),
  workerId: z.string().min(1).max(120),
  capabilities: z.array(scheduledJobTypeEnum).default([]),
});

const heartbeatBodySchema = z.object({
  progress: z.number().int().min(0).max(100).optional(),
  processedUnits: z.number().int().min(0).optional(),
  successCount: z.number().int().min(0).optional(),
  errorCount: z.number().int().min(0).optional(),
  totalUnits: z.number().int().min(0).optional(),
});

const completeBodySchema = z.object({
  status: z.enum(['SUCCEEDED', 'FAILED', 'CANCELLED']),
  result: z.unknown().optional(),
  error: z.string().max(2000).optional(),
  finalProgress: z.number().int().min(0).max(100).optional(),
  finalProcessedUnits: z.number().int().min(0).optional(),
  finalSuccessCount: z.number().int().min(0).optional(),
  finalErrorCount: z.number().int().min(0).optional(),
});

export const createDispatchRouter = (): Router => {
  const router = Router();
  const prisma = getPrisma();
  const env = loadEnv();

  // Registration is the bootstrap step — uses no prior auth, but creates a
  // hashed bearer the worker presents on every subsequent request.
  router.post('/register', async (req, res, next) => {
    try {
      const body = registerBodySchema.parse(req.body);
      const connection = await prisma.platformConnection.findUnique({
        where: { projectSlug: body.projectSlug },
        select: { id: true, enabled: true },
      });
      if (!connection) return next(NotFoundError('PlatformConnection'));
      if (!connection.enabled) {
        return next(BadRequestError(`PlatformConnection '${body.projectSlug}' is disabled`));
      }

      const bearerToken = generateToken(32);
      const bearerTokenHash = hashToken(bearerToken);

      await prisma.worker.upsert({
        where: {
          projectConnectionId_workerId: {
            projectConnectionId: connection.id,
            workerId: body.workerId,
          },
        },
        update: {
          bearerTokenHash,
          capabilities: body.capabilities,
          lastSeenAt: new Date(),
          enabled: true,
        },
        create: {
          projectConnectionId: connection.id,
          workerId: body.workerId,
          bearerTokenHash,
          capabilities: body.capabilities,
          enabled: true,
        },
        select: { id: true },
      });

      const recordRow = await prisma.worker.findUnique({
        where: {
          projectConnectionId_workerId: {
            projectConnectionId: connection.id,
            workerId: body.workerId,
          },
        },
        select: { id: true },
      });

      res.json({
        success: true,
        data: {
          workerRecordId: recordRow?.id,
          bearerToken,
          controlPlaneTime: new Date().toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // Long-poll claim. Authenticated workers wait for up to LONG_POLL_TIMEOUT_MS
  // for a claimable job, polling every 1s.
  router.get('/claim', verifyWorkerToken, async (req, res, next) => {
    try {
      const authReq = req as WorkerAuthenticatedRequest;
      const deadline = Date.now() + env.LONG_POLL_TIMEOUT_MS;

      // Update lastSeenAt to keep the worker fresh.
      await prisma.worker.update({
        where: { id: authReq.worker.id },
        data: { lastSeenAt: new Date() },
        select: { id: true },
      }).catch(() => { /* worker may have been deleted out-of-band */ });

      while (Date.now() < deadline) {
        if (res.writableEnded || (req.socket && req.socket.destroyed)) return;
        const job = await claimNextJob({
          prisma,
          workerId: authReq.worker.id,
          projectConnectionId: authReq.platformConnection.id,
          lockTtlMs: env.WORKER_LOCK_TTL_MS,
          acceptedTypes: authReq.worker.capabilities,
        });
        if (job) {
          res.json({
            success: true,
            data: {
              job: {
                jobId: job.id,
                type: job.type,
                entitySlug: job.entitySlug,
                payload: job.payload,
                attempts: job.attempts,
                maxAttempts: job.maxAttempts,
                triggeredBy: job.triggeredBy,
                triggerSource: job.triggerSource,
                scheduledFor: job.scheduledFor.toISOString(),
                lockedUntil:
                  job.lockedUntil?.toISOString() ??
                  new Date(Date.now() + env.WORKER_LOCK_TTL_MS).toISOString(),
              },
            },
          });
          return;
        }
        await new Promise((r) => setTimeout(r, 1_000));
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.post('/heartbeat/:jobId', verifyWorkerToken, async (req, res, next) => {
    try {
      const authReq = req as WorkerAuthenticatedRequest;
      const patch = heartbeatBodySchema.parse(req.body ?? {});
      const jobId = String(req.params.jobId ?? '');
      const r = await heartbeat(
        { prisma, jobId, workerId: authReq.worker.id, lockTtlMs: env.WORKER_LOCK_TTL_MS },
        patch,
      );
      res.json({
        success: true,
        data: {
          ok: r.ok,
          cancelled: r.cancelled,
          lockedUntil: r.lockedUntil?.toISOString() ?? null,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/complete/:jobId', verifyWorkerToken, async (req, res, next) => {
    try {
      const authReq = req as WorkerAuthenticatedRequest;
      const body = completeBodySchema.parse(req.body);
      const jobId = String(req.params.jobId ?? '');
      const r = await completeJob(
        { prisma, jobId, workerId: authReq.worker.id },
        {
          status: body.status,
          result: body.result,
          error: body.error,
          finalProgress: body.finalProgress,
          finalProcessedUnits: body.finalProcessedUnits,
          finalSuccessCount: body.finalSuccessCount,
          finalErrorCount: body.finalErrorCount,
        },
      );
      res.json({ success: true, data: r });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
