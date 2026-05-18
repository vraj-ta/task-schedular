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
  /**
   * HMAC signing key for the operator-UI access-token JWT. Required for the
   * `apps/web` login flow. Generate via `openssl rand -hex 32`.
   */
  ADMIN_JWT_SECRET: z.string().min(32),
  /** Lifetime of issued operator access tokens (JWT). */
  ADMIN_ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().min(1).max(1440).default(15),
  /** Lifetime of issued operator refresh tokens (DB-backed `AdminSession`). */
  ADMIN_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** bcrypt cost factor. 10 is a good default for interactive logins. */
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
  /**
   * HMAC key for signed artifact-download URLs. Separate from `SCHEDULER_SECRET_KEY`
   * so a leaked download link can't compromise PlatformConnection secrets.
   * Generate via `openssl rand -hex 32`.
   */
  ARTIFACT_SIGNING_KEY: z.string().min(32),
  ARTIFACT_STORAGE: z.enum(['local', 's3']).default('local'),
  ARTIFACT_LOCAL_PATH: z.string().default('/var/scheduler/artifacts'),
  /** Max artifact-download signed-URL TTL (seconds). */
  ARTIFACT_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(86_400).default(600),
  /** Time SIGTERM gives in-flight jobs to finish before forced shutdown. */
  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(0).default(30_000),
  /** Reaper considers a CLAIMED/RUNNING job stale once this expires. */
  WORKER_LOCK_TTL_MS: z.coerce.number().int().min(60_000).default(5 * 60_000),
  /** Reaper sweep cadence (ms). */
  REAPER_INTERVAL_MS: z.coerce.number().int().min(5_000).default(30_000),
  /** Scheduler tick cadence (ms) — how often we look for due RecurringSchedules. */
  SCHEDULER_TICK_INTERVAL_MS: z.coerce.number().int().min(1_000).default(15_000),
  /** Max time a worker long-poll blocks before getting a 204. */
  LONG_POLL_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(30_000),
  /** Whether the in-process worker is enabled. Disable in tests. */
  IN_PROCESS_WORKER_ENABLED: z
    .union([z.boolean(), z.enum(['true', 'false', '0', '1'])])
    .transform((v) => v === true || v === 'true' || v === '1')
    .default(true),
  /** Concurrency for the in-process worker. */
  IN_PROCESS_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(2),
  /** Poll cadence when the in-process worker finds no claimable work. */
  IN_PROCESS_WORKER_IDLE_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
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
