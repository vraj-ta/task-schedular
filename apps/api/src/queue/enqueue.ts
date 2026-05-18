import type { ScheduledJobType, TriggerSource } from '@task-scheduler/shared-types';

import type { PrismaClient } from '../generated/prisma/client.js';

/** Insert a new PENDING/SCHEDULED job. The scheduler tick + worker loop take it from there. */
export interface EnqueueInput {
  projectConnectionId: string;
  type: ScheduledJobType;
  entitySlug?: string | null;
  payload: unknown;
  priority?: number;
  maxAttempts?: number;
  scheduledFor?: Date;
  triggeredBy: string;
  triggerSource: TriggerSource;
  parentJobId?: string | null;
}

export interface EnqueueResult {
  id: string;
  status: 'PENDING' | 'SCHEDULED';
  scheduledFor: Date;
}

export const enqueueJob = async (
  prisma: PrismaClient,
  input: EnqueueInput,
): Promise<EnqueueResult> => {
  const now = new Date();
  const scheduledFor = input.scheduledFor ?? now;
  const status: 'PENDING' | 'SCHEDULED' = scheduledFor.getTime() > now.getTime() ? 'SCHEDULED' : 'PENDING';

  const row = await prisma.scheduledJob.create({
    data: {
      projectConnectionId: input.projectConnectionId,
      type: input.type,
      entitySlug: input.entitySlug ?? null,
      payload: input.payload as never,
      priority: input.priority ?? 0,
      maxAttempts: input.maxAttempts ?? 3,
      scheduledFor,
      status,
      triggeredBy: input.triggeredBy,
      triggerSource: input.triggerSource,
      parentJobId: input.parentJobId ?? null,
    },
    select: { id: true, status: true, scheduledFor: true },
  });

  return { id: row.id, status: row.status as 'PENDING' | 'SCHEDULED', scheduledFor: row.scheduledFor };
};
