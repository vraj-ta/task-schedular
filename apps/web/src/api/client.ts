/**
 * Typed fetch client for the operator console. Centralizes:
 *   - access-token attachment
 *   - 401 → refresh → retry (once)
 *   - standardized error envelope unwrap
 *
 * Callers pass a generic for the `data` field; the client returns the
 * unwrapped data or throws an `ApiError` with the standard envelope shape.
 */
import type { Session } from '../auth/AuthContext.js';

const STORAGE_KEY = 'ts.session.v1';

const readSession = (): Session | null => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
};

const writeSession = (s: Session | null): void => {
  if (s) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  else window.localStorage.removeItem(STORAGE_KEY);
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface Envelope<T> {
  success?: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

const tryRefresh = async (): Promise<string | null> => {
  const current = readSession();
  if (!current?.refreshToken) return null;
  const resp = await fetch('/api/admin/auth/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: current.refreshToken }),
  });
  if (!resp.ok) {
    writeSession(null);
    return null;
  }
  const body = (await resp.json()) as Envelope<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }>;
  if (!body.success || !body.data) {
    writeSession(null);
    return null;
  }
  const next: Session = {
    ...current,
    accessToken: body.data.accessToken,
    refreshToken: body.data.refreshToken,
    expiresAt: Date.now() + body.data.expiresIn * 1000,
  };
  writeSession(next);
  return next.accessToken;
};

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | (string | number)[]>;
  /** Skip the auto-refresh-on-401 retry path. Used by the auth endpoints themselves. */
  skipAuthRetry?: boolean;
}

const buildUrl = (path: string, query?: RequestOptions['query']): string => {
  if (!query) return path;
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v === undefined) return;
    if (Array.isArray(v)) v.forEach((vv) => params.append(k, String(vv)));
    else params.set(k, String(v));
  });
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
};

const performRequest = async <T,>(
  path: string,
  opts: RequestOptions,
  accessToken: string | null,
): Promise<Response> => {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  return fetch(buildUrl(path, opts.query), {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
};

export const apiRequest = async <T,>(path: string, opts: RequestOptions = {}): Promise<T> => {
  const session = readSession();
  let resp = await performRequest<T>(path, opts, session?.accessToken ?? null);

  if (resp.status === 401 && !opts.skipAuthRetry) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      resp = await performRequest<T>(path, opts, refreshed);
    }
  }

  const text = await resp.text();
  let parsed: Envelope<T> | undefined;
  try {
    parsed = text ? (JSON.parse(text) as Envelope<T>) : undefined;
  } catch {
    parsed = undefined;
  }

  if (!resp.ok || !parsed?.success) {
    const code = parsed?.error?.code ?? 'HTTP_ERROR';
    const message = parsed?.error?.message ?? `request failed with ${resp.status}`;
    throw new ApiError(resp.status, code, message, parsed?.error?.details);
  }
  return parsed.data as T;
};

export const api = {
  get: <T,>(path: string, query?: RequestOptions['query']): Promise<T> =>
    apiRequest<T>(path, { method: 'GET', query }),
  post: <T,>(path: string, body?: unknown): Promise<T> =>
    apiRequest<T>(path, { method: 'POST', body }),
  patch: <T,>(path: string, body?: unknown): Promise<T> =>
    apiRequest<T>(path, { method: 'PATCH', body }),
  delete: <T,>(path: string): Promise<T> =>
    apiRequest<T>(path, { method: 'DELETE' }),
};
