import { describe, it, expect, vi } from 'vitest';

import { createVerifyAdminKey } from './admin-auth.js';

const ADMIN_KEY = 'a'.repeat(64);

const makeReq = (headers: Record<string, string> = {}): unknown => ({
  header: (name: string) => headers[name.toLowerCase()],
  path: '/api/platforms',
});

const makeRes = () => {
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  return res;
};

const run = async (
  expectedKey: string,
  headers: Record<string, string>,
): Promise<{ res: ReturnType<typeof makeRes>; next: ReturnType<typeof vi.fn> }> => {
  const mw = createVerifyAdminKey({ expectedKey });
  const req = makeReq(headers);
  const res = makeRes();
  const next = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (mw as any)(req, res, next);
  return { res, next };
};

describe('verifyAdminKey', () => {
  it('calls next() when the key matches', async () => {
    const { res, next } = await run(ADMIN_KEY, { authorization: `Bearer ${ADMIN_KEY}` });
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects when Authorization header is missing', async () => {
    const { res, next } = await run(ADMIN_KEY, {});
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'MISSING_BEARER_TOKEN', message: expect.any(String) },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a non-Bearer Authorization header', async () => {
    const { res } = await run(ADMIN_KEY, { authorization: 'Basic abc123' });
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'MISSING_BEARER_TOKEN', message: expect.any(String) },
    });
  });

  it('rejects when the key does not match', async () => {
    const { res, next } = await run(ADMIN_KEY, {
      authorization: `Bearer ${'b'.repeat(64)}`,
    });
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'INVALID_ADMIN_KEY', message: expect.any(String) },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a key of wrong length even if it shares a prefix', async () => {
    const { res } = await run(ADMIN_KEY, {
      authorization: `Bearer ${'a'.repeat(63)}`,
    });
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'INVALID_ADMIN_KEY', message: expect.any(String) },
    });
  });
});
