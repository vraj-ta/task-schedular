import { z } from 'zod';

import type { Runner, RunnerContext, RunnerResult } from './runner.interface.js';

/**
 * SCHEDULED_ACTION — forward a project-defined action to the project's backend
 * via the PlatformDriver. The driver knows how to authenticate and call the
 * right endpoint (Node driver posts to `/api/internal/actions/run`).
 *
 * Payload: { actionSlug, params }
 */
const payloadSchema = z.object({
  actionSlug: z.string().min(1).max(200),
  params: z.record(z.string(), z.unknown()).default({}),
});

export const scheduledActionRunner: Runner = {
  type: 'SCHEDULED_ACTION',
  async run(payload, ctx: RunnerContext): Promise<RunnerResult> {
    const parsed = payloadSchema.safeParse(payload ?? {});
    if (!parsed.success) {
      return { status: 'FAILED', error: `invalid payload: ${parsed.error.message}` };
    }
    await ctx.heartbeat({ progress: 30 });

    const triggeredByRow = await ctx.prisma.scheduledJob.findUnique({
      where: { id: ctx.jobId },
      select: { triggeredBy: true },
    });

    const result = await ctx.driver.invokeAction({
      actionSlug: parsed.data.actionSlug,
      params: parsed.data.params,
      triggeredBy: triggeredByRow?.triggeredBy ?? 'system',
    });

    if (!result.success) {
      return {
        status: 'FAILED',
        error: result.error ?? 'invokeAction returned no error message',
        result: result.result,
      };
    }
    return {
      status: 'SUCCEEDED',
      result: result.result,
      finalProgress: 100,
      finalSuccessCount: 1,
      finalErrorCount: 0,
    };
  },
};
