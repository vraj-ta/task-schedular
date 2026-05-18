import { Router } from 'express';
import { z } from 'zod';

import { getPrisma } from '../db.js';
import type { ArtifactStore } from '../lib/artifact-store.js';
import { buildSignedDownloadUrl } from '../lib/signed-url.js';
import { NotFoundError } from '../middleware/error-handler.js';

/**
 * Artifact routes.
 *
 *   GET  /:id/signed-url   issue a short-lived signed download URL (admin-auth)
 *   GET  /:id/download     stream the artifact bytes (signed URL, NO admin-auth)
 *   DELETE /:id            remove an artifact
 *
 * Note: `/download` is mounted alongside the other routes but bypasses
 * admin auth — the signed URL is the bearer of authority. It MUST verify the
 * signature itself; the route handler does that before reading any bytes.
 */
export interface ArtifactsRouterDeps {
  store: ArtifactStore;
  signingKey: string;
  defaultTtlSeconds: number;
  publicBaseUrl: string;
}

const signedUrlQuerySchema = z.object({
  ttlSeconds: z.coerce.number().int().min(30).max(86_400).optional(),
});

export const createArtifactsRouter = (deps: ArtifactsRouterDeps): Router => {
  const router = Router();
  const prisma = getPrisma();

  router.get('/:id/signed-url', async (req, res, next) => {
    try {
      const id = req.params.id ?? '';
      const exists = await prisma.jobArtifact.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!exists) return next(NotFoundError('JobArtifact'));
      const query = signedUrlQuerySchema.parse(req.query);
      const ttl = query.ttlSeconds ?? deps.defaultTtlSeconds;
      const built = buildSignedDownloadUrl(deps.publicBaseUrl, id, ttl, {
        signingKey: deps.signingKey,
      });
      res.json({
        success: true,
        data: { url: built.url, expiresAt: built.expiresAt.toISOString() },
      });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const ok = await deps.store.remove(req.params.id ?? '');
      if (!ok) return next(NotFoundError('JobArtifact'));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
};
