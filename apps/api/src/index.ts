import { createServer } from 'node:http';

import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { disconnectPrisma, getPrisma } from './db.js';
import { createLocalArtifactStore } from './lib/artifact-store.js';
import { closeAllDrivers } from './platform-driver/factory.js';
import { startReaperLoop } from './queue/reaper.js';
import { startSchedulerLoop } from './scheduler/tick.js';
import { logger } from './utils/logger.js';
import { startInProcessWorker } from './worker/in-process-worker.js';

const main = (): void => {
  const env = loadEnv();
  const app = createApp();
  const server = createServer(app);
  const prisma = getPrisma();

  server.listen(env.SCHEDULER_PORT, () => {
    logger.info('control-plane listening', { port: env.SCHEDULER_PORT });
  });

  // Supervisor: scheduler tick + reaper always; in-process worker if enabled.
  const stopScheduler = startSchedulerLoop(prisma, env.SCHEDULER_TICK_INTERVAL_MS);
  const stopReaper = startReaperLoop(prisma, env.REAPER_INTERVAL_MS);
  logger.info('scheduler + reaper started', {
    tickMs: env.SCHEDULER_TICK_INTERVAL_MS,
    reaperMs: env.REAPER_INTERVAL_MS,
  });

  let stopWorker: (() => Promise<void>) | null = null;
  if (env.IN_PROCESS_WORKER_ENABLED) {
    const artifacts = createLocalArtifactStore({
      prisma,
      rootDir: env.ARTIFACT_LOCAL_PATH,
    });
    stopWorker = startInProcessWorker({
      prisma,
      artifacts,
      lockTtlMs: env.WORKER_LOCK_TTL_MS,
      idleMs: env.IN_PROCESS_WORKER_IDLE_MS,
      concurrency: env.IN_PROCESS_WORKER_CONCURRENCY,
    });
    logger.info('in-process worker started', {
      concurrency: env.IN_PROCESS_WORKER_CONCURRENCY,
    });
  }

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

    stopScheduler();
    stopReaper();

    server.close(async (err) => {
      if (forced) return;
      if (err) {
        logger.error('http server close errored', { error: err.message });
      }
      try {
        if (stopWorker) await stopWorker();
        await closeAllDrivers();
      } catch (e) {
        logger.error('supervisor shutdown step errored', {
          error: e instanceof Error ? e.message : String(e),
        });
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
