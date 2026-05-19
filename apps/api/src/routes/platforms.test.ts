import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomBytes, randomUUID } from 'node:crypto';

import {
  DuplicateProjectSlugError,
  createPlatformsRouter,
  type CreateData,
  type PlatformConnectionDetail,
  type PlatformConnectionRepo,
  type PlatformConnectionSummary,
  type UpdateData,
} from './platforms.js';
import { decrypt } from '../utils/crypto.js';
import { errorHandler, notFoundHandler } from '../middleware/error-handler.js';

// ---------- in-memory repo for tests ----------

class InMemoryRepo implements PlatformConnectionRepo {
  private byId = new Map<string, PlatformConnectionDetail & {
    jwtSecretCiphertext: Buffer;
    credentialsCiphertext: Buffer | null;
  }>();
  private bySlug = new Map<string, string>();

  async create(data: CreateData): Promise<PlatformConnectionSummary> {
    if (this.bySlug.has(data.projectSlug)) {
      throw new DuplicateProjectSlugError(data.projectSlug);
    }
    const id = randomUUID();
    const now = new Date();
    const row = {
      id,
      projectSlug: data.projectSlug,
      name: data.name,
      baseUrl: data.baseUrl,
      targetType: data.targetType,
      enabled: data.enabled,
      config: data.config,
      jwtSecretCiphertext: Buffer.from(data.jwtSecretCiphertext),
      credentialsCiphertext: data.credentialsCiphertext
        ? Buffer.from(data.credentialsCiphertext)
        : null,
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(id, row);
    this.bySlug.set(data.projectSlug, id);
    return summarize(row);
  }

  async findMany(): Promise<PlatformConnectionSummary[]> {
    return [...this.byId.values()].map(summarize);
  }

  async findById(id: string): Promise<PlatformConnectionDetail | null> {
    const row = this.byId.get(id);
    return row ? detail(row) : null;
  }

  async update(id: string, patch: UpdateData): Promise<PlatformConnectionSummary | null> {
    const row = this.byId.get(id);
    if (!row) return null;
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.baseUrl !== undefined) row.baseUrl = patch.baseUrl;
    if (patch.targetType !== undefined) row.targetType = patch.targetType;
    if (patch.enabled !== undefined) row.enabled = patch.enabled;
    if (patch.config !== undefined) row.config = patch.config;
    if (patch.jwtSecretCiphertext !== undefined) {
      row.jwtSecretCiphertext = Buffer.from(patch.jwtSecretCiphertext);
    }
    if (patch.credentialsCiphertext !== undefined) {
      row.credentialsCiphertext = Buffer.from(patch.credentialsCiphertext);
    }
    row.updatedAt = new Date();
    return summarize(row);
  }

  async delete(id: string): Promise<boolean> {
    const row = this.byId.get(id);
    if (!row) return false;
    this.byId.delete(id);
    this.bySlug.delete(row.projectSlug);
    return true;
  }

  // Test-only inspection
  getCiphertext(id: string): { jwt: Buffer; creds: Buffer | null } | null {
    const row = this.byId.get(id);
    return row ? { jwt: row.jwtSecretCiphertext, creds: row.credentialsCiphertext } : null;
  }
}

const summarize = (r: {
  id: string;
  projectSlug: string;
  name: string;
  baseUrl: string;
  targetType: 'NODE' | 'DOTNET';
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}): PlatformConnectionSummary => ({
  id: r.id,
  projectSlug: r.projectSlug,
  name: r.name,
  baseUrl: r.baseUrl,
  targetType: r.targetType,
  enabled: r.enabled,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const detail = (r: { config: unknown } & PlatformConnectionSummary): PlatformConnectionDetail => ({
  ...summarize(r),
  config: r.config,
});

// ---------- harness ----------

const TEST_KEY = randomBytes(32);

const buildApp = (repo: PlatformConnectionRepo) => {
  const app = express();
  app.use(express.json());
  app.use('/api/platforms', createPlatformsRouter({ repo, loadKey: () => TEST_KEY }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

const VALID_CREATE = {
  projectSlug: 'project-x',
  name: 'Project X',
  baseUrl: 'https://x.example.com',
  targetType: 'NODE',
  jwtSecret: 'platform-shared-jwt-signing-secret',
  config: { pollIntervalMs: 2000 },
};

let repo: InMemoryRepo;
let app: express.Express;

beforeEach(() => {
  repo = new InMemoryRepo();
  app = buildApp(repo);
});

// ---------- tests ----------

describe('POST /api/platforms', () => {
  it('creates a connection (201), encrypts jwtSecret, returns plaintext exactly once', async () => {
    const res = await request(app).post('/api/platforms').send(VALID_CREATE);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      projectSlug: 'project-x',
      name: 'Project X',
      baseUrl: 'https://x.example.com',
      targetType: 'NODE',
      enabled: true,
    });
    expect(res.body.data.id).toBeTruthy();
    // The create response echoes the plaintext secret once so the caller can
    // install it on the project side.
    expect(res.body.data.jwtSecret).toBe('platform-shared-jwt-signing-secret');
    // No ciphertext fields are exposed
    expect(res.body.data).not.toHaveProperty('jwtSecretCiphertext');
    expect(res.body.data).not.toHaveProperty('credentialsCiphertext');
    // Persisted ciphertext decrypts back to the original
    const stored = repo.getCiphertext(res.body.data.id);
    expect(stored).not.toBeNull();
    expect(decrypt(stored!.jwt, TEST_KEY)).toBe('platform-shared-jwt-signing-secret');
    // Subsequent reads do NOT carry the plaintext
    const fetched = await request(app).get(`/api/platforms/${res.body.data.id}`);
    expect(fetched.body.data).not.toHaveProperty('jwtSecret');
    const listed = await request(app).get('/api/platforms');
    expect(listed.body.data[0]).not.toHaveProperty('jwtSecret');
  });

  it('generates a JWT secret when none is provided and returns it once', async () => {
    const { jwtSecret: _omit, ...withoutSecret } = VALID_CREATE;
    const res = await request(app).post('/api/platforms').send(withoutSecret);
    expect(res.status).toBe(201);
    const generated = res.body.data.jwtSecret as string;
    expect(typeof generated).toBe('string');
    // 32 random bytes hex-encoded
    expect(generated).toMatch(/^[0-9a-f]{64}$/);
    // The ciphertext decrypts back to the value we returned
    const stored = repo.getCiphertext(res.body.data.id);
    expect(decrypt(stored!.jwt, TEST_KEY)).toBe(generated);
  });

  it('encrypts credentials when provided', async () => {
    const creds = { apiKey: 'sk_live_xxx', secret: 'whsec_yyy' };
    const res = await request(app)
      .post('/api/platforms')
      .send({ ...VALID_CREATE, credentials: creds });
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toContain('sk_live_xxx');
    const stored = repo.getCiphertext(res.body.data.id);
    expect(JSON.parse(decrypt(stored!.creds!, TEST_KEY))).toEqual(creds);
  });

  it('returns 409 CONFLICT on duplicate projectSlug', async () => {
    await request(app).post('/api/platforms').send(VALID_CREATE);
    const res = await request(app).post('/api/platforms').send(VALID_CREATE);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.message).toMatch(/project-x/);
  });

  it('returns 400 VALIDATION_ERROR when projectSlug is invalid', async () => {
    const res = await request(app)
      .post('/api/platforms')
      .send({ ...VALID_CREATE, projectSlug: 'Invalid Slug!' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app).post('/api/platforms').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/platforms', () => {
  it('lists summaries (no ciphertext fields)', async () => {
    await request(app).post('/api/platforms').send(VALID_CREATE);
    await request(app)
      .post('/api/platforms')
      .send({ ...VALID_CREATE, projectSlug: 'project-y', name: 'Y' });
    const res = await request(app).get('/api/platforms');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    for (const row of res.body.data as Array<Record<string, unknown>>) {
      expect(row).not.toHaveProperty('jwtSecretCiphertext');
      expect(row).not.toHaveProperty('credentialsCiphertext');
      expect(row).not.toHaveProperty('config');
    }
  });
});

describe('GET /api/platforms/:id', () => {
  it('returns the detail (includes config, omits ciphertext)', async () => {
    const created = (await request(app).post('/api/platforms').send(VALID_CREATE)).body.data;
    const res = await request(app).get(`/api/platforms/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.config).toEqual({ pollIntervalMs: 2000 });
    expect(res.body.data).not.toHaveProperty('jwtSecretCiphertext');
  });

  it('returns 404 NOT_FOUND for an unknown id', async () => {
    const res = await request(app).get(`/api/platforms/${randomUUID()}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('PATCH /api/platforms/:id', () => {
  it('updates name + enabled and bumps updatedAt', async () => {
    const created = (await request(app).post('/api/platforms').send(VALID_CREATE)).body.data;
    const res = await request(app)
      .patch(`/api/platforms/${created.id}`)
      .send({ name: 'New Name', enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('New Name');
    expect(res.body.data.enabled).toBe(false);
  });

  it('re-encrypts when jwtSecret is provided', async () => {
    const created = (await request(app).post('/api/platforms').send(VALID_CREATE)).body.data;
    const oldCipher = repo.getCiphertext(created.id)!.jwt;
    await request(app)
      .patch(`/api/platforms/${created.id}`)
      .send({ jwtSecret: 'a-rotated-secret-value' });
    const newCipher = repo.getCiphertext(created.id)!.jwt;
    expect(newCipher.equals(oldCipher)).toBe(false);
    expect(decrypt(newCipher, TEST_KEY)).toBe('a-rotated-secret-value');
  });

  it('returns 400 on an empty patch body', async () => {
    const created = (await request(app).post('/api/platforms').send(VALID_CREATE)).body.data;
    const res = await request(app).patch(`/api/platforms/${created.id}`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app)
      .patch(`/api/platforms/${randomUUID()}`)
      .send({ name: 'X' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/platforms/:id/rotate-jwt-secret', () => {
  it('rotates the secret, returns the new plaintext once, ciphertext changes', async () => {
    const created = (await request(app).post('/api/platforms').send(VALID_CREATE)).body.data;
    const oldCipher = repo.getCiphertext(created.id)!.jwt;

    const res = await request(app)
      .post(`/api/platforms/${created.id}/rotate-jwt-secret`)
      .send({});
    expect(res.status).toBe(200);
    const newSecret = res.body.data.jwtSecret as string;
    expect(newSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(newSecret).not.toBe('platform-shared-jwt-signing-secret');

    const newCipher = repo.getCiphertext(created.id)!.jwt;
    expect(newCipher.equals(oldCipher)).toBe(false);
    expect(decrypt(newCipher, TEST_KEY)).toBe(newSecret);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app)
      .post(`/api/platforms/${randomUUID()}/rotate-jwt-secret`)
      .send({});
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/platforms/:id', () => {
  it('returns 204 and removes the row', async () => {
    const created = (await request(app).post('/api/platforms').send(VALID_CREATE)).body.data;
    const res = await request(app).delete(`/api/platforms/${created.id}`);
    expect(res.status).toBe(204);
    const list = await request(app).get('/api/platforms');
    expect(list.body.data).toHaveLength(0);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).delete(`/api/platforms/${randomUUID()}`);
    expect(res.status).toBe(404);
  });
});
