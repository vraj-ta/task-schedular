import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { loadEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Errors that should map to a specific HTTP status with a stable error code.
 * Handlers throw these (or pass them via next()) and the error handler
 * converts to the {success: false, error: {code, message}} envelope.
 */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const NotFoundError = (resource: string): HttpError =>
  new HttpError(404, 'NOT_FOUND', `${resource} not found`);
export const BadRequestError = (message: string, details?: unknown): HttpError =>
  new HttpError(400, 'BAD_REQUEST', message, details);
export const ForbiddenError = (message = 'Forbidden'): HttpError =>
  new HttpError(403, 'FORBIDDEN', message);
export const ConflictError = (message: string): HttpError => new HttpError(409, 'CONFLICT', message);

/**
 * 404 catch-all for unmatched routes. Place AFTER all real routers but
 * BEFORE `errorHandler`.
 */
export const notFoundHandler = (req: Request, _res: Response, next: NextFunction): void => {
  next(NotFoundError(`Route ${req.method} ${req.path}`));
};

/**
 * Final error handler. Must be the last middleware on the Express app.
 * - HttpError → its declared status + code envelope
 * - ZodError → 400 VALIDATION_ERROR with field issues
 * - Anything else → 500 INTERNAL_ERROR; message is masked in production
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({ path: i.path, message: i.message })),
      },
    });
    return;
  }

  // Truly unexpected — log with full stack so operators can act.
  logger.error('unhandled error in request', {
    error: err instanceof Error
      ? { name: err.name, message: err.message, stack: err.stack }
      : err,
    method: req.method,
    path: req.path,
  });

  const isProd = (() => {
    try {
      return loadEnv().NODE_ENV === 'production';
    } catch {
      return false;
    }
  })();

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: isProd
        ? 'An unexpected error occurred'
        : err instanceof Error
          ? err.message
          : String(err),
    },
  });
};
