import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

import { createApp } from './app.js';
import { resetEnvCache } from './config/env.js';

const VALID_ENV = {
  SCHEDULER_DATABASE_URL: 'postgresql://x:x@localhost:5432/x',
  SCHEDULER_SECRET_KEY: '0'.repeat(64),
  SCHEDULER_ADMIN_API_KEY: 'a'.repeat(64),
  ADMIN_JWT_SECRET: 'b'.repeat(64),
  ARTIFACT_SIGNING_KEY: 'c'.repeat(64),
};

beforeEach(() => {
  Object.assign(process.env, VALID_ENV);
  resetEnvCache();
});

describe('createApp', () => {
  it('serves /healthz', async () => {
    const res = await request(createApp()).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { status: 'ok' } });
  });

  it('responds 404 NOT_FOUND for unmatched routes via the envelope', async () => {
    const res = await request(createApp()).get('/no-such-path');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('disables x-powered-by', async () => {
    const res = await request(createApp()).get('/healthz');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('sets helmet security headers', async () => {
    const res = await request(createApp()).get('/healthz');
    // Just probe one well-known helmet default; full coverage is helmet's tests.
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('/api/platforms is gated by SCHEDULER_ADMIN_API_KEY', async () => {
    // No Authorization header → 401 MISSING_BEARER_TOKEN
    const res = await request(createApp()).get('/api/platforms');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MISSING_BEARER_TOKEN');
  });

  it('/api/platforms rejects a wrong bearer (falls through to JWT verification)', async () => {
    // Wrong static key + invalid JWT shape → INVALID_TOKEN
    const res = await request(createApp())
      .get('/api/platforms')
      .set('Authorization', `Bearer ${'b'.repeat(64)}`);
    expect(res.status).toBe(401);
    expect(['INVALID_TOKEN', 'MALFORMED_TOKEN']).toContain(res.body.error.code);
  });
});
