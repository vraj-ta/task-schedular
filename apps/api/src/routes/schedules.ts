import { Router } from 'express';
import { z } from 'zod';

import { SCHEDULED_JOB_TYPES } from '@task-scheduler/shared-types';

import { getPrisma } from '../db.js';
import { BadRequestError, NotFoundError } from '../middleware/error-handler.js';
import { evaluateCron, nextRunAfter } from '../scheduler/cron.js';

/**
 * CRUD for RecurringSchedule. Each row is a cron-driven enqueue rule: the
 * scheduler tick (see scheduler/tick.ts) enqueues a fresh ScheduledJob each
 * time the cron fires.
 *
 * Operators can supply a freeform JSON `payload`; the runner reads it.
 */

const scheduledJobTypeEnum = z.enum(SCHEDULED_JOB_TYPES);
const overlapPolicyEnum = z.enum(['SKIP', 'QUEUE', 'CANCEL_PREV']);

const createBodySchema = z.object({
  projectConnectionId: z.string().uuid(),
  name: z.string().min(1).max(200),
  type: scheduledJobTypeEnum,
  payload: z.unknown().default({}),
  cronExpression: z.string().min(1).max(120),
  timezone: z.string().min(1).max(64).default('UTC'),
  enabled: z.boolean().default(true),
  overlapPolicy: overlapPolicyEnum.default('SKIP'),
});

const updateBodySchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    type: scheduledJobTypeEnum.optional(),
    payload: z.unknown().optional(),
    cronExpression: z.string().min(1).max(120).optional(),
    timezone: z.string().min(1).max(64).optional(),
    enabled: z.boolean().optional(),
    overlapPolicy: overlapPolicyEnum.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'request body is empty',
  });

const toJson = (s: {
  id: string;
  projectConnectionId: string;
  name: string;
  type: string;
  payload: unknown;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
  overlapPolicy: string;
  lastRunAt: Date | null;
  lastJobId: string | null;
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Record<string, unknown> => ({
  ...s,
  lastRunAt: s.lastRunAt?.toISOString() ?? null,
  nextRunAt: s.nextRunAt?.toISOString() ?? null,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

export const createSchedulesRouter = (): Router => {
  const router = Router();
  const prisma = getPrisma();

  router.post('/', async (req, res, next) => {
    try {
      const body = createBodySchema.parse(req.body);
      const evalResult = evaluateCron(body.cronExpression, body.timezone);
      if (!evalResult.ok) {
        return next(BadRequestError(`cronExpression invalid: ${evalResult.error}`));
      }
      try {
        const created = await prisma.recurringSchedule.create({
          data: {
            projectConnectionId: body.projectConnectionId,
            name: body.name,
            type: body.type,
            payload: body.payload as never,
            cronExpression: body.cronExpression,
            timezone: body.timezone,
            enabled: body.enabled,
            overlapPolicy: body.overlapPolicy,
            nextRunAt: evalResult.nextRunAt,
          },
          select: {
            id: true,
            projectConnectionId: true,
            name: true,
            type: true,
            payload: true,
            cronExpression: true,
            timezone: true,
            enabled: true,
            overlapPolicy: true,
            lastRunAt: true,
            lastJobId: true,
            nextRunAt: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        res.status(201).json({ success: true, data: toJson(created) });
      } catch (err) {
        if (err !== null && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
          return next(BadRequestError(`schedule with name '${body.name}' already exists for this project`));
        }
        if (err !== null && typeof err === 'object' && 'code' in err && err.code === 'P2003') {
          return next(BadRequestError('projectConnectionId does not match any PlatformConnection'));
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  });

  router.get('/', async (req, res, next) => {
    try {
      const projectConnectionId = typeof req.query.projectConnectionId === 'string'
        ? req.query.projectConnectionId
        : undefined;
      const list = await prisma.recurringSchedule.findMany({
        where: projectConnectionId ? { projectConnectionId } : undefined,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          projectConnectionId: true,
          name: true,
          type: true,
          payload: true,
          cronExpression: true,
          timezone: true,
          enabled: true,
          overlapPolicy: true,
          lastRunAt: true,
          lastJobId: true,
          nextRunAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      res.json({ success: true, data: list.map(toJson) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const row = await prisma.recurringSchedule.findUnique({
        where: { id: req.params.id ?? '' },
      });
      if (!row) return next(NotFoundError('RecurringSchedule'));
      res.json({ success: true, data: toJson(row) });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', async (req, res, next) => {
    try {
      const body = updateBodySchema.parse(req.body);
      const data: Record<string, unknown> = {};
      if (body.name !== undefined) data.name = body.name;
      if (body.type !== undefined) data.type = body.type;
      if (body.payload !== undefined) data.payload = body.payload;
      if (body.cronExpression !== undefined) data.cronExpression = body.cronExpression;
      if (body.timezone !== undefined) data.timezone = body.timezone;
      if (body.enabled !== undefined) data.enabled = body.enabled;
      if (body.overlapPolicy !== undefined) data.overlapPolicy = body.overlapPolicy;

      // Recompute nextRunAt whenever cron, timezone, or enabled changes.
      if (body.cronExpression !== undefined || body.timezone !== undefined || body.enabled !== undefined) {
        const current = await prisma.recurringSchedule.findUnique({
          where: { id: req.params.id ?? '' },
          select: { cronExpression: true, timezone: true, enabled: true },
        });
        if (!current) return next(NotFoundError('RecurringSchedule'));
        const cronExpression = body.cronExpression ?? current.cronExpression;
        const timezone = body.timezone ?? current.timezone;
        const enabled = body.enabled ?? current.enabled;
        if (enabled) {
          const evalResult = evaluateCron(cronExpression, timezone);
          if (!evalResult.ok) {
            return next(BadRequestError(`cronExpression invalid: ${evalResult.error}`));
          }
          data.nextRunAt = nextRunAfter(cronExpression, timezone, new Date());
        } else {
          data.nextRunAt = null;
        }
      }

      try {
        const updated = await prisma.recurringSchedule.update({
          where: { id: req.params.id ?? '' },
          data,
        });
        res.json({ success: true, data: toJson(updated) });
      } catch (err) {
        if (err !== null && typeof err === 'object' && 'code' in err && err.code === 'P2025') {
          return next(NotFoundError('RecurringSchedule'));
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      await prisma.recurringSchedule.delete({ where: { id: req.params.id ?? '' } });
      res.status(204).end();
    } catch (err) {
      if (err !== null && typeof err === 'object' && 'code' in err && err.code === 'P2025') {
        return next(NotFoundError('RecurringSchedule'));
      }
      next(err);
    }
  });

  router.post('/validate-cron', (req, res, next) => {
    try {
      const body = z.object({
        cronExpression: z.string().min(1),
        timezone: z.string().default('UTC'),
      }).parse(req.body);
      const result = evaluateCron(body.cronExpression, body.timezone);
      if (!result.ok) {
        return res.json({ success: true, data: { valid: false, error: result.error } });
      }
      res.json({
        success: true,
        data: {
          valid: true,
          nextRunAt: result.nextRunAt?.toISOString() ?? null,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
