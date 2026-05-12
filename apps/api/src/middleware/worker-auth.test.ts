import { describe, it, expect, vi } from 'vitest';

import {
  createVerifyWorkerToken,
  type VerifyWorkerTokenDeps,
  type WorkerAuthenticatedRequest,
} from './worker-auth.js';
import { generateToken, hashToken } from '../utils/crypto.js';

const VALID_TOKEN = generateToken();
const VALID_HASH = hashToken(VALID_TOKEN);

const fakeWorker = {
  id: 'worker-1',
  workerId: 'host-abc',
  capabilities: ['BULK_IMPORT', 'BULK_EXPORT'],
  enabled: true,
  projectConnection: {
    id: 'conn-1',
    projectSlug: 'project-x',
    targetType: 'NODE' as const,
    enabled: true,
  },
};

const baseDeps = (overrides: Partial<VerifyWorkerTokenDeps> = {}): VerifyWorkerTokenDeps => ({
  findWorkerByTokenHash: async (hash) => (hash === VALID_HASH ? fakeWorker : null),
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
  deps: VerifyWorkerTokenDeps,
  headers: Record<string, string>,
): Promise<{
  req: WorkerAuthenticatedRequest;
  res: ReturnType<typeof makeRes>;
  next: ReturnType<typeof vi.fn>;
}> => {
  const mw = createVerifyWorkerToken(deps);
  const req = makeReq(headers) as WorkerAuthenticatedRequest;
  const res = makeRes();
  const next = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (mw as any)(req, res, next);
  return { req, res, next };
};

describe('verifyWorkerToken', () => {
  it('attaches worker + platformConnection on the happy path', async () => {
    const { req, res, next } = await run(baseDeps(), {
      authorization: `Bearer ${VALID_TOKEN}`,
    });
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.worker).toEqual({
      id: 'worker-1',
      workerId: 'host-abc',
      capabilities: ['BULK_IMPORT', 'BULK_EXPORT'],
    });
    expect(req.platformConnection).toEqual({
      id: 'conn-1',
      projectSlug: 'project-x',
      targetType: 'NODE',
    });
  });

  it('rejects when Authorization header is missing', async () => {
    const { res, next } = await run(baseDeps(), {});
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'MISSING_BEARER_TOKEN', message: expect.any(String) },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a non-Bearer Authorization header', async () => {
    const { res } = await run(baseDeps(), { authorization: 'Basic abc123' });
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'MISSING_BEARER_TOKEN', message: expect.any(String) },
    });
  });

  it('rejects when no worker matches the presented token hash', async () => {
    const { res } = await run(baseDeps(), {
      authorization: `Bearer ${generateToken()}`,
    });
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'INVALID_WORKER_TOKEN', message: expect.any(String) },
    });
  });

  it('rejects when the worker is disabled', async () => {
    const { res } = await run(
      baseDeps({
        findWorkerByTokenHash: async () => ({ ...fakeWorker, enabled: false }),
      }),
      { authorization: `Bearer ${VALID_TOKEN}` },
    );
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'WORKER_DISABLED', message: expect.any(String) },
    });
  });

  it('rejects when the platform connection is disabled', async () => {
    const { res } = await run(
      baseDeps({
        findWorkerByTokenHash: async () => ({
          ...fakeWorker,
          projectConnection: { ...fakeWorker.projectConnection, enabled: false },
        }),
      }),
      { authorization: `Bearer ${VALID_TOKEN}` },
    );
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'PROJECT_DISABLED', message: expect.any(String) },
    });
  });

  it('propagates unexpected DB errors via next(err)', async () => {
    const dbError = new Error('connection refused');
    const { res, next } = await run(
      baseDeps({
        findWorkerByTokenHash: async () => {
          throw dbError;
        },
      }),
      { authorization: `Bearer ${VALID_TOKEN}` },
    );
    expect(next).toHaveBeenCalledWith(dbError);
    expect(res.status).not.toHaveBeenCalled();
  });
});
