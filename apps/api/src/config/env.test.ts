import { describe, it, expect, beforeEach } from 'vitest';
import { loadEnv, resetEnvCache } from './env.js';

const validRaw: NodeJS.ProcessEnv = {
  SCHEDULER_DATABASE_URL: 'postgresql://scheduler:scheduler@localhost:5432/task_scheduler',
  SCHEDULER_SECRET_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

describe('loadEnv', () => {
  beforeEach(() => resetEnvCache());

  it('parses a minimal valid env and applies defaults', () => {
    const env = loadEnv(validRaw);
    expect(env.NODE_ENV).toBe('development');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.SCHEDULER_PORT).toBe(4100);
    expect(env.ARTIFACT_STORAGE).toBe('local');
    expect(env.SHUTDOWN_GRACE_MS).toBe(30_000);
    expect(env.WORKER_LOCK_TTL_MS).toBe(300_000);
    expect(env.LONG_POLL_TIMEOUT_MS).toBe(30_000);
  });

  it('coerces numeric env strings', () => {
    const env = loadEnv({ ...validRaw, SCHEDULER_PORT: '5000', SHUTDOWN_GRACE_MS: '15000' });
    expect(env.SCHEDULER_PORT).toBe(5000);
    expect(env.SHUTDOWN_GRACE_MS).toBe(15_000);
  });

  it('throws on missing SCHEDULER_DATABASE_URL with a readable message', () => {
    expect(() => loadEnv({ SCHEDULER_SECRET_KEY: validRaw.SCHEDULER_SECRET_KEY })).toThrow(
      /SCHEDULER_DATABASE_URL/,
    );
  });

  it('throws on missing SCHEDULER_SECRET_KEY', () => {
    expect(() => loadEnv({ SCHEDULER_DATABASE_URL: validRaw.SCHEDULER_DATABASE_URL })).toThrow(
      /SCHEDULER_SECRET_KEY/,
    );
  });

  it('rejects a non-hex SCHEDULER_SECRET_KEY', () => {
    expect(() =>
      loadEnv({ ...validRaw, SCHEDULER_SECRET_KEY: 'not-hex-not-64-chars' }),
    ).toThrow(/SCHEDULER_SECRET_KEY/);
  });

  it('rejects a SCHEDULER_SECRET_KEY of wrong length', () => {
    expect(() =>
      loadEnv({ ...validRaw, SCHEDULER_SECRET_KEY: 'abcd' }),
    ).toThrow(/SCHEDULER_SECRET_KEY/);
  });

  it('rejects an out-of-range SCHEDULER_PORT', () => {
    expect(() => loadEnv({ ...validRaw, SCHEDULER_PORT: '70000' })).toThrow(/SCHEDULER_PORT/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() =>
      loadEnv({ ...validRaw, NODE_ENV: 'staging' as 'development' }),
    ).toThrow(/NODE_ENV/);
  });

  it('caches the parsed env across calls', () => {
    const a = loadEnv(validRaw);
    const b = loadEnv({ ...validRaw, SCHEDULER_PORT: '9999' });
    expect(a).toBe(b);
    expect(b.SCHEDULER_PORT).toBe(4100);
  });

  it('resetEnvCache clears the cache', () => {
    loadEnv(validRaw);
    resetEnvCache();
    const env = loadEnv({ ...validRaw, SCHEDULER_PORT: '9999' });
    expect(env.SCHEDULER_PORT).toBe(9999);
  });
});
