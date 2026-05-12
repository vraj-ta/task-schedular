import compression from 'compression';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';

import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { healthRouter } from './routes/health.js';

/**
 * Build the control-plane Express app.
 *
 * Mount order matters:
 *   1. Hardening middleware (helmet, cors, compression, json body parser)
 *   2. Health routes — unauthenticated, mounted at root
 *   3. (Coming next) /api/* routers behind auth
 *   4. 404 catch-all
 *   5. Final error handler
 */
export const createApp = (): Express => {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors());
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));

  // Liveness/readiness — outside any /api prefix and unauthenticated by design.
  app.use('/', healthRouter);

  // 404 + final error handler must remain last.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
