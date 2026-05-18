import { randomUUID } from 'node:crypto';

import type { ScheduledJobType } from '@task-scheduler/shared-types';

import type { PrismaClient } from '../generated/prisma/client.js';
import type { ArtifactStore } from '../lib/artifact-store.js';
import { getDriverForConnection } from '../platform-driver/factory.js';
import { claimNextJob } from '../queue/claim.js';
import { completeJob } from '../queue/complete.js';
import { heartbeat } from '../queue/heartbeat.js';
import { runnerRegistry } from '../runners/registry.js';
import type { RunnerContext } from '../runners/runner.interface.js';
import { hashToken } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';

/**
 * In-process worker. For Phase 1, the control-plane runs runners itself
 * (no separate per-project worker process). The same claim / heartbeat /
 * complete path is used as if an external worker had connected — the only
 * difference is the worker is the same Node process.
 *
 * On boot we register one synthetic `Worker` row per `PlatformConnection`
 * (with `workerId='in-process'`) so claims have something to attribute the
 * lock to. Externally-registered workers can coexist; the claim SQL doesn't
 * care which `Worker.id` holds a lock.
 */
export interface InProcessWorkerDeps {
  prisma: PrismaClient;
  artifacts: ArtifactStore;
  lockTtlMs: number;
  idleMs: number;
  concurrency: number;
}

/**
 * Ensure a synthetic Worker row exists for this PlatformConnection. The bearer
 * token is randomized at every boot because the in-process worker never
 * authenticates over the HTTP dispatch path — but we still write *some* hash
 * so the schema's NOT-NULL constraint is satisfied.
 */
const ensureInProcessWorkerRow = async (
  prisma: PrismaClient,
  projectConnectionId: string,
): Promise<string> => {
  const bearerTokenHash = hashToken(randomUUID());
  const supported: ScheduledJobType[] = runnerRegistry.supportedTypes();
  const row = await prisma.worker.upsert({
    where: {
      projectConnectionId_workerId: { projectConnectionId, workerId: 'in-process' },
    },
    update: {
      capabilities: supported,
      lastSeenAt: new Date(),
      enabled: true,
    },
    create: {
      projectConnectionId,
      workerId: 'in-process',
      bearerTokenHash,
      capabilities: supported,
      enabled: true,
    },
    select: { id: true },
  });
  return row.id;
};

const runOneJob = async (
  deps: InProcessWorkerDeps,
  projectConnectionId: string,
  workerRowId: string,
): Promise<boolean> => {
  const job = await claimNextJob({
    prisma: deps.prisma,
    workerId: workerRowId,
    projectConnectionId,
    lockTtlMs: deps.lockTtlMs,
    acceptedTypes: runnerRegistry.supportedTypes(),
  });
  if (!job) return false;

  const runner = runnerRegistry.get(job.type);
  if (!runner) {
    await completeJob(
      { prisma: deps.prisma, jobId: job.id, workerId: workerRowId },
      { status: 'FAILED', error: `no runner registered for job type ${job.type}` },
    );
    return true;
  }

  const driver = await getDriverForConnection(job.projectConnectionId).catch((err) => {
    logger.error('failed to resolve PlatformDriver', {
      jobId: job.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  });
  if (!driver) {
    await completeJob(
      { prisma: deps.prisma, jobId: job.id, workerId: workerRowId },
      { status: 'FAILED', error: 'PlatformDriver unavailable (connection missing or disabled)' },
    );
    return true;
  }

  const ctx: RunnerContext = {
    jobId: job.id,
    projectConnectionId: job.projectConnectionId,
    projectSlug: job.projectSlug,
    workerId: workerRowId,
    prisma: deps.prisma,
    driver,
    artifacts: deps.artifacts,
    async heartbeat(patch) {
      const r = await heartbeat(
        { prisma: deps.prisma, jobId: job.id, workerId: workerRowId, lockTtlMs: deps.lockTtlMs },
        patch,
      );
      return r.cancelled;
    },
  };

  try {
    const result = await runner.run(job.payload, ctx);
    await completeJob(
      { prisma: deps.prisma, jobId: job.id, workerId: workerRowId },
      result,
    );
  } catch (err) {
    logger.error('runner threw', {
      jobId: job.id,
      type: job.type,
      error: err instanceof Error ? err.message : String(err),
    });
    await completeJob(
      { prisma: deps.prisma, jobId: job.id, workerId: workerRowId },
      {
        status: 'FAILED',
        error: err instanceof Error ? err.message : 'runner threw an unknown error',
      },
    );
  }
  return true;
};

/**
 * Spawn `concurrency` concurrent worker loops. Each loop:
 *   1. Picks a random enabled PlatformConnection.
 *   2. Tries to claim a job for that connection.
 *   3. Runs the runner; on no work, sleeps `idleMs` and tries another connection.
 *
 * Returns a stop function for graceful shutdown.
 */
export const startInProcessWorker = (deps: InProcessWorkerDeps): (() => Promise<void>) => {
  let stopped = false;
  const inFlight: Promise<void>[] = [];

  const loop = async (loopId: number): Promise<void> => {
    logger.info('in-process worker loop started', { loopId });
    while (!stopped) {
      try {
        const connections = await deps.prisma.platformConnection.findMany({
          where: { enabled: true },
          select: { id: true },
        });
        if (connections.length === 0) {
          await new Promise((r) => setTimeout(r, deps.idleMs));
          continue;
        }

        // Randomize order so two loops don't fight over the same project.
        const shuffled = [...connections].sort(() => Math.random() - 0.5);
        let didWork = false;
        for (const c of shuffled) {
          if (stopped) break;
          const workerRowId = await ensureInProcessWorkerRow(deps.prisma, c.id);
          const ran = await runOneJob(deps, c.id, workerRowId);
          if (ran) {
            didWork = true;
            break;
          }
        }
        if (!didWork) {
          await new Promise((r) => setTimeout(r, deps.idleMs));
        }
      } catch (err) {
        logger.error('in-process worker loop errored', {
          loopId,
          error: err instanceof Error ? err.message : String(err),
        });
        await new Promise((r) => setTimeout(r, deps.idleMs));
      }
    }
    logger.info('in-process worker loop stopped', { loopId });
  };

  for (let i = 0; i < deps.concurrency; i += 1) {
    inFlight.push(loop(i));
  }

  return async () => {
    stopped = true;
    await Promise.all(inFlight);
  };
};
