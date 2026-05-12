// Runner-specific payload shapes carried in ScheduledJob.payload.
// Wire-level types only — runtime validation belongs in each component's
// schemas/ directory (the control-plane validates on enqueue, the worker
// validates on claim).

export interface BulkImportPayload {
  /// Id of the INPUT JobArtifact (the uploaded CSV/XLSX).
  inputArtifactId: string;
  /// csvColumn -> entityField, applied row-by-row before validation.
  mapping: Record<string, string>;
  /// If set, rows are upserted on this entity field instead of inserted.
  upsertKey?: string;
  /// Dry-run = validate every row and write an ERROR_REPORT artifact, but don't touch the DB.
  dryRun: boolean;
  /// `skip` writes failing rows to the error report and continues; `abort` rolls back the chunk and fails the job.
  onRowError: 'skip' | 'abort';
  /// Rows per DB transaction. Defaults come from taskScheduler.bulkImport.chunkSize.
  chunkSize: number;
  /// Hard cap — fail before any insert if the file exceeds this.
  maxRowsPerJob: number;
}

export interface BulkUpdatePayload {
  /// Prisma-style where clause for the target entity.
  filter: Record<string, unknown>;
  /// Prisma-style data patch applied to each matching row.
  patch: Record<string, unknown>;
}

export interface BulkDeletePayload {
  filter: Record<string, unknown>;
  /// false = soft-delete (set deletedAt); true = DELETE FROM (only allowed when entity opts in).
  hard: boolean;
}

export interface BulkExportPayload {
  filter?: Record<string, unknown>;
  /// Column subset to export; omit to export all entity fields.
  columns?: string[];
  format: 'csv' | 'xlsx' | 'pdf';
}

export interface ScheduledActionPayload {
  /// Slug of the ActionDefinition in the project's extendedAppConfiguration.
  actionSlug: string;
  /// Per-action params; shape is defined by the action's own Zod schema.
  params: Record<string, unknown>;
}

export interface SystemCleanupTokensPayload {
  /// Tokens whose expiresAt is older than now() are deleted regardless of this value;
  /// retentionDays is a safety override for already-revoked tokens.
  retentionDays?: number;
}

export interface SystemCleanupAuditPayload {
  retentionDays: number;
}

export interface SystemCleanupUploadsPayload {
  olderThanMinutes: number;
}

export interface SystemCleanupJobsPayload {
  retentionDays: number;
}

/// Compile-time mapping from job type to its payload shape.
/// Use to narrow a JobDispatch in a runner: `dispatch.payload as JobPayloadMap['BULK_IMPORT']`.
export interface JobPayloadMap {
  BULK_IMPORT: BulkImportPayload;
  BULK_UPDATE: BulkUpdatePayload;
  BULK_DELETE: BulkDeletePayload;
  BULK_EXPORT: BulkExportPayload;
  SCHEDULED_ACTION: ScheduledActionPayload;
  SYSTEM_CLEANUP_TOKENS: SystemCleanupTokensPayload;
  SYSTEM_CLEANUP_AUDIT: SystemCleanupAuditPayload;
  SYSTEM_CLEANUP_UPLOADS: SystemCleanupUploadsPayload;
  SYSTEM_CLEANUP_JOBS: SystemCleanupJobsPayload;
}
