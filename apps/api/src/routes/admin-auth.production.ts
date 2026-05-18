import type { Router } from 'express';

import { loadEnv } from '../config/env.js';
import {
  createAdminAuthRouter,
  createAdminUsersRouter,
  prismaAdminAuthRepo,
  prismaAdminUsersRepo,
} from './admin-auth.js';

/**
 * Production-wired admin-auth & admin-users routers.
 * Built lazily so `createApp()` can be called in tests without admin env set.
 */
export const buildAdminAuthRouter = (): Router => {
  const env = loadEnv();
  return createAdminAuthRouter({
    repo: prismaAdminAuthRepo,
    jwtSecret: env.ADMIN_JWT_SECRET,
    accessTokenTtlMin: env.ADMIN_ACCESS_TOKEN_TTL_MIN,
    refreshTokenTtlDays: env.ADMIN_REFRESH_TOKEN_TTL_DAYS,
    bcryptRounds: env.BCRYPT_ROUNDS,
  });
};

export const buildAdminUsersRouter = (): Router => {
  const env = loadEnv();
  return createAdminUsersRouter({
    repo: prismaAdminUsersRepo,
    bcryptRounds: env.BCRYPT_ROUNDS,
  });
};
