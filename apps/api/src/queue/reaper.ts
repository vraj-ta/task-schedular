import type { PrismaClient } from '../generated/prisma/client.js';
import { logger } from '../utils/logger.js';

/**
 * Reaper: sweep CLAIMED/RUNNING jobs whose `lockedUntil` has passed.
 *
 * Each stale job is flipped to RETRYING (or DEAD_LETTER if attempts are
 * exhausted). The worker that held the lock is left intact — the next
 * heartbeat from that worker will receive `ok: false`.
 *
 * Idempotent: safe to run on a timer; concurrent reapers are harmless
 * because the UPDATE is guarded by `lockedUntil <= now()`.
 */
export interface ReapResult {
  retried: number;
  deadLettered: number;
}

export const reapStaleLocks = async (prisma: PrismaClient): Promise<ReapResult> => {
  // Two-pass: dead-letter exhausted attempts first, then retry the rest.
  const deadLetterResult = await prisma.$executeRawUnsafe(
    `UPDATE "ScheduledJob"
     SET "status" = 'DEAD_LETTER',
         "failedAt" = now(),
         "lockedById" = NULL,
         "lockedUntil" = NULL,
         "error" = COALESCE("error", 'reaped: lock expired and attempts exhausted'),
         "updatedAt" = now()
     WHERE "status" IN ('CLAIMED', 'RUNNING')
       AND "lockedUntil" IS NOT NULL
       AND "lockedUntil" <= now()
       AND "attempts" >= "maxAttempts";`,
  );

  const retryResult = await prisma.$executeRawUnsafe(
    `UPDATE "ScheduledJob"
     SET "status" = 'RETRYING',
         "failedAt" = now(),
         "scheduledFor" = now() + interval '30 seconds',
         "lockedById" = NULL,
         "lockedUntil" = NULL,
         "error" = COALESCE("error", 'reaped: lock expired'),
         "updatedAt" = now()
     WHERE "status" IN ('CLAIMED', 'RUNNING')
       AND "lockedUntil" IS NOT NULL
       AND "lockedUntil" <= now()
       AND "attempts" < "maxAttempts";`,
  );

  const result: ReapResult = {
    retried: Number(retryResult ?? 0),
    deadLettered: Number(deadLetterResult ?? 0),
  };

  if (result.retried > 0 || result.deadLettered > 0) {
    logger.info('reaper swept stale locks', result);
  }
  return result;
};

/**
 * Start a recurring reaper loop. Returns a function that stops the loop.
 */
export const startReaperLoop = (
  prisma: PrismaClient,
  intervalMs: number,
): (() => void) => {
  let stopped = false;
  let pending: NodeJS.Timeout | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      await reapStaleLocks(prisma);
    } catch (err) {
      logger.error('reaper tick failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (!stopped) {
        pending = setTimeout(() => void tick(), intervalMs);
        pending.unref();
      }
    }
  };

  pending = setTimeout(() => void tick(), intervalMs);
  pending.unref();

  return () => {
    stopped = true;
    if (pending) {
      clearTimeout(pending);
      pending = null;
    }
  };
};
