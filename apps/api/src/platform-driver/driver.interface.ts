import type { PlatformTargetType } from '@task-scheduler/shared-types';

/**
 * Abstraction over the project-side platform a runner needs to talk to.
 *
 * Implementations:
 *   - `NodePlatformDriver`     — generated Node + Prisma backends from
 *                                ReactAIClientConfiguration.
 *   - `DotNetPlatformDriver`   — stub for forward-compatibility with a future
 *                                .NET re-implementation.
 *
 * A driver instance is keyed by `PlatformConnection.id`; the factory holds a
 * cache so we don't re-open a pg pool on every job.
 */
export interface PlatformConnectionInfo {
  id: string;
  projectSlug: string;
  baseUrl: string;
  targetType: PlatformTargetType;
  /** Decrypted credentials JSON. May contain a `databaseUrl` and other service creds. */
  credentials: unknown;
}

export interface ProjectDbHandle {
  /** Execute a parameterized SQL query against the project's DB. */
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Acquire a transactional handle. The callback runs inside BEGIN/COMMIT. */
  transaction<T>(fn: (tx: ProjectDbHandle) => Promise<T>): Promise<T>;
  /** Release pool resources. Called by the driver on `close()`. */
  close(): Promise<void>;
}

export interface PlatformDriver {
  readonly targetType: PlatformTargetType;
  readonly connection: PlatformConnectionInfo;

  /**
   * Get a handle to the project's data-plane DB. Drivers may pool internally;
   * callers should not assume the handle is fresh between invocations.
   */
  getProjectDb(): Promise<ProjectDbHandle>;

  /**
   * Forward a `SCHEDULED_ACTION` invocation to the project's backend. The
   * exact mechanism is target-specific: the Node driver POSTs to a known
   * route on the project's admin-backend with a service-credential header.
   */
  invokeAction(input: {
    actionSlug: string;
    params: Record<string, unknown>;
    /** userId the action runs on behalf of; project-side audit log uses this. */
    triggeredBy: string;
  }): Promise<{ success: boolean; result?: unknown; error?: string }>;

  /** Release any pooled resources. Called on shutdown or when a connection is deleted. */
  close(): Promise<void>;
}
