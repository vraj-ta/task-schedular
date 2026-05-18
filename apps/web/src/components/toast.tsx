import { AlertCircle, CheckCircle2, Info, X, AlertTriangle } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/* ===========================================================================
   Toast notification system. Replaces window.alert() everywhere — accessed
   via `const { success, error } = useToast()`.
   =========================================================================== */

type ToastTone = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  durationMs: number;
}

interface ToastContextValue {
  show: (tone: ToastTone, title: string, description?: string) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_ICONS: Record<ToastTone, ReactNode> = {
  success: <CheckCircle2 size={16} />,
  error: <AlertCircle size={16} />,
  info: <Info size={16} />,
  warning: <AlertTriangle size={16} />,
};

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((tone: ToastTone, title: string, description?: string) => {
    idRef.current += 1;
    const id = idRef.current;
    const durationMs = tone === 'error' ? 6500 : 4000;
    const toast: Toast = { id, tone, title, description, durationMs };
    setToasts((prev) => [...prev, toast]);
    window.setTimeout(() => remove(id), durationMs);
  }, [remove]);

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      success: (t, d) => show('success', t, d),
      error: (t, d) => show('error', t, d),
      info: (t, d) => show('info', t, d),
      warning: (t, d) => show('warning', t, d),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="toast-stack" aria-live="polite" aria-atomic="false">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.tone}`}>
              <span className="toast-icon">{TONE_ICONS[t.tone]}</span>
              <div className="toast-body">
                <div className="toast-title">{t.title}</div>
                {t.description && <div className="toast-desc">{t.description}</div>}
              </div>
              <button className="toast-close" aria-label="Dismiss" onClick={() => remove(t.id)}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
};

/** Helper to surface a thrown error in a toast in one line. */
export const toastFromError = (toast: ToastContextValue, title: string, err: unknown): void => {
  const msg = err instanceof Error ? err.message : String(err);
  toast.error(title, msg);
};
