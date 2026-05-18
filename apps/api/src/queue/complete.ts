import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * Terminal/retry transitions for a job. Called by the worker after a runner finishes
 * (success, failure, or detected cancellation) or by the reaper when a lock expires.
 *
 * Retry policy: on `FAILED` with attempts < maxAttempts, the job is flipped to
 * `RETRYING` with an exponential backoff applied to `scheduledFor`. On the
 * final attempt, the job moves to `DEAD_LETTER`. Caller does not decide; this
 * module owns the policy.
 */
export interface CompleteDeps {
  prisma: PrismaClient;
  jobId: string;
  workerId: string;
}

export interface CompletePatch {
  status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  result?: unknown;
  error?: string;
  finalProgress?: number;
  finalProcessedUnits?: number;
  finalSuccessCount?: number;
  finalErrorCount?: number;
}

/** Exponential backoff: 30s, 60s, 120s, 240s, ... capped at 30 min. */
const backoffMs = (attempts: number): number => {
  const base = 30_000;
  const cap = 30 * 60_000;
  const exp = base * 2 ** Math.max(0, attempts - 1);
  return Math.min(cap, exp);
};

export interface CompleteResult {
  /** Final status the job ended in (may be RETRYING/DEAD_LETTER for failures). */
  finalStatus: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'RETRYING' | 'DEAD_LETTER';
  /** Set when the caller no longer holds the lock (worker mismatch, terminal state already). */
  ok: boolean;
}

export const completeJob = async (
  deps: CompleteDeps,
  patch: CompletePatch,
): Promise<CompleteResult> => {
  const job = await deps.prisma.scheduledJob.findUnique({
    where: { id: deps.jobId },
    select: { id: true, lockedById: true, status: true, attempts: true, maxAttempts: true },
  });

  if (!job) return { ok: false, finalStatus: patch.status };
  if (job.lockedById !== deps.workerId) return { ok: false, finalStatus: patch.status };
  if (
    job.status === 'SUCCEEDED' ||
    job.status === 'CANCELLED' ||
    job.status === 'DEAD_LETTER'
  ) {
    return { ok: false, finalStatus: job.status as CompleteResult['finalStatus'] };
  }

  const now = new Date();
  const baseUpdate = {
    ...(patch.finalProgress !== undefined && { progress: patch.finalProgress }),
    ...(patch.finalProcessedUnits !== undefined && { processedUnits: patch.finalProcessedUnits }),
    ...(patch.finalSuccessCount !== undefined && { successCount: patch.finalSuccessCount }),
    ...(patch.finalErrorCount !== undefined && { errorCount: patch.finalErrorCount }),
    lockedById: null,
    lockedUntil: null,
  };

  if (patch.status === 'SUCCEEDED') {
    await deps.prisma.scheduledJob.update({
      where: { id: deps.jobId },
      data: {
        ...baseUpdate,
        status: 'SUCCEEDED',
        ...(patch.result !== undefined && { result: patch.result as never }),
        error: null,
        completedAt: now,
        progress: patch.finalProgress ?? 100,
      },
      select: { id: true },
    });
    return { ok: true, finalStatus: 'SUCCEEDED' };
  }

  if (patch.status === 'CANCELLED') {
    await deps.prisma.scheduledJob.update({
      where: { id: deps.jobId },
      data: {
        ...baseUpdate,
        status: 'CANCELLED',
        ...(patch.result !== undefined && { result: patch.result as never }),
        error: patch.error ?? null,
        cancelledAt: now,
      },
      select: { id: true },
    });
    return { ok: true, finalStatus: 'CANCELLED' };
  }

  // FAILED: either retry or dead-letter.
  const willRetry = job.attempts < job.maxAttempts;
  if (willRetry) {
    const scheduledFor = new Date(now.getTime() + backoffMs(job.attempts));
    await deps.prisma.scheduledJob.update({
      where: { id: deps.jobId },
      data: {
        ...baseUpdate,
        status: 'RETRYING',
        error: patch.error ?? null,
        ...(patch.result !== undefined && { result: patch.result as never }),
        failedAt: now,
        scheduledFor,
      },
      select: { id: true },
    });
    return { ok: true, finalStatus: 'RETRYING' };
  }

  await deps.prisma.scheduledJob.update({
    where: { id: deps.jobId },
    data: {
      ...baseUpdate,
      status: 'DEAD_LETTER',
      error: patch.error ?? null,
      ...(patch.result !== undefined && { result: patch.result as never }),
      failedAt: now,
    },
    select: { id: true },
  });
  return { ok: true, finalStatus: 'DEAD_LETTER' };
};
