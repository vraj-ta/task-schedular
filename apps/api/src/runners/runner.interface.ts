import type { ScheduledJobType } from '@task-scheduler/shared-types';

import type { PrismaClient } from '../generated/prisma/client.js';
import type { ArtifactStore } from '../lib/artifact-store.js';
import type { PlatformDriver } from '../platform-driver/driver.interface.js';

/**
 * Contract every runner implements. The worker loop picks a runner from
 * `runnerRegistry` based on `job.type`, then calls `run()` with the
 * runtime context. The runner can:
 *   - return success with a `result` payload
 *   - return failure with an `error` and an optional error-report artifact
 *   - call `ctx.heartbeat()` periodically to report progress and detect cancellation
 *
 * Runners are single-shot: a single call processes the entire job. Long jobs
 * should heartbeat at chunk boundaries (every ~5s) so the reaper doesn't take
 * the lock.
 */
export interface RunnerContext {
  jobId: string;
  projectConnectionId: string;
  projectSlug: string;
  /** Worker id holding the claim. */
  workerId: string;
  prisma: PrismaClient;
  driver: PlatformDriver;
  artifacts: ArtifactStore;
  /**
   * Extend the lock, optionally report progress, and check if the job has been
   * cancelled. Returns true if the runner should stop at the next safe point.
   */
  heartbeat(patch: {
    progress?: number;
    processedUnits?: number;
    successCount?: number;
    errorCount?: number;
    totalUnits?: number;
  }): Promise<boolean>;
}

export interface RunnerSuccess {
  status: 'SUCCEEDED';
  result?: unknown;
  finalProgress?: number;
  finalProcessedUnits?: number;
  finalSuccessCount?: number;
  finalErrorCount?: number;
}

export interface RunnerFailure {
  status: 'FAILED';
  error: string;
  result?: unknown;
  finalProgress?: number;
  finalProcessedUnits?: number;
  finalSuccessCount?: number;
  finalErrorCount?: number;
}

export interface RunnerCancelled {
  status: 'CANCELLED';
  result?: unknown;
  finalProgress?: number;
  finalProcessedUnits?: number;
}

export type RunnerResult = RunnerSuccess | RunnerFailure | RunnerCancelled;

export interface Runner {
  type: ScheduledJobType;
  run(payload: unknown, ctx: RunnerContext): Promise<RunnerResult>;
}
