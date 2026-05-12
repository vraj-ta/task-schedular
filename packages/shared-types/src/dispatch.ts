// Wire contract between the control-plane and per-project workers.
// See c:\dev\task-schedular\docs\architecture.md sections "Operating contracts"
// and "Dispatch transport is worker-initiated long-poll".

import type { ScheduledJobStatus, ScheduledJobType, TriggerSource } from './enums.js';

// ============================================================
// Worker registration
// ============================================================

export interface RegisterWorkerRequest {
  /// Stable identifier of the project this worker serves (matches PlatformConnection.projectSlug).
  projectSlug: string;
  /// Stable identifier of the worker process. Same value across restarts of the same worker.
  workerId: string;
  /// Job types this worker is able to execute.
  capabilities: ScheduledJobType[];
}

export interface RegisterWorkerResponse {
  /// The control-plane's record id for this worker. Workers don't need to persist it
  /// (they re-register on startup) but it is returned for observability.
  workerRecordId: string;
  /// HMAC bearer token. Present in every subsequent worker request as `Authorization: Bearer …`.
  bearerToken: string;
  /// Control-plane wall clock at registration. Workers can use this to detect clock skew.
  controlPlaneTime: string;
}

// ============================================================
// Long-poll claim
// ============================================================

/// One assigned job, delivered as the 200 response body of GET /api/dispatch/claim.
/// Payload is typed as `unknown` here because the worker narrows it via `type` —
/// see JobPayloadMap in ./payloads.ts.
export interface JobDispatch {
  jobId: string;
  type: ScheduledJobType;
  /// Target entity slug for bulk/scheduled-action runners; null for system jobs.
  entitySlug: string | null;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  /// userId, 'cron', or 'system'.
  triggeredBy: string;
  triggerSource: TriggerSource;
  /// Not-before timestamp (ISO 8601). The worker may receive this in the past for already-due jobs.
  scheduledFor: string;
  /// The control-plane has reserved this job until lockedUntil (ISO 8601).
  /// Worker must complete or send a heartbeat before then or the reaper retries it.
  lockedUntil: string;
}

export interface ClaimSuccessResponse {
  job: JobDispatch;
}
// 204 No Content = no work available; worker reconnects.

// ============================================================
// Heartbeat (extends lockedUntil while a job runs)
// ============================================================

export interface HeartbeatRequest {
  /// 0..100. Optional; omit if no progress to report this tick.
  progress?: number;
  processedUnits?: number;
  successCount?: number;
  errorCount?: number;
  /// Optional one-line log entry the control-plane records for diagnostics.
  partialLog?: string;
}

export interface HeartbeatResponse {
  /// Refreshed lockedUntil (ISO 8601). Worker can compute next heartbeat deadline from this.
  lockedUntil: string;
  /// True iff the job has been cancelled out-of-band. Worker should stop at the next chunk boundary.
  cancelled: boolean;
}

// ============================================================
// Completion
// ============================================================

export interface CompleteRequest {
  status: Extract<ScheduledJobStatus, 'SUCCEEDED' | 'FAILED' | 'CANCELLED'>;
  /// Free-form result summary (totals, durations). Persisted to ScheduledJob.result.
  result?: unknown;
  /// Single-line error message when status === 'FAILED'.
  error?: string;
  finalProgress: number;
  finalProcessedUnits: number;
  finalSuccessCount: number;
  finalErrorCount: number;
}

// ============================================================
// Artifact upload (multipart; this is the JSON response only)
// ============================================================

export interface ArtifactUploadResponse {
  artifactId: string;
  signedDownloadUrl: string;
  expiresAt: string;
}

// ============================================================
// Enqueue (control-plane API used by admin/user backends, not workers)
// ============================================================

export interface EnqueueJobRequest {
  type: ScheduledJobType;
  entitySlug?: string;
  payload: unknown;
  /// ISO 8601. Default: now (job runs as soon as a worker claims it).
  scheduledFor?: string;
  priority?: number;
  maxAttempts?: number;
  parentJobId?: string;
}

export interface EnqueueJobResponse {
  id: string;
  status: ScheduledJobStatus;
  /// Best-effort position in the per-project FIFO. Diagnostic only — claim order is
  /// (priority desc, scheduledFor asc, createdAt asc) and may differ slightly.
  position: number;
}
