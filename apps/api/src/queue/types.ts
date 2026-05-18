import type { ScheduledJobStatus, ScheduledJobType, TriggerSource } from '@task-scheduler/shared-types';

/**
 * Operator-facing view of a job (response shape).
 * `payload` is widened to `unknown` so each runner narrows it via JobPayloadMap.
 */
export interface ScheduledJobView {
  id: string;
  projectConnectionId: string;
  projectSlug: string;
  type: ScheduledJobType;
  entitySlug: string | null;
  payload: unknown;
  status: ScheduledJobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  scheduledFor: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  cancelledAt: Date | null;
  lockedById: string | null;
  lockedUntil: Date | null;
  progress: number;
  totalUnits: number | null;
  processedUnits: number;
  successCount: number;
  errorCount: number;
  result: unknown;
  error: string | null;
  triggeredBy: string;
  triggerSource: TriggerSource;
  parentJobId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
