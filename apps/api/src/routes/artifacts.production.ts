import { Router } from 'express';

import { loadEnv } from '../config/env.js';
import { getPrisma } from '../db.js';
import { createLocalArtifactStore } from '../lib/artifact-store.js';
import { verifyArtifactSignature } from '../lib/signed-url.js';
import { NotFoundError } from '../middleware/error-handler.js';

import { createArtifactsRouter } from './artifacts.js';

/**
 * Two surfaces for artifacts:
 *
 *   1. `buildArtifactsRouter()` — admin-authed (mounted at /api/artifacts).
 *      Owns /:id/signed-url and DELETE /:id.
 *
 *   2. `buildArtifactDownloadRouter()` — public (signed-URL-authed).
 *      Mounted at /api/artifacts/:id/download in app.ts BEFORE the admin
 *      auth middleware so a download with a valid signed URL doesn't need
 *      an admin session.
 */
export const buildArtifactsRouter = (): Router => {
  const env = loadEnv();
  const store = createLocalArtifactStore({ prisma: getPrisma(), rootDir: env.ARTIFACT_LOCAL_PATH });
  return createArtifactsRouter({
    store,
    signingKey: env.ARTIFACT_SIGNING_KEY,
    defaultTtlSeconds: env.ARTIFACT_URL_TTL_SECONDS,
    publicBaseUrl: `http://localhost:${env.SCHEDULER_PORT}`,
  });
};

export const buildArtifactDownloadRouter = (): Router => {
  const env = loadEnv();
  const store = createLocalArtifactStore({ prisma: getPrisma(), rootDir: env.ARTIFACT_LOCAL_PATH });
  const router = Router();
  router.get('/:id/download', async (req, res, next) => {
    try {
      const id = req.params.id ?? '';
      const v = verifyArtifactSignature(
        id,
        typeof req.query.e === 'string' ? req.query.e : undefined,
        typeof req.query.s === 'string' ? req.query.s : undefined,
        { signingKey: env.ARTIFACT_SIGNING_KEY },
      );
      if (!v.valid) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_DOWNLOAD_URL',
            message: `signed URL is not valid (${v.reason ?? 'unknown'})`,
          },
        });
      }
      const file = await store.readStream(id).catch(() => null);
      if (!file) return next(NotFoundError('JobArtifact'));
      res.setHeader('content-type', file.mimeType);
      res.setHeader('content-length', file.sizeBytes.toString());
      res.setHeader('content-disposition', `attachment; filename="${file.filename}"`);
      file.stream.on('error', (err) => next(err));
      file.stream.pipe(res);
    } catch (err) {
      next(err);
    }
  });
  return router;
};
