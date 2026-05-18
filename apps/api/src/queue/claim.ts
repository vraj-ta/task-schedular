import type { PrismaClient } from '../generated/prisma/client.js';

import type { ScheduledJobView } from './types.js';

/**
 * Atomically claim the next due job for a worker.
 *
 * Implements the canonical claim from `docs/architecture.md`:
 *   - filter: project scope, status in (PENDING, RETRYING, SCHEDULED), due now
 *   - order: priority desc, scheduledFor asc, createdAt asc
 *   - lock: FOR UPDATE SKIP LOCKED LIMIT 1
 *   - update: status=CLAIMED, lockedBy=workerId, lockedUntil=now()+ttl, attempts++
 *
 * Returns the locked job (with all fields) or null if no work was available.
 */
export interface ClaimDeps {
  prisma: PrismaClient;
  /** Worker.id holding the lock. Caller must have authenticated the worker first. */
  workerId: string;
  projectConnectionId: string;
  /**
   * Lock TTL in milliseconds. The control-plane reaper will sweep this job back
   * to RETRYING if `lockedUntil` passes without a completion or heartbeat.
   */
  lockTtlMs: number;
  /** Capability filter: only claim jobs whose `type` is in this list. Pass empty/undefined for any. */
  acceptedTypes?: string[];
}

interface RawClaimRow {
  id: string;
  projectConnectionId: string;
  type: string;
  entitySlug: string | null;
  payload: unknown;
  status: string;
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
  triggerSource: string;
  parentJobId: string | null;
  createdAt: Date;
  updatedAt: Date;
  projectSlug: string;
}

const toView = (row: RawClaimRow): ScheduledJobView => ({
  id: row.id,
  projectConnectionId: row.projectConnectionId,
  projectSlug: row.projectSlug,
  type: row.type as ScheduledJobView['type'],
  entitySlug: row.entitySlug,
  payload: row.payload,
  status: row.status as ScheduledJobView['status'],
  priority: row.priority,
  attempts: row.attempts,
  maxAttempts: row.maxAttempts,
  scheduledFor: row.scheduledFor,
  startedAt: row.startedAt,
  completedAt: row.completedAt,
  failedAt: row.failedAt,
  cancelledAt: row.cancelledAt,
  lockedById: row.lockedById,
  lockedUntil: row.lockedUntil,
  progress: row.progress,
  totalUnits: row.totalUnits,
  processedUnits: row.processedUnits,
  successCount: row.successCount,
  errorCount: row.errorCount,
  result: row.result,
  error: row.error,
  triggeredBy: row.triggeredBy,
  triggerSource: row.triggerSource as ScheduledJobView['triggerSource'],
  parentJobId: row.parentJobId,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const buildTypeFilter = (types: string[] | undefined): string => {
  if (!types || types.length === 0) return '';
  // Prisma $queryRaw escapes interpolated arrays, but we need a fragment inside a CTE.
  // Construct a safe single-quoted list — values come from our enum, not user input.
  const valid = types.filter((t) => /^[A-Z_]+$/.test(t));
  if (valid.length === 0) return '';
  return `AND "type"::text IN (${valid.map((t) => `'${t}'`).join(', ')})`;
};

export const claimNextJob = async (deps: ClaimDeps): Promise<ScheduledJobView | null> => {
  const lockUntil = new Date(Date.now() + deps.lockTtlMs);
  const typeFilter = buildTypeFilter(deps.acceptedTypes);

  // Single-statement CTE so the FOR UPDATE SKIP LOCKED is durable across the update.
  // We then join PlatformConnection to project projectSlug for the response.
  const rows = await deps.prisma.$queryRawUnsafe<RawClaimRow[]>(
    `WITH due AS (
       SELECT id
       FROM "ScheduledJob"
       WHERE "projectConnectionId" = $1
         AND "status" IN ('PENDING', 'RETRYING', 'SCHEDULED')
         AND "scheduledFor" <= now()
         ${typeFilter}
       ORDER BY "priority" DESC, "scheduledFor" ASC, "createdAt" ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     , updated AS (
       UPDATE "ScheduledJob" sj
       SET "status" = 'CLAIMED',
           "lockedById" = $2,
           "lockedUntil" = $3,
           "attempts" = sj."attempts" + 1,
           "startedAt" = COALESCE(sj."startedAt", now()),
           "updatedAt" = now()
       FROM due
       WHERE sj.id = due.id
       RETURNING sj.*
     )
     SELECT u.*, pc."projectSlug" AS "projectSlug"
     FROM updated u
     JOIN "PlatformConnection" pc ON pc.id = u."projectConnectionId";`,
    deps.projectConnectionId,
    deps.workerId,
    lockUntil,
  );

  if (rows.length === 0) return null;
  return toView(rows[0]!);
};
