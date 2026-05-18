import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * Operator session state — lives in localStorage so a page reload doesn't
 * force a fresh login. The refresh token is rotated on every refresh, so
 * a leaked localStorage value is only useful until the next access-token
 * expiry (~15 min) anyway.
 */

export type AdminRole = 'ADMIN' | 'VIEWER';

export interface AdminProfile {
  id: string;
  email: string;
  displayName: string;
  role: AdminRole;
  enabled: boolean;
  isServiceKey?: boolean;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  admin: AdminProfile;
}

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Force a refresh now. Returns the new access token, or null if refresh failed. */
  refresh: () => Promise<string | null>;
  /** Update profile in-place (used after `/me` is fetched). */
  setProfile: (profile: AdminProfile) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = 'ts.session.v1';
const REFRESH_LEEWAY_MS = 60_000;

const loadStoredSession = (): Session | null => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.admin) return null;
    return parsed;
  } catch {
    return null;
  }
};

const persist = (session: Session | null): void => {
  if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  else window.localStorage.removeItem(STORAGE_KEY);
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(() => loadStoredSession());
  const [loading, setLoading] = useState(false);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    try {
      const resp = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = (await resp.json()) as {
        success?: boolean;
        error?: { code: string; message: string };
        data?: {
          accessToken: string;
          refreshToken: string;
          expiresIn: number;
          admin: AdminProfile;
        };
      };
      if (!resp.ok || !body.success || !body.data) {
        throw new Error(body.error?.message ?? 'Login failed');
      }
      const next: Session = {
        accessToken: body.data.accessToken,
        refreshToken: body.data.refreshToken,
        expiresAt: Date.now() + body.data.expiresIn * 1000,
        admin: body.data.admin,
      };
      setSession(next);
      persist(next);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async (): Promise<string | null> => {
    const current = session ?? loadStoredSession();
    if (!current) return null;
    try {
      const resp = await fetch('/api/admin/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      });
      const body = (await resp.json()) as {
        success?: boolean;
        data?: { accessToken: string; refreshToken: string; expiresIn: number };
      };
      if (!resp.ok || !body.success || !body.data) {
        setSession(null);
        persist(null);
        return null;
      }
      const next: Session = {
        ...current,
        accessToken: body.data.accessToken,
        refreshToken: body.data.refreshToken,
        expiresAt: Date.now() + body.data.expiresIn * 1000,
      };
      setSession(next);
      persist(next);
      return next.accessToken;
    } catch {
      setSession(null);
      persist(null);
      return null;
    }
  }, [session]);

  const logout = useCallback(async () => {
    const current = session;
    setSession(null);
    persist(null);
    if (current) {
      // Fire-and-forget; the local clear above already logged us out.
      await fetch('/api/admin/auth/logout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      }).catch(() => undefined);
    }
  }, [session]);

  const setProfile = useCallback((profile: AdminProfile) => {
    setSession((prev) => {
      if (!prev) return prev;
      const next: Session = { ...prev, admin: profile };
      persist(next);
      return next;
    });
  }, []);

  // Proactive refresh: when the access token is within REFRESH_LEEWAY_MS of expiry,
  // refresh it. Avoids the user clicking and getting a 401 right at boundary time.
  useEffect(() => {
    if (!session) return;
    const msUntilRefresh = session.expiresAt - Date.now() - REFRESH_LEEWAY_MS;
    if (msUntilRefresh <= 0) {
      void refresh();
      return;
    }
    const t = window.setTimeout(() => { void refresh(); }, msUntilRefresh);
    return () => window.clearTimeout(t);
  }, [session, refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({ session, loading, login, logout, refresh, setProfile }),
    [session, loading, login, logout, refresh, setProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
};
