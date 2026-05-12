import { z } from 'zod';

/**
 * Validated environment variables for the control-plane.
 *
 * Single entry point — call `loadEnv()` once at boot and pass the result to
 * everything that needs it. Missing or malformed values throw at startup
 * rather than at first use, which keeps the failure mode obvious in container
 * logs (a clean exit + the validation message, not an opaque NPE deep in a
 * request handler).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z
    .enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'])
    .default('info'),
  SCHEDULER_PORT: z.coerce.number().int().min(1).max(65_535).default(4100),
  /** Postgres connection string for the control-plane DB (`task_scheduler`). */
  SCHEDULER_DATABASE_URL: z.string().url(),
  /** AES-256-GCM key, 32 bytes hex-encoded. See utils/crypto.ts. */
  SCHEDULER_SECRET_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'must be a 32-byte hex string (64 hex chars)'),
  /**
   * Bearer secret for `/api/platforms` admin routes. Operators present it as
   * `Authorization: Bearer <key>`. Generate via `openssl rand -hex 32`.
   * Minimum 32 chars enforces enough entropy that constant-time compare is
   * meaningful even if an attacker can probe.
   */
  SCHEDULER_ADMIN_API_KEY: z.string().min(32),
  ARTIFACT_STORAGE: z.enum(['local', 's3']).default('local'),
  ARTIFACT_LOCAL_PATH: z.string().default('/var/scheduler/artifacts'),
  /** Time SIGTERM gives in-flight jobs to finish before forced shutdown. */
  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(0).default(30_000),
  /** Reaper considers a CLAIMED/RUNNING job stale once this expires. */
  WORKER_LOCK_TTL_MS: z.coerce.number().int().min(60_000).default(5 * 60_000),
  /** Max time a worker long-poll blocks before getting a 204. */
  LONG_POLL_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(30_000),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export const loadEnv = (raw: NodeJS.ProcessEnv = process.env): Env => {
  if (cached) return cached;
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = result.data;
  return cached;
};

/** Test-only: clear the cached env so a subsequent loadEnv() re-parses. */
export const resetEnvCache = (): void => {
  cached = undefined;
};
