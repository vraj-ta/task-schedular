import compression from 'compression';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';

import { acceptEitherAdmin } from './middleware/admin-session.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { buildAdminAuthRouter, buildAdminUsersRouter } from './routes/admin-auth.production.js';
import { buildArtifactDownloadRouter, buildArtifactsRouter } from './routes/artifacts.production.js';
import { buildDispatchRouter } from './routes/dispatch.production.js';
import { healthRouter } from './routes/health.js';
import { buildJobsRouter } from './routes/jobs.production.js';
import { platformsRouter } from './routes/platforms.js';
import { buildSchedulesRouter } from './routes/schedules.production.js';
import { buildWorkersRouter } from './routes/workers.production.js';

/**
 * Build the control-plane Express app.
 *
 * Mount order matters:
 *   1. Hardening middleware (helmet, cors, compression, json body parser)
 *   2. Health routes — unauthenticated, mounted at root
 *   3. /api/admin/auth — login/refresh/logout (unauthenticated); /me behind session
 *   4. /api/* admin surface behind `acceptEitherAdmin` (operator JWT OR static admin key)
 *   5. /api/dispatch/* — worker HMAC auth (in routers themselves)
 *   6. 404 catch-all
 *   7. Final error handler
 */
export const createApp = (): Express => {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors());
  app.use(compression());
  app.use(express.json({ limit: '5mb' }));

  // Liveness/readiness — outside any /api prefix and unauthenticated by design.
  app.use('/', healthRouter);

  // Operator auth surface. login/refresh/logout are public; /me is gated inside the router.
  app.use('/api/admin/auth', buildAdminAuthRouter());

  // Public, signed-URL-authed artifact downloads — must mount BEFORE the admin gate.
  app.use('/api/artifacts', buildArtifactDownloadRouter());

  // Admin surface. Operator JWT (UI) or SCHEDULER_ADMIN_API_KEY (service) both work.
  app.use('/api/admin/users', acceptEitherAdmin, buildAdminUsersRouter());
  app.use('/api/platforms', acceptEitherAdmin, platformsRouter);
  app.use('/api/jobs', acceptEitherAdmin, buildJobsRouter());
  app.use('/api/schedules', acceptEitherAdmin, buildSchedulesRouter());
  app.use('/api/artifacts', acceptEitherAdmin, buildArtifactsRouter());
  app.use('/api/workers', acceptEitherAdmin, buildWorkersRouter());

  // Dispatch surface — per-worker HMAC bearer; routers apply their own auth.
  app.use('/api/dispatch', buildDispatchRouter());

  // 404 + final error handler must remain last.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
