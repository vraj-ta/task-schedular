import { z } from 'zod';

import type { ScheduledJobType } from '@task-scheduler/shared-types';

import type { Runner, RunnerContext, RunnerResult } from './runner.interface.js';

/**
 * Project-DB cleanup runners (tokens / audit / uploads).
 *
 * Each calls a SQL fragment against the project's own database via the
 * `PlatformDriver`. The exact table names follow the conventions emitted by
 * the platform's generated backend:
 *
 *   - RefreshToken / Session (token cleanup)
 *   - AuditLog               (audit retention)
 *   - StagedUpload           (orphaned upload sweep)
 *
 * If the project DB doesn't have those tables (e.g. credentials are missing
 * or the driver is the .NET stub), the runner fails cleanly so the operator
 * can configure things — it does not crash the worker.
 */
const tokensPayloadSchema = z.object({
  retentionDays: z.number().int().min(0).max(3650).default(0),
});

const auditPayloadSchema = z.object({
  retentionDays: z.number().int().min(1).max(3650).default(365),
});

const uploadsPayloadSchema = z.object({
  olderThanMinutes: z.number().int().min(1).max(60 * 24 * 30).default(60),
});

const safeCount = (rows: unknown): number => {
  if (Array.isArray(rows) && rows[0] && typeof rows[0] === 'object') {
    const v = (rows[0] as { count?: unknown }).count;
    if (typeof v === 'number') return v;
    if (typeof v === 'bigint') return Number(v);
    if (typeof v === 'string') return parseInt(v, 10) || 0;
  }
  return 0;
};

const buildRunner = (
  type: ScheduledJobType,
  exec: (ctx: RunnerContext, payload: unknown) => Promise<RunnerResult>,
): Runner => ({ type, run: (payload, ctx) => exec(ctx, payload) });

export const systemCleanupTokensRunner: Runner = buildRunner('SYSTEM_CLEANUP_TOKENS', async (ctx, payload) => {
  const parsed = tokensPayloadSchema.safeParse(payload ?? {});
  if (!parsed.success) return { status: 'FAILED', error: `invalid payload: ${parsed.error.message}` };
  try {
    const db = await ctx.driver.getProjectDb();
    await ctx.heartbeat({ progress: 20 });
    const sql = `WITH del AS (
        DELETE FROM "RefreshToken"
        WHERE ("expiresAt" IS NOT NULL AND "expiresAt" < now())
           OR ("revokedAt" IS NOT NULL AND "revokedAt" < now() - ($1 || ' days')::interval)
        RETURNING 1
      )
      SELECT COUNT(*)::int AS count FROM del;`;
    const rows = await db.query<{ count: number }>(sql, [parsed.data.retentionDays]);
    const deleted = safeCount(rows);
    await ctx.heartbeat({ progress: 90, processedUnits: deleted });
    return {
      status: 'SUCCEEDED',
      result: { deletedCount: deleted },
      finalProgress: 100,
      finalProcessedUnits: deleted,
      finalSuccessCount: deleted,
      finalErrorCount: 0,
    };
  } catch (err) {
    return {
      status: 'FAILED',
      error: err instanceof Error ? err.message : 'project DB unavailable',
    };
  }
});

export const systemCleanupAuditRunner: Runner = buildRunner('SYSTEM_CLEANUP_AUDIT', async (ctx, payload) => {
  const parsed = auditPayloadSchema.safeParse(payload ?? {});
  if (!parsed.success) return { status: 'FAILED', error: `invalid payload: ${parsed.error.message}` };
  try {
    const db = await ctx.driver.getProjectDb();
    await ctx.heartbeat({ progress: 20 });
    const rows = await db.query<{ count: number }>(
      `WITH del AS (
         DELETE FROM "AuditLog" WHERE "createdAt" < now() - ($1 || ' days')::interval RETURNING 1
       )
       SELECT COUNT(*)::int AS count FROM del;`,
      [parsed.data.retentionDays],
    );
    const deleted = safeCount(rows);
    return {
      status: 'SUCCEEDED',
      result: { deletedCount: deleted },
      finalProgress: 100,
      finalProcessedUnits: deleted,
      finalSuccessCount: deleted,
      finalErrorCount: 0,
    };
  } catch (err) {
    return {
      status: 'FAILED',
      error: err instanceof Error ? err.message : 'project DB unavailable',
    };
  }
});

export const systemCleanupUploadsRunner: Runner = buildRunner('SYSTEM_CLEANUP_UPLOADS', async (ctx, payload) => {
  const parsed = uploadsPayloadSchema.safeParse(payload ?? {});
  if (!parsed.success) return { status: 'FAILED', error: `invalid payload: ${parsed.error.message}` };
  try {
    const db = await ctx.driver.getProjectDb();
    await ctx.heartbeat({ progress: 20 });
    const rows = await db.query<{ count: number }>(
      `WITH del AS (
         DELETE FROM "StagedUpload"
         WHERE "committedAt" IS NULL AND "createdAt" < now() - ($1 || ' minutes')::interval
         RETURNING 1
       )
       SELECT COUNT(*)::int AS count FROM del;`,
      [parsed.data.olderThanMinutes],
    );
    const deleted = safeCount(rows);
    return {
      status: 'SUCCEEDED',
      result: { deletedCount: deleted },
      finalProgress: 100,
      finalProcessedUnits: deleted,
      finalSuccessCount: deleted,
      finalErrorCount: 0,
    };
  } catch (err) {
    return {
      status: 'FAILED',
      error: err instanceof Error ? err.message : 'project DB unavailable',
    };
  }
});
