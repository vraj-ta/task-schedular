import { createServer } from 'node:http';

import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { disconnectPrisma } from './db.js';
import { logger } from './utils/logger.js';

const main = (): void => {
  const env = loadEnv();
  const app = createApp();
  const server = createServer(app);

  server.listen(env.SCHEDULER_PORT, () => {
    logger.info('control-plane listening', { port: env.SCHEDULER_PORT });
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info('shutdown signal received', { signal });

    let forced = false;
    const force = setTimeout(() => {
      forced = true;
      logger.warn('shutdown grace period exceeded; forcing exit', {
        graceMs: env.SHUTDOWN_GRACE_MS,
      });
      process.exit(1);
    }, env.SHUTDOWN_GRACE_MS);
    force.unref();

    server.close((err) => {
      if (forced) return;
      if (err) {
        logger.error('http server close errored', { error: err.message });
      }
      void disconnectPrisma()
        .catch((dbErr: unknown) => {
          logger.error('prisma disconnect errored', {
            error: dbErr instanceof Error ? dbErr.message : String(dbErr),
          });
        })
        .finally(() => {
          clearTimeout(force);
          logger.info('shutdown complete');
          process.exit(0);
        });
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

try {
  main();
} catch (err) {
  logger.error('control-plane failed to boot', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
}
