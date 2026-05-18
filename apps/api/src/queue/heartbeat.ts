import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * Worker heartbeat — extend `lockedUntil` and post progress.
 * Caller must hold the claim (`lockedById === workerId`) and the job must still be RUNNING/CLAIMED.
 *
 * Returns `cancelled: true` if the job has been cancelled out-of-band so the
 * worker can stop at the next chunk boundary.
 */
export interface HeartbeatDeps {
  prisma: PrismaClient;
  jobId: string;
  workerId: string;
  lockTtlMs: number;
}

export interface HeartbeatPatch {
  progress?: number;
  processedUnits?: number;
  successCount?: number;
  errorCount?: number;
  totalUnits?: number;
}

export interface HeartbeatResult {
  ok: boolean;
  cancelled: boolean;
  lockedUntil: Date | null;
}

export const heartbeat = async (
  deps: HeartbeatDeps,
  patch: HeartbeatPatch,
): Promise<HeartbeatResult> => {
  const newLockedUntil = new Date(Date.now() + deps.lockTtlMs);

  const updated = await deps.prisma.scheduledJob.updateMany({
    where: {
      id: deps.jobId,
      lockedById: deps.workerId,
      status: { in: ['CLAIMED', 'RUNNING'] },
    },
    data: {
      status: 'RUNNING',
      lockedUntil: newLockedUntil,
      ...(patch.progress !== undefined && { progress: patch.progress }),
      ...(patch.processedUnits !== undefined && { processedUnits: patch.processedUnits }),
      ...(patch.successCount !== undefined && { successCount: patch.successCount }),
      ...(patch.errorCount !== undefined && { errorCount: patch.errorCount }),
      ...(patch.totalUnits !== undefined && { totalUnits: patch.totalUnits }),
    },
  });

  if (updated.count === 0) {
    // Lock was lost, or job moved to a terminal/cancelled state. Peek to find out.
    const row = await deps.prisma.scheduledJob.findUnique({
      where: { id: deps.jobId },
      select: { status: true },
    });
    const cancelled = row?.status === 'CANCELLED';
    return { ok: false, cancelled, lockedUntil: null };
  }

  return { ok: true, cancelled: false, lockedUntil: newLockedUntil };
};
