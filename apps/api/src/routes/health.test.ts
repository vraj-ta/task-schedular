import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { createHealthRouter } from './health.js';

const makeApp = (router: ReturnType<typeof createHealthRouter>) => {
  const app = express();
  app.use(router);
  return app;
};

describe('health routes', () => {
  it('GET /healthz returns 200 ok', async () => {
    const app = makeApp(createHealthRouter({ checkDb: async () => undefined }));
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { status: 'ok' } });
  });

  it('GET /readyz returns 200 ready when checkDb resolves', async () => {
    const app = makeApp(createHealthRouter({ checkDb: async () => undefined }));
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { status: 'ready' } });
  });

  it('GET /readyz returns 503 DB_UNREACHABLE when checkDb throws', async () => {
    const app = makeApp(
      createHealthRouter({
        checkDb: async () => {
          throw new Error('connection refused');
        },
      }),
    );
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'DB_UNREACHABLE' },
    });
  });

  it('GET /readyz does not leak the underlying DB error string', async () => {
    const app = makeApp(
      createHealthRouter({
        checkDb: async () => {
          throw new Error('sensitive db hostname: rds.internal.foo');
        },
      }),
    );
    const res = await request(app).get('/readyz');
    expect(JSON.stringify(res.body)).not.toContain('rds.internal.foo');
  });

  it('checkDb is called on every /readyz hit (not cached)', async () => {
    const checkDb = vi.fn(async () => undefined);
    const app = makeApp(createHealthRouter({ checkDb }));
    await request(app).get('/readyz');
    await request(app).get('/readyz');
    expect(checkDb).toHaveBeenCalledTimes(2);
  });
});
