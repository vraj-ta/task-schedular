import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  HttpError,
  NotFoundError,
  errorHandler,
  notFoundHandler,
} from './error-handler.js';
import { resetEnvCache } from '../config/env.js';

const makeRes = () => {
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  return res;
};

const validEnv = {
  SCHEDULER_DATABASE_URL: 'postgresql://x:x@localhost:5432/x',
  SCHEDULER_SECRET_KEY: '0'.repeat(64),
};

const previousEnv = { ...process.env };
const setEnv = (overrides: Record<string, string | undefined>) => {
  Object.assign(process.env, validEnv, overrides);
  resetEnvCache();
};

beforeEach(() => {
  Object.keys(process.env).forEach((k) => {
    if (!(k in previousEnv)) delete process.env[k];
  });
  Object.assign(process.env, previousEnv);
  resetEnvCache();
});

describe('HttpError constructors', () => {
  it('NotFoundError → 404 NOT_FOUND', () => {
    const err = NotFoundError('Customer');
    expect(err).toBeInstanceOf(HttpError);
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toMatch(/Customer/);
  });

  it('BadRequestError → 400 BAD_REQUEST with details', () => {
    const err = BadRequestError('Invalid input', { field: 'name' });
    expect(err.statusCode).toBe(400);
    expect(err.details).toEqual({ field: 'name' });
  });

  it('ForbiddenError → 403 FORBIDDEN', () => {
    expect(ForbiddenError().statusCode).toBe(403);
  });

  it('ConflictError → 409 CONFLICT', () => {
    expect(ConflictError('Duplicate').statusCode).toBe(409);
  });
});

describe('notFoundHandler', () => {
  it('forwards a NOT_FOUND HttpError for unmatched routes', () => {
    const next = vi.fn();
    notFoundHandler({ method: 'GET', path: '/missing' } as never, makeRes() as never, next);
    const err = next.mock.calls[0]![0] as HttpError;
    expect(err).toBeInstanceOf(HttpError);
    expect(err.statusCode).toBe(404);
    expect(err.message).toContain('GET /missing');
  });
});

describe('errorHandler', () => {
  const req = { method: 'GET', path: '/test' } as never;

  it('maps HttpError to its declared status + envelope', () => {
    const res = makeRes();
    errorHandler(BadRequestError('bad', { x: 1 }), req, res as never, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'bad', details: { x: 1 } },
    });
  });

  it('maps ZodError to 400 VALIDATION_ERROR with field issues', () => {
    const res = makeRes();
    const parsed = z.object({ name: z.string() }).safeParse({ name: 42 });
    if (parsed.success) throw new Error('expected schema to fail');
    errorHandler(parsed.error, req, res as never, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          details: expect.arrayContaining([
            expect.objectContaining({ path: ['name'] }),
          ]),
        }),
      }),
    );
  });

  it('maps a generic Error to 500 INTERNAL_ERROR (dev shows message)', () => {
    setEnv({ NODE_ENV: 'development' });
    const res = makeRes();
    errorHandler(new Error('something broke'), req, res as never, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'something broke' },
    });
  });

  it('masks the underlying message in production', () => {
    setEnv({ NODE_ENV: 'production' });
    const res = makeRes();
    errorHandler(new Error('db pool exhausted'), req, res as never, vi.fn());
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  });

  it('handles non-Error throws (string, object) without crashing', () => {
    setEnv({ NODE_ENV: 'development' });
    const res = makeRes();
    errorHandler('something bad' as unknown as Error, req, res as never, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'INTERNAL_ERROR',
          message: expect.stringContaining('something bad'),
        }),
      }),
    );
  });
});
