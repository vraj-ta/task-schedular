import { Cron } from 'croner';

/**
 * Cron-expression utilities. We use `croner` for parsing + next-firing
 * arithmetic, but never register a per-schedule croner instance — the
 * scheduler tick is a single DB-driven loop (see `tick.ts`).
 */
export interface CronEvaluation {
  ok: true;
  nextRunAt: Date | null;
}

export interface CronEvaluationError {
  ok: false;
  error: string;
}

export const evaluateCron = (
  expression: string,
  timezone: string,
  from: Date = new Date(),
): CronEvaluation | CronEvaluationError => {
  try {
    const c = new Cron(expression, { timezone, paused: true });
    const next = c.nextRun(from);
    return { ok: true, nextRunAt: next };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'invalid cron expression',
    };
  }
};

export const nextRunAfter = (
  expression: string,
  timezone: string,
  after: Date,
): Date | null => {
  const result = evaluateCron(expression, timezone, after);
  if (!result.ok) return null;
  return result.nextRunAt;
};
