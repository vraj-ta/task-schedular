import { useEffect, useState } from 'react';

/**
 * Repeatedly calls `refresh()` on the given interval while `enabled` is true.
 * Pauses when the page is hidden — avoids spamming the API when the tab is
 * in the background.
 *
 * Returns a `tick` counter you can put in dep arrays if you want to react to
 * each cycle from outside (rare; usually you just rely on refresh() doing its
 * thing in place).
 */
export const useAutoRefresh = (
  refresh: () => unknown | Promise<unknown>,
  intervalMs: number,
  enabled = true,
): { tick: number } => {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;
    let cancelled = false;

    const run = () => {
      if (cancelled) return;
      void Promise.resolve(refresh()).finally(() => {
        if (!cancelled) setTick((t) => t + 1);
      });
    };

    const onVisibility = () => {
      if (document.hidden) {
        window.clearInterval(id);
      } else {
        // restart immediately + reset interval
        run();
        id = window.setInterval(run, intervalMs);
      }
    };

    let id = window.setInterval(run, intervalMs);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, enabled]);

  return { tick };
};
