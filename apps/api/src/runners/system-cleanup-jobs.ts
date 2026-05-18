import { z } from 'zod';

import type { Runner, RunnerContext, RunnerResult } from './runner.interface.js';

/**
 * SYSTEM_CLEANUP_JOBS — purge old, terminal ScheduledJob rows from the
 * control-plane DB. Operates on the **control-plane** DB (not the project DB),
 * so this runner is fully functional in the in-process worker without any
 * platform-repo additions.
 *
 * Payload:
 *   { retentionDays: number }  // delete SUCCEEDED/FAILED/CANCELLED/DEAD_LETTER jobs older than this
 */
const payloadSchema = z.object({
  retentionDays: z.number().int().min(1).max(3650).default(30),
});

export const systemCleanupJobsRunner: Runner = {
  type: 'SYSTEM_CLEANUP_JOBS',
  async run(payload, ctx: RunnerContext): Promise<RunnerResult> {
    const parsed = payloadSchema.safeParse(payload ?? {});
    if (!parsed.success) {
      return { status: 'FAILED', error: `invalid payload: ${parsed.error.message}` };
    }
    const cutoff = new Date(Date.now() - parsed.data.retentionDays * 24 * 60 * 60 * 1000);

    await ctx.heartbeat({ progress: 10, totalUnits: 1 });

    // Only delete jobs in this same project's scope.
    const deleted = await ctx.prisma.scheduledJob.deleteMany({
      where: {
        projectConnectionId: ctx.projectConnectionId,
        status: { in: ['SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD_LETTER'] },
        completedAt: { lt: cutoff },
      },
    });

    await ctx.heartbeat({ progress: 90, processedUnits: deleted.count });

    return {
      status: 'SUCCEEDED',
      result: {
        deletedCount: deleted.count,
        cutoff: cutoff.toISOString(),
      },
      finalProgress: 100,
      finalProcessedUnits: deleted.count,
      finalSuccessCount: deleted.count,
      finalErrorCount: 0,
    };
  },
};
