import { describe, it, expect } from 'vitest';
import request from 'supertest';

import { createApp } from './app.js';

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
});
