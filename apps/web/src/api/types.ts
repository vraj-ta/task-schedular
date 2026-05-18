/**
 * Wire shapes the operator console consumes. Mirrors the API's response
 * envelope `data` shapes — not directly imported from the API workspace
 * because the API depends on Prisma's generated client.
 */
import type {
  ArtifactKind,
  ArtifactStorage,
  ScheduledJobStatus,
  ScheduledJobType,
  TriggerSource,
} from '@task-scheduler/shared-types';

export interface PlatformConnection {
  id: string;
  projectSlug: string;
  name: string;
  baseUrl: string;
  targetType: 'NODE' | 'DOTNET';
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  config?: unknown;
}

export interface ScheduledJob {
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
  scheduledFor: string;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  cancelledAt: string | null;
  lockedById: string | null;
  lockedUntil: string | null;
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
  createdAt: string;
  updatedAt: string;
}

export interface JobsListResult {
  items: ScheduledJob[];
  nextCursor: string | null;
}

export interface RecurringSchedule {
  id: string;
  projectConnectionId: string;
  name: string;
  type: ScheduledJobType;
  payload: unknown;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
  overlapPolicy: 'SKIP' | 'QUEUE' | 'CANCEL_PREV';
  lastRunAt: string | null;
  lastJobId: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerRecord {
  id: string;
  projectConnectionId: string;
  projectSlug: string;
  workerId: string;
  capabilities: ScheduledJobType[];
  enabled: boolean;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: 'ADMIN' | 'VIEWER';
  enabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface JobArtifact {
  id: string;
  kind: ArtifactKind;
  filename: string;
  mimeType: string;
  sizeBytes: string;
  checksumSha256: string | null;
  storage: ArtifactStorage;
  expiresAt: string | null;
  createdAt: string;
}
