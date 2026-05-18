import type { ScheduledJobType } from '@task-scheduler/shared-types';

import type { PrismaClient } from '../generated/prisma/client.js';
import { enqueueJob } from '../queue/enqueue.js';
import { logger } from '../utils/logger.js';

import { nextRunAfter } from './cron.js';

/**
 * One scheduler tick. For every RecurringSchedule whose `nextRunAt <= now()`:
 *   1. Apply the OverlapPolicy against jobs spawned by this schedule.
 *   2. Enqueue a new ScheduledJob with the schedule's `type` + `payload`.
 *   3. Recompute `nextRunAt` from the cron expression and persist.
 *
 * Concurrency: an advisory lock on the schedule row keeps two ticks from
 * double-firing the same schedule. We implement that by doing the read +
 * update inside a single transaction with `FOR UPDATE` on the schedule row.
 */
export interface TickResult {
  considered: number;
  enqueued: number;
  skipped: number;
}

interface DueRow {
  id: string;
  projectConnectionId: string;
  name: string;
  type: string;
  payload: unknown;
  cronExpression: string;
  timezone: string;
  overlapPolicy: string;
  nextRunAt: Date | null;
  lastJobId: string | null;
}

export const tickOnce = async (prisma: PrismaClient): Promise<TickResult> => {
  const now = new Date();
  const result: TickResult = { considered: 0, enqueued: 0, skipped: 0 };

  // Pull due schedules. We don't use FOR UPDATE on the full select because
  // we want to process them one by one; instead we re-lock each row in a
  // short transaction below.
  const due = await prisma.$queryRaw<DueRow[]>`
    SELECT id, "projectConnectionId", name, "type"::text AS type, payload,
           "cronExpression", timezone, "overlapPolicy"::text AS "overlapPolicy",
           "nextRunAt", "lastJobId"
    FROM "RecurringSchedule"
    WHERE enabled = true
      AND "nextRunAt" IS NOT NULL
      AND "nextRunAt" <= ${now}
  `;

  for (const row of due) {
    result.considered += 1;
    try {
      await prisma.$transaction(async (tx) => {
        // Re-fetch with FOR UPDATE to serialize against another tick.
        const lockedRows = await tx.$queryRaw<DueRow[]>`
          SELECT id, "projectConnectionId", name, "type"::text AS type, payload,
                 "cronExpression", timezone, "overlapPolicy"::text AS "overlapPolicy",
                 "nextRunAt", "lastJobId"
          FROM "RecurringSchedule"
          WHERE id = ${row.id}
            AND enabled = true
            AND "nextRunAt" IS NOT NULL
            AND "nextRunAt" <= ${now}
          FOR UPDATE
        `;
        const locked = lockedRows[0];
        if (!locked) {
          result.skipped += 1;
          return;
        }

        // Overlap policy check.
        if (locked.overlapPolicy === 'SKIP' && locked.lastJobId) {
          const prev = await tx.scheduledJob.findUnique({
            where: { id: locked.lastJobId },
            select: { status: true },
          });
          const stillActive =
            prev?.status === 'PENDING' ||
            prev?.status === 'SCHEDULED' ||
            prev?.status === 'CLAIMED' ||
            prev?.status === 'RUNNING' ||
            prev?.status === 'RETRYING';
          if (stillActive) {
            const nextRunAt = nextRunAfter(locked.cronExpression, locked.timezone, now);
            await tx.recurringSchedule.update({
              where: { id: locked.id },
              data: { nextRunAt },
              select: { id: true },
            });
            result.skipped += 1;
            return;
          }
        }
        if (locked.overlapPolicy === 'CANCEL_PREV' && locked.lastJobId) {
          await tx.scheduledJob.updateMany({
            where: {
              id: locked.lastJobId,
              status: { in: ['PENDING', 'SCHEDULED', 'CLAIMED', 'RUNNING', 'RETRYING'] },
            },
            data: { status: 'CANCELLED', cancelledAt: new Date() },
          });
        }

        const job = await enqueueJob(tx as unknown as PrismaClient, {
          projectConnectionId: locked.projectConnectionId,
          type: locked.type as ScheduledJobType,
          payload: locked.payload,
          triggeredBy: 'cron',
          triggerSource: 'RECURRING',
        });

        const nextRunAt = nextRunAfter(locked.cronExpression, locked.timezone, now);
        await tx.recurringSchedule.update({
          where: { id: locked.id },
          data: {
            lastRunAt: now,
            lastJobId: job.id,
            nextRunAt,
          },
          select: { id: true },
        });
        result.enqueued += 1;
      });
    } catch (err) {
      logger.error('scheduler tick failed for schedule', {
        scheduleId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
};

export const startSchedulerLoop = (
  prisma: PrismaClient,
  intervalMs: number,
): (() => void) => {
  let stopped = false;
  let pending: NodeJS.Timeout | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const r = await tickOnce(prisma);
      if (r.enqueued > 0 || r.skipped > 0) {
        logger.info('scheduler tick', r);
      }
    } catch (err) {
      logger.error('scheduler tick errored', {
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
