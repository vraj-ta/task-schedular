// String-literal mirrors of the Prisma enums in the control-plane schema.
// Workers cannot import the control-plane Prisma client, so they consume these.
// Keep in sync with apps/api/prisma/schema.prisma — values are the wire contract.

export type ScheduledJobType =
  | 'BULK_IMPORT'
  | 'BULK_UPDATE'
  | 'BULK_DELETE'
  | 'BULK_EXPORT'
  | 'SCHEDULED_ACTION'
  | 'SYSTEM_CLEANUP_TOKENS'
  | 'SYSTEM_CLEANUP_AUDIT'
  | 'SYSTEM_CLEANUP_UPLOADS'
  | 'SYSTEM_CLEANUP_JOBS'
  | 'WEBHOOK_DELIVERY'
  | 'EMAIL_BLAST'
  | 'REPORT_GENERATION'
  | 'EXTERNAL_SYNC';

export const SCHEDULED_JOB_TYPES = [
  'BULK_IMPORT',
  'BULK_UPDATE',
  'BULK_DELETE',
  'BULK_EXPORT',
  'SCHEDULED_ACTION',
  'SYSTEM_CLEANUP_TOKENS',
  'SYSTEM_CLEANUP_AUDIT',
  'SYSTEM_CLEANUP_UPLOADS',
  'SYSTEM_CLEANUP_JOBS',
  'WEBHOOK_DELIVERY',
  'EMAIL_BLAST',
  'REPORT_GENERATION',
  'EXTERNAL_SYNC',
] as const satisfies readonly ScheduledJobType[];

export type ScheduledJobStatus =
  | 'PENDING'
  | 'SCHEDULED'
  | 'CLAIMED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'RETRYING'
  | 'DEAD_LETTER';

export const SCHEDULED_JOB_STATUSES = [
  'PENDING',
  'SCHEDULED',
  'CLAIMED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'RETRYING',
  'DEAD_LETTER',
] as const satisfies readonly ScheduledJobStatus[];

export type TriggerSource = 'MANUAL' | 'SCHEDULED' | 'RECURRING' | 'WEBHOOK' | 'SYSTEM';

export const TRIGGER_SOURCES = [
  'MANUAL',
  'SCHEDULED',
  'RECURRING',
  'WEBHOOK',
  'SYSTEM',
] as const satisfies readonly TriggerSource[];

export type ArtifactKind = 'INPUT' | 'OUTPUT' | 'ERROR_REPORT';

export const ARTIFACT_KINDS = [
  'INPUT',
  'OUTPUT',
  'ERROR_REPORT',
] as const satisfies readonly ArtifactKind[];

export type ArtifactStorage = 'LOCAL' | 'S3';

export type PlatformTargetType = 'NODE' | 'DOTNET';

export type OverlapPolicy = 'SKIP' | 'QUEUE' | 'CANCEL_PREV';
