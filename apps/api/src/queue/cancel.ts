import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * Operator-initiated cancellation. Behavior depends on current state:
 *
 *   PENDING | SCHEDULED | RETRYING -> moved straight to CANCELLED
 *   CLAIMED | RUNNING              -> marked CANCELLED; the worker's next
 *                                     heartbeat will receive cancelled: true
 *                                     so it stops at the next chunk boundary.
 *   SUCCEEDED | FAILED | CANCELLED | DEAD_LETTER -> no-op (returns false)
 */
export interface CancelResult {
  ok: boolean;
  finalStatus: 'CANCELLED' | null;
}

export const cancelJob = async (
  prisma: PrismaClient,
  jobId: string,
  reason: string | null = null,
): Promise<CancelResult> => {
  const now = new Date();
  const updated = await prisma.scheduledJob.updateMany({
    where: {
      id: jobId,
      status: { in: ['PENDING', 'SCHEDULED', 'CLAIMED', 'RUNNING', 'RETRYING'] },
    },
    data: {
      status: 'CANCELLED',
      cancelledAt: now,
      ...(reason !== null && { error: reason }),
    },
  });
  if (updated.count === 0) return { ok: false, finalStatus: null };
  return { ok: true, finalStatus: 'CANCELLED' };
};
