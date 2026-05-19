import { Router } from 'express';
import { z } from 'zod';

import { getPrisma } from '../db.js';
import { ConflictError, NotFoundError } from '../middleware/error-handler.js';
import { encrypt, generateToken, loadEncryptionKey } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';

/// Length of a server-generated JWT secret (hex chars). 32 random bytes => 64 chars.
const GENERATED_JWT_SECRET_BYTES = 32;

/**
 * Admin routes for managing `PlatformConnection` rows — one row per registered
 * project. Sits behind `verifyAdminKey`; never exposed publicly.
 *
 * Wire-write fields (jwtSecret, credentials) are encrypted at the boundary
 * with AES-256-GCM and only the ciphertext is persisted. The plaintext is
 * accepted in the request body once, used immediately, and never logged or
 * echoed back.
 */

// ---------- Wire schemas ----------

const projectSlugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'must be lowercase kebab-case');

const targetTypeSchema = z.enum(['NODE', 'DOTNET']);

const createBodySchema = z.object({
  projectSlug: projectSlugSchema,
  name: z.string().min(1).max(200),
  baseUrl: z.string().url(),
  targetType: targetTypeSchema.default('NODE'),
  /// Optional. When omitted, the control-plane generates a fresh secret and
  /// returns it once in the create response. The operator (or platform
  /// generator) then installs it on the project side.
  jwtSecret: z.string().min(8).optional(),
  credentials: z.unknown().optional(),
  config: z.unknown().default({}),
  enabled: z.boolean().default(true),
});

const updateBodySchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    baseUrl: z.string().url().optional(),
    targetType: targetTypeSchema.optional(),
    enabled: z.boolean().optional(),
    jwtSecret: z.string().min(8).optional(),
    credentials: z.unknown().optional(),
    config: z.unknown().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'request body is empty',
  });

// ---------- Repo contract (testability seam) ----------

export interface PlatformConnectionSummary {
  id: string;
  projectSlug: string;
  name: string;
  baseUrl: string;
  targetType: 'NODE' | 'DOTNET';
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlatformConnectionDetail extends PlatformConnectionSummary {
  config: unknown;
}

export interface CreateData {
  projectSlug: string;
  name: string;
  baseUrl: string;
  targetType: 'NODE' | 'DOTNET';
  jwtSecretCiphertext: Buffer;
  credentialsCiphertext: Buffer | null;
  config: unknown;
  enabled: boolean;
}

export interface UpdateData {
  name?: string;
  baseUrl?: string;
  targetType?: 'NODE' | 'DOTNET';
  enabled?: boolean;
  jwtSecretCiphertext?: Buffer;
  credentialsCiphertext?: Buffer;
  config?: unknown;
}

export class DuplicateProjectSlugError extends Error {
  constructor(public readonly projectSlug: string) {
    super(`projectSlug '${projectSlug}' is already registered`);
    this.name = 'DuplicateProjectSlugError';
  }
}

export interface PlatformConnectionRepo {
  create(data: CreateData): Promise<PlatformConnectionSummary>;
  findMany(): Promise<PlatformConnectionSummary[]>;
  findById(id: string): Promise<PlatformConnectionDetail | null>;
  update(id: string, patch: UpdateData): Promise<PlatformConnectionSummary | null>;
  delete(id: string): Promise<boolean>;
}

export interface PlatformsRouterDeps {
  repo: PlatformConnectionRepo;
  loadKey: () => Buffer;
}

const toJson = (
  c: PlatformConnectionSummary | PlatformConnectionDetail,
): Record<string, unknown> => ({
  ...c,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

// ---------- Router ----------

export const createPlatformsRouter = (deps: PlatformsRouterDeps): Router => {
  const router = Router();

  router.post('/', async (req, res, next) => {
    try {
      const body = createBodySchema.parse(req.body);
      const key = deps.loadKey();

      const jwtSecretPlaintext = body.jwtSecret ?? generateToken(GENERATED_JWT_SECRET_BYTES);
      const wasGenerated = body.jwtSecret === undefined;

      const created = await deps.repo.create({
        projectSlug: body.projectSlug,
        name: body.name,
        baseUrl: body.baseUrl,
        targetType: body.targetType,
        jwtSecretCiphertext: encrypt(jwtSecretPlaintext, key),
        credentialsCiphertext:
          body.credentials !== undefined ? encrypt(JSON.stringify(body.credentials), key) : null,
        config: body.config ?? {},
        enabled: body.enabled,
      });

      logger.info('PlatformConnection created', {
        id: created.id,
        projectSlug: created.projectSlug,
        jwtSecretGenerated: wasGenerated,
      });

      // Return the plaintext secret exactly once. The caller (operator UI or
      // platform generator) is responsible for installing it on the project
      // side; the control-plane will never reveal it again.
      res.status(201).json({
        success: true,
        data: { ...toJson(created), jwtSecret: jwtSecretPlaintext },
      });
    } catch (err) {
      if (err instanceof DuplicateProjectSlugError) {
        return next(ConflictError(err.message));
      }
      next(err);
    }
  });

  router.get('/', async (_req, res, next) => {
    try {
      const list = await deps.repo.findMany();
      res.json({ success: true, data: list.map(toJson) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const conn = await deps.repo.findById(req.params.id ?? '');
      if (!conn) return next(NotFoundError('PlatformConnection'));
      res.json({ success: true, data: toJson(conn) });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', async (req, res, next) => {
    try {
      const body = updateBodySchema.parse(req.body);
      const key = deps.loadKey();

      const patch: UpdateData = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.baseUrl !== undefined) patch.baseUrl = body.baseUrl;
      if (body.targetType !== undefined) patch.targetType = body.targetType;
      if (body.enabled !== undefined) patch.enabled = body.enabled;
      if (body.config !== undefined) patch.config = body.config;
      if (body.jwtSecret !== undefined) {
        patch.jwtSecretCiphertext = encrypt(body.jwtSecret, key);
      }
      if (body.credentials !== undefined) {
        patch.credentialsCiphertext = encrypt(JSON.stringify(body.credentials), key);
      }

      const updated = await deps.repo.update(req.params.id ?? '', patch);
      if (!updated) return next(NotFoundError('PlatformConnection'));
      res.json({ success: true, data: toJson(updated) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/rotate-jwt-secret', async (req, res, next) => {
    try {
      const key = deps.loadKey();
      const newSecret = generateToken(GENERATED_JWT_SECRET_BYTES);

      const updated = await deps.repo.update(req.params.id ?? '', {
        jwtSecretCiphertext: encrypt(newSecret, key),
      });
      if (!updated) return next(NotFoundError('PlatformConnection'));

      logger.warn('PlatformConnection JWT secret rotated', {
        id: updated.id,
        projectSlug: updated.projectSlug,
      });

      res.json({
        success: true,
        data: { ...toJson(updated), jwtSecret: newSecret },
      });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const ok = await deps.repo.delete(req.params.id ?? '');
      if (!ok) return next(NotFoundError('PlatformConnection'));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
};

// ---------- Production Prisma-backed repo ----------

const SUMMARY_SELECT = {
  id: true,
  projectSlug: true,
  name: true,
  baseUrl: true,
  targetType: true,
  enabled: true,
  createdAt: true,
  updatedAt: true,
} as const;

const isPrismaCode = (err: unknown, code: string): boolean =>
  err !== null && typeof err === 'object' && 'code' in err && (err as { code: unknown }).code === code;

/**
 * Prisma 7's `Bytes` columns are typed as `Uint8Array<ArrayBuffer>`, while
 * Node's `Buffer` is `Uint8Array<ArrayBufferLike>` — same bytes at runtime
 * but the strict generic differs. Construct an `ArrayBuffer` explicitly so
 * the resulting view is `Uint8Array<ArrayBuffer>`, then copy in.
 */
const asBytes = (b: Buffer): Uint8Array<ArrayBuffer> => {
  const view = new Uint8Array(new ArrayBuffer(b.byteLength));
  view.set(b);
  return view;
};

export const prismaPlatformRepo: PlatformConnectionRepo = {
  async create(data) {
    try {
      return await getPrisma().platformConnection.create({
        data: {
          projectSlug: data.projectSlug,
          name: data.name,
          baseUrl: data.baseUrl,
          targetType: data.targetType,
          jwtSecretCiphertext: asBytes(data.jwtSecretCiphertext),
          credentialsCiphertext: data.credentialsCiphertext ? asBytes(data.credentialsCiphertext) : null,
          config: data.config as never,
          enabled: data.enabled,
        },
        select: SUMMARY_SELECT,
      });
    } catch (err) {
      if (isPrismaCode(err, 'P2002')) {
        throw new DuplicateProjectSlugError(data.projectSlug);
      }
      throw err;
    }
  },

  async findMany() {
    return getPrisma().platformConnection.findMany({
      select: SUMMARY_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  },

  async findById(id) {
    return getPrisma().platformConnection.findUnique({
      where: { id },
      select: { ...SUMMARY_SELECT, config: true },
    });
  },

  async update(id, patch) {
    try {
      return await getPrisma().platformConnection.update({
        where: { id },
        data: {
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.baseUrl !== undefined && { baseUrl: patch.baseUrl }),
          ...(patch.targetType !== undefined && { targetType: patch.targetType }),
          ...(patch.enabled !== undefined && { enabled: patch.enabled }),
          ...(patch.config !== undefined && { config: patch.config as never }),
          ...(patch.jwtSecretCiphertext !== undefined && {
            jwtSecretCiphertext: asBytes(patch.jwtSecretCiphertext),
          }),
          ...(patch.credentialsCiphertext !== undefined && {
            credentialsCiphertext: asBytes(patch.credentialsCiphertext),
          }),
        },
        select: SUMMARY_SELECT,
      });
    } catch (err) {
      if (isPrismaCode(err, 'P2025')) return null;
      throw err;
    }
  },

  async delete(id) {
    try {
      await getPrisma().platformConnection.delete({ where: { id } });
      return true;
    } catch (err) {
      if (isPrismaCode(err, 'P2025')) return false;
      throw err;
    }
  },
};

/** Production router wired to Prisma + the AES key from env. */
export const platformsRouter: Router = createPlatformsRouter({
  repo: prismaPlatformRepo,
  loadKey: loadEncryptionKey,
});
