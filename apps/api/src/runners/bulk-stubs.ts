import type { ScheduledJobType } from '@task-scheduler/shared-types';

import type { Runner, RunnerContext, RunnerResult } from './runner.interface.js';

/**
 * Phase-1 stubs for bulk runners.
 *
 * BULK_IMPORT/UPDATE/DELETE/EXPORT need entity-schema-aware code that lives in
 * the per-project worker (Phase 2). Until that lands, the in-process worker
 * fails these jobs cleanly with a descriptive error so operators see the gap
 * instead of an opaque crash.
 *
 * The runner still emits a one-line ERROR_REPORT-style result so the UI can
 * surface why it failed.
 */
const buildStub = (type: ScheduledJobType, hint: string): Runner => ({
  type,
  async run(_payload, ctx: RunnerContext): Promise<RunnerResult> {
    await ctx.heartbeat({ progress: 5 });
    return {
      status: 'FAILED',
      error: `${type} runner is not implemented in the in-process worker yet — ${hint}`,
      finalProgress: 5,
      finalSuccessCount: 0,
      finalErrorCount: 1,
    };
  },
});

export const bulkImportStub: Runner = buildStub(
  'BULK_IMPORT',
  'requires per-project worker (knows the entity Prisma client) — see Phase 2 in docs/architecture.md',
);
export const bulkUpdateStub: Runner = buildStub(
  'BULK_UPDATE',
  'requires per-project worker for entity-aware filter/patch — Phase 2',
);
export const bulkDeleteStub: Runner = buildStub(
  'BULK_DELETE',
  'requires per-project worker for entity-aware deletion — Phase 2',
);
export const bulkExportStub: Runner = buildStub(
  'BULK_EXPORT',
  'requires per-project worker for entity-aware streaming — Phase 2',
);
