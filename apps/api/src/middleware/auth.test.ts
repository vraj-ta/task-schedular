import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';

import {
  createVerifyUserJwt,
  type AuthenticatedRequest,
  type VerifyUserJwtDeps,
} from './auth.js';
import { encrypt } from '../utils/crypto.js';

const KEY = randomBytes(32);
const SIGNING_SECRET = 'platform-shared-jwt-signing-secret';
const CIPHERTEXT = encrypt(SIGNING_SECRET, KEY);

const signClaims = (claims: Record<string, unknown>, secret = SIGNING_SECRET): string =>
  jwt.sign(claims, secret, { expiresIn: '5m' });

const fakeConnection = {
  id: 'conn-1',
  projectSlug: 'project-x',
  targetType: 'NODE' as const,
  enabled: true,
  jwtSecretCiphertext: CIPHERTEXT,
};

const baseDeps = (overrides: Partial<VerifyUserJwtDeps> = {}): VerifyUserJwtDeps => ({
  findConnection: async () => fakeConnection,
  loadKey: () => KEY,
  verifyJwt: (token, secret) => jwt.verify(token, secret),
  ...overrides,
});

const makeReq = (headers: Record<string, string> = {}): unknown => ({
  header: (name: string) => headers[name.toLowerCase()],
});

const makeRes = () => {
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  return res;
};

const run = async (
  deps: VerifyUserJwtDeps,
  headers: Record<string, string>,
): Promise<{
  req: AuthenticatedRequest;
  res: ReturnType<typeof makeRes>;
  next: ReturnType<typeof vi.fn>;
}> => {
  const mw = createVerifyUserJwt(deps);
  const req = makeReq(headers) as AuthenticatedRequest;
  const res = makeRes();
  const next = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (mw as any)(req, res, next);
  return { req, res, next };
};

describe('verifyUserJwt', () => {
  it('attaches user + platformConnection on the happy path', async () => {
    const token = signClaims({ userId: 'user-1', email: 'a@b.com', role: 'admin', audience: 'admin' });
    const { req, res, next } = await run(baseDeps(), {
      'x-project-id': 'project-x',
      authorization: `Bearer ${token}`,
    });
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.user).toEqual({
      id: 'user-1',
      email: 'a@b.com',
      role: 'admin',
      audience: 'admin',
    });
    expect(req.platformConnection).toEqual({
      id: 'conn-1',
      projectSlug: 'project-x',
      targetType: 'NODE',
    });
  });

  it('rejects when X-Project-Id is missing', async () => {
    const token = signClaims({ userId: 'user-1', role: 'admin' });
    const { res, next } = await run(baseDeps(), { authorization: `Bearer ${token}` });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'MISSING_PROJECT_ID', message: expect.any(String) },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects when Authorization header is missing', async () => {
    const { res, next } = await run(baseDeps(), { 'x-project-id': 'project-x' });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'MISSING_BEARER_TOKEN', message: expect.any(String) },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a non-Bearer Authorization header', async () => {
    const { res } = await run(baseDeps(), {
      'x-project-id': 'project-x',
      authorization: 'Basic abc123',
    });
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'MISSING_BEARER_TOKEN', message: expect.any(String) },
    });
  });

  it('rejects when the project is unknown', async () => {
    const token = signClaims({ userId: 'user-1', role: 'admin' });
    const { res } = await run(baseDeps({ findConnection: async () => null }), {
      'x-project-id': 'project-y',
      authorization: `Bearer ${token}`,
    });
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'UNKNOWN_PROJECT', message: expect.stringContaining('project-y') },
    });
  });

  it('rejects when the project is disabled', async () => {
    const token = signClaims({ userId: 'user-1', role: 'admin' });
    const { res } = await run(
      baseDeps({ findConnection: async () => ({ ...fakeConnection, enabled: false }) }),
      { 'x-project-id': 'project-x', authorization: `Bearer ${token}` },
    );
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'PROJECT_DISABLED', message: expect.any(String) },
    });
  });

  it('rejects a JWT signed with the wrong secret', async () => {
    const token = signClaims({ userId: 'user-1', role: 'admin' }, 'a-different-secret');
    const { res } = await run(baseDeps(), {
      'x-project-id': 'project-x',
      authorization: `Bearer ${token}`,
    });
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'INVALID_TOKEN', message: expect.any(String) },
    });
  });

  it('rejects a JWT whose payload is missing the role claim', async () => {
    const token = signClaims({ userId: 'user-1' });
    const { res } = await run(baseDeps(), {
      'x-project-id': 'project-x',
      authorization: `Bearer ${token}`,
    });
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'MALFORMED_TOKEN', message: expect.any(String) },
    });
  });

  it('propagates unexpected DB errors via next(err)', async () => {
    const dbError = new Error('connection refused');
    const token = signClaims({ userId: 'user-1', role: 'admin' });
    const { res, next } = await run(
      baseDeps({
        findConnection: async () => {
          throw dbError;
        },
      }),
      { 'x-project-id': 'project-x', authorization: `Bearer ${token}` },
    );
    expect(next).toHaveBeenCalledWith(dbError);
    expect(res.status).not.toHaveBeenCalled();
  });
});
