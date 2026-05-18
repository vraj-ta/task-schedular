import type { ScheduledJobStatus, ScheduledJobType } from '@task-scheduler/shared-types';

import type { PrismaClient } from '../generated/prisma/client.js';

import type { ScheduledJobView } from './types.js';

export interface ListFilter {
  projectConnectionId?: string;
  status?: ScheduledJobStatus[];
  type?: ScheduledJobType[];
  /** Page size; defaults to 50, max 200. */
  limit?: number;
  /** Cursor (job id from a previous page). */
  cursor?: string;
}

export interface ListResult {
  items: ScheduledJobView[];
  nextCursor: string | null;
}

const SELECT_FULL = {
  id: true,
  projectConnectionId: true,
  type: true,
  entitySlug: true,
  payload: true,
  status: true,
  priority: true,
  attempts: true,
  maxAttempts: true,
  scheduledFor: true,
  startedAt: true,
  completedAt: true,
  failedAt: true,
  cancelledAt: true,
  lockedById: true,
  lockedUntil: true,
  progress: true,
  totalUnits: true,
  processedUnits: true,
  successCount: true,
  errorCount: true,
  result: true,
  error: true,
  triggeredBy: true,
  triggerSource: true,
  parentJobId: true,
  createdAt: true,
  updatedAt: true,
  projectConnection: { select: { projectSlug: true } },
} as const;

type Row = {
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
  projectConnection: { projectSlug: string };
};

const toView = (r: Row): ScheduledJobView => ({
  id: r.id,
  projectConnectionId: r.projectConnectionId,
  projectSlug: r.projectConnection.projectSlug,
  type: r.type as ScheduledJobView['type'],
  entitySlug: r.entitySlug,
  payload: r.payload,
  status: r.status as ScheduledJobView['status'],
  priority: r.priority,
  attempts: r.attempts,
  maxAttempts: r.maxAttempts,
  scheduledFor: r.scheduledFor,
  startedAt: r.startedAt,
  completedAt: r.completedAt,
  failedAt: r.failedAt,
  cancelledAt: r.cancelledAt,
  lockedById: r.lockedById,
  lockedUntil: r.lockedUntil,
  progress: r.progress,
  totalUnits: r.totalUnits,
  processedUnits: r.processedUnits,
  successCount: r.successCount,
  errorCount: r.errorCount,
  result: r.result,
  error: r.error,
  triggeredBy: r.triggeredBy,
  triggerSource: r.triggerSource as ScheduledJobView['triggerSource'],
  parentJobId: r.parentJobId,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

export const listJobs = async (
  prisma: PrismaClient,
  filter: ListFilter,
): Promise<ListResult> => {
  const limit = Math.min(200, Math.max(1, filter.limit ?? 50));

  const where: Record<string, unknown> = {};
  if (filter.projectConnectionId) where.projectConnectionId = filter.projectConnectionId;
  if (filter.status && filter.status.length > 0) where.status = { in: filter.status };
  if (filter.type && filter.type.length > 0) where.type = { in: filter.type };

  const rows = await prisma.scheduledJob.findMany({
    where,
    select: SELECT_FULL,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(filter.cursor && { cursor: { id: filter.cursor }, skip: 1 }),
  });

  const items = rows.slice(0, limit).map(toView);
  const nextCursor = rows.length > limit ? (rows[limit - 1]?.id ?? null) : null;
  return { items, nextCursor };
};

export const getJobById = async (
  prisma: PrismaClient,
  id: string,
): Promise<ScheduledJobView | null> => {
  const row = await prisma.scheduledJob.findUnique({
    where: { id },
    select: SELECT_FULL,
  });
  return row ? toView(row) : null;
};
