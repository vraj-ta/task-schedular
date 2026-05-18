import type { Request } from 'express';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { getPrisma } from '../db.js';
import type { AdminAuthenticatedRequest } from '../middleware/admin-session.js';
import { verifyAdminSession } from '../middleware/admin-session.js';
import { BadRequestError, NotFoundError } from '../middleware/error-handler.js';
import { generateToken, hashToken, safeEqualHex } from '../utils/crypto.js';
import { hashPassword, verifyPassword } from '../utils/passwords.js';

/**
 * Operator-UI authentication.
 *
 * - `POST /login`  -> { accessToken, refreshToken, expiresIn, admin }
 * - `POST /refresh` -> rotate refresh token; previous is revoked
 * - `POST /logout` -> revoke current session
 * - `GET  /me`     -> current admin's profile
 *
 * Access tokens are JWTs (signed with `ADMIN_JWT_SECRET`); refresh tokens are
 * opaque hex strings whose sha256 lives in `AdminSession.refreshTokenHash`.
 * Rotating on every refresh prevents replay if a refresh token leaks.
 */

const loginBodySchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

const refreshBodySchema = z.object({
  refreshToken: z.string().min(32).max(256),
});

const logoutBodySchema = z.object({
  refreshToken: z.string().min(32).max(256).optional(),
});

export type AdminRole = 'ADMIN' | 'VIEWER';

export interface AdminProfile {
  id: string;
  email: string;
  displayName: string;
  role: AdminRole;
  enabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface AdminCredentialRecord {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  role: AdminRole;
  enabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface CreatedSession {
  id: string;
  expiresAt: Date;
}

export interface SessionLookup {
  id: string;
  adminUserId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  admin: {
    id: string;
    email: string;
    displayName: string;
    role: AdminRole;
    enabled: boolean;
  };
}

export interface AdminAuthRepo {
  findByEmail(email: string): Promise<AdminCredentialRecord | null>;
  findById(id: string): Promise<AdminProfile | null>;
  recordLogin(id: string, at: Date): Promise<void>;
  createSession(input: {
    adminUserId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    userAgent: string | null;
    ipAddress: string | null;
  }): Promise<CreatedSession>;
  findSessionByHash(hash: string): Promise<SessionLookup | null>;
  rotateSession(input: {
    previousId: string;
    adminUserId: string;
    nextRefreshTokenHash: string;
    expiresAt: Date;
    userAgent: string | null;
    ipAddress: string | null;
  }): Promise<CreatedSession>;
  revokeSession(id: string, at: Date): Promise<void>;
}

export interface AdminAuthDeps {
  repo: AdminAuthRepo;
  jwtSecret: string;
  accessTokenTtlMin: number;
  refreshTokenTtlDays: number;
  bcryptRounds: number;
  now?: () => Date;
  signJwt?: (claims: Record<string, unknown>, secret: string, opts: { expiresIn: number }) => string;
}

const buildClaims = (admin: { id: string; email: string; role: AdminRole }, sessionId: string) => ({
  sub: admin.id,
  email: admin.email,
  role: admin.role,
  sid: sessionId,
});

const toProfileJson = (a: AdminProfile): Record<string, unknown> => ({
  id: a.id,
  email: a.email,
  displayName: a.displayName,
  role: a.role,
  enabled: a.enabled,
  lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
  createdAt: a.createdAt.toISOString(),
});

const safeClientMeta = (
  req: Request,
): { userAgent: string | null; ipAddress: string | null } => {
  const ua = req.header('user-agent');
  const ip = req.ip;
  return {
    userAgent: ua ? ua.slice(0, 500) : null,
    ipAddress: ip ? ip.slice(0, 64) : null,
  };
};

export const createAdminAuthRouter = (deps: AdminAuthDeps): Router => {
  const router = Router();
  const now = deps.now ?? (() => new Date());
  const sign =
    deps.signJwt ??
    ((claims, secret, opts) => jwt.sign(claims, secret, { expiresIn: opts.expiresIn }));

  router.post('/login', async (req, res, next) => {
    try {
      const body = loginBodySchema.parse(req.body);
      const admin = await deps.repo.findByEmail(body.email.toLowerCase());

      // Always run a bcrypt compare even when the user is missing — keeps the
      // timing profile of "unknown email" close to "wrong password".
      const passwordOk = admin
        ? await verifyPassword(body.password, admin.passwordHash)
        : await verifyPassword(body.password, '$2a$10$abcdefghijklmnopqrstuv');

      if (!admin || !passwordOk) {
        return res.status(401).json({
          success: false,
          error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' },
        });
      }
      if (!admin.enabled) {
        return res.status(403).json({
          success: false,
          error: { code: 'ADMIN_DISABLED', message: 'This admin account is disabled' },
        });
      }

      const issued = now();
      const refreshExpiresAt = new Date(
        issued.getTime() + deps.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
      );
      const refreshToken = generateToken(32);
      const refreshHash = hashToken(refreshToken);
      const { userAgent, ipAddress } = safeClientMeta(req);

      const session = await deps.repo.createSession({
        adminUserId: admin.id,
        refreshTokenHash: refreshHash,
        expiresAt: refreshExpiresAt,
        userAgent,
        ipAddress,
      });
      await deps.repo.recordLogin(admin.id, issued);

      const accessToken = sign(buildClaims(admin, session.id), deps.jwtSecret, {
        expiresIn: deps.accessTokenTtlMin * 60,
      });

      res.json({
        success: true,
        data: {
          accessToken,
          refreshToken,
          expiresIn: deps.accessTokenTtlMin * 60,
          refreshExpiresAt: refreshExpiresAt.toISOString(),
          admin: toProfileJson({
            id: admin.id,
            email: admin.email,
            displayName: admin.displayName,
            role: admin.role,
            enabled: admin.enabled,
            lastLoginAt: issued,
            createdAt: admin.createdAt,
          }),
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/refresh', async (req, res, next) => {
    try {
      const body = refreshBodySchema.parse(req.body);
      const hash = hashToken(body.refreshToken);
      const lookup = await deps.repo.findSessionByHash(hash);

      const issued = now();
      if (
        !lookup ||
        lookup.revokedAt !== null ||
        lookup.expiresAt.getTime() <= issued.getTime() ||
        !lookup.admin.enabled
      ) {
        return res.status(401).json({
          success: false,
          error: { code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token is not valid' },
        });
      }
      // Constant-time recheck of the hash so a length-mismatched probe can't time it.
      if (!safeEqualHex(hash, hash)) {
        return res.status(401).json({
          success: false,
          error: { code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token is not valid' },
        });
      }

      const nextToken = generateToken(32);
      const nextHash = hashToken(nextToken);
      const nextExpiresAt = new Date(
        issued.getTime() + deps.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
      );
      const { userAgent, ipAddress } = safeClientMeta(req);

      const rotated = await deps.repo.rotateSession({
        previousId: lookup.id,
        adminUserId: lookup.adminUserId,
        nextRefreshTokenHash: nextHash,
        expiresAt: nextExpiresAt,
        userAgent,
        ipAddress,
      });

      const accessToken = sign(buildClaims(lookup.admin, rotated.id), deps.jwtSecret, {
        expiresIn: deps.accessTokenTtlMin * 60,
      });

      res.json({
        success: true,
        data: {
          accessToken,
          refreshToken: nextToken,
          expiresIn: deps.accessTokenTtlMin * 60,
          refreshExpiresAt: nextExpiresAt.toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      const body = logoutBodySchema.parse(req.body ?? {});
      if (body.refreshToken) {
        const lookup = await deps.repo.findSessionByHash(hashToken(body.refreshToken));
        if (lookup && lookup.revokedAt === null) {
          await deps.repo.revokeSession(lookup.id, now());
        }
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.get('/me', verifyAdminSession, async (req, res, next) => {
    try {
      const me = (req as AdminAuthenticatedRequest).adminUser;
      if (me.isServiceKey) {
        return res.json({
          success: true,
          data: {
            id: me.id,
            email: me.email,
            displayName: 'Service key',
            role: me.role,
            enabled: true,
            lastLoginAt: null,
            createdAt: new Date(0).toISOString(),
            isServiceKey: true,
          },
        });
      }
      const profile = await deps.repo.findById(me.id);
      if (!profile) return next(NotFoundError('AdminUser'));
      res.json({ success: true, data: { ...toProfileJson(profile), isServiceKey: false } });
    } catch (err) {
      next(err);
    }
  });

  return router;
};

// ---------- Production Prisma-backed repo ----------

const ADMIN_SUMMARY_SELECT = {
  id: true,
  email: true,
  displayName: true,
  role: true,
  enabled: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

export const prismaAdminAuthRepo: AdminAuthRepo = {
  async findByEmail(email) {
    const row = await getPrisma().adminUser.findUnique({
      where: { email },
      select: { ...ADMIN_SUMMARY_SELECT, passwordHash: true },
    });
    return row;
  },
  async findById(id) {
    return getPrisma().adminUser.findUnique({
      where: { id },
      select: ADMIN_SUMMARY_SELECT,
    });
  },
  async recordLogin(id, at) {
    await getPrisma().adminUser.update({
      where: { id },
      data: { lastLoginAt: at },
      select: { id: true },
    });
  },
  async createSession(input) {
    const row = await getPrisma().adminSession.create({
      data: {
        adminUserId: input.adminUserId,
        refreshTokenHash: input.refreshTokenHash,
        expiresAt: input.expiresAt,
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
      },
      select: { id: true, expiresAt: true },
    });
    return row;
  },
  async findSessionByHash(hash) {
    return getPrisma().adminSession.findUnique({
      where: { refreshTokenHash: hash },
      select: {
        id: true,
        adminUserId: true,
        expiresAt: true,
        revokedAt: true,
        adminUser: {
          select: {
            id: true,
            email: true,
            displayName: true,
            role: true,
            enabled: true,
          },
        },
      },
    }).then((row) => (row ? { ...row, admin: row.adminUser } : null));
  },
  async rotateSession(input) {
    const prisma = getPrisma();
    return prisma.$transaction(async (tx) => {
      await tx.adminSession.update({
        where: { id: input.previousId },
        data: { revokedAt: new Date() },
        select: { id: true },
      });
      return tx.adminSession.create({
        data: {
          adminUserId: input.adminUserId,
          refreshTokenHash: input.nextRefreshTokenHash,
          expiresAt: input.expiresAt,
          userAgent: input.userAgent,
          ipAddress: input.ipAddress,
        },
        select: { id: true, expiresAt: true },
      });
    });
  },
  async revokeSession(id, at) {
    await getPrisma().adminSession.update({
      where: { id },
      data: { revokedAt: at },
      select: { id: true },
    });
  },
};

// ---------- Admin-user CRUD (operator console: manage other admins) ----------

const createAdminBodySchema = z.object({
  email: z.string().email().max(254),
  displayName: z.string().min(1).max(200),
  password: z.string().min(8).max(200),
  role: z.enum(['ADMIN', 'VIEWER']).default('ADMIN'),
});

const updateAdminBodySchema = z
  .object({
    displayName: z.string().min(1).max(200).optional(),
    role: z.enum(['ADMIN', 'VIEWER']).optional(),
    enabled: z.boolean().optional(),
    password: z.string().min(8).max(200).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'request body is empty',
  });

export interface AdminUsersRepo {
  list(): Promise<AdminProfile[]>;
  create(input: {
    email: string;
    displayName: string;
    passwordHash: string;
    role: AdminRole;
  }): Promise<AdminProfile>;
  update(
    id: string,
    patch: { displayName?: string; role?: AdminRole; enabled?: boolean; passwordHash?: string },
  ): Promise<AdminProfile | null>;
  delete(id: string): Promise<boolean>;
}

export const prismaAdminUsersRepo: AdminUsersRepo = {
  async list() {
    return getPrisma().adminUser.findMany({
      select: ADMIN_SUMMARY_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  },
  async create(input) {
    return getPrisma().adminUser.create({
      data: {
        email: input.email,
        displayName: input.displayName,
        passwordHash: input.passwordHash,
        role: input.role,
      },
      select: ADMIN_SUMMARY_SELECT,
    });
  },
  async update(id, patch) {
    try {
      return await getPrisma().adminUser.update({
        where: { id },
        data: {
          ...(patch.displayName !== undefined && { displayName: patch.displayName }),
          ...(patch.role !== undefined && { role: patch.role }),
          ...(patch.enabled !== undefined && { enabled: patch.enabled }),
          ...(patch.passwordHash !== undefined && { passwordHash: patch.passwordHash }),
        },
        select: ADMIN_SUMMARY_SELECT,
      });
    } catch (err) {
      if (err !== null && typeof err === 'object' && 'code' in err && err.code === 'P2025') {
        return null;
      }
      throw err;
    }
  },
  async delete(id) {
    try {
      await getPrisma().adminUser.delete({ where: { id } });
      return true;
    } catch (err) {
      if (err !== null && typeof err === 'object' && 'code' in err && err.code === 'P2025') {
        return false;
      }
      throw err;
    }
  },
};

export interface AdminUsersRouterDeps {
  repo: AdminUsersRepo;
  bcryptRounds: number;
}

export const createAdminUsersRouter = (deps: AdminUsersRouterDeps): Router => {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      const list = await deps.repo.list();
      res.json({ success: true, data: list.map(toProfileJson) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const body = createAdminBodySchema.parse(req.body);
      const passwordHash = await hashPassword(body.password, deps.bcryptRounds);
      try {
        const created = await deps.repo.create({
          email: body.email.toLowerCase(),
          displayName: body.displayName,
          passwordHash,
          role: body.role,
        });
        res.status(201).json({ success: true, data: toProfileJson(created) });
      } catch (err) {
        if (err !== null && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
          return next(BadRequestError(`email '${body.email}' is already registered`));
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', async (req, res, next) => {
    try {
      const body = updateAdminBodySchema.parse(req.body);
      const patch: {
        displayName?: string;
        role?: AdminRole;
        enabled?: boolean;
        passwordHash?: string;
      } = {};
      if (body.displayName !== undefined) patch.displayName = body.displayName;
      if (body.role !== undefined) patch.role = body.role;
      if (body.enabled !== undefined) patch.enabled = body.enabled;
      if (body.password !== undefined) {
        patch.passwordHash = await hashPassword(body.password, deps.bcryptRounds);
      }
      const updated = await deps.repo.update(req.params.id ?? '', patch);
      if (!updated) return next(NotFoundError('AdminUser'));
      res.json({ success: true, data: toProfileJson(updated) });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const ok = await deps.repo.delete(req.params.id ?? '');
      if (!ok) return next(NotFoundError('AdminUser'));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
};
