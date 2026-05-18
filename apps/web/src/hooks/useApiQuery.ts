import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../api/client.js';

/**
 * Tiny SWR-like fetch hook — no external dependency. Re-runs on `deps` change
 * and exposes `refresh()` for manual reload.
 */
export interface QueryState<T> {
  data: T | null;
  error: ApiError | Error | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export const useApiQuery = <T,>(
  fetcher: () => Promise<T>,
  deps: ReadonlyArray<unknown>,
): QueryState<T> => {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcherRef.current();
      setData(result);
    } catch (err) {
      if (err instanceof ApiError || err instanceof Error) setError(err);
      else setError(new Error(String(err)));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, refresh: run };
};
