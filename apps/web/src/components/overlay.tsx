import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { Button, IconButton } from './primitives.js';

/* ===========================================================================
   Overlay-based components: Modal (centered), Drawer (right-anchored).
   Both render to document.body via portal so they escape parent stacking.
   =========================================================================== */

interface BaseOverlayProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Width override (px). Default 560 for modal/drawer. */
  width?: number;
}

const useEscapeToClose = (open: boolean, onClose: () => void) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
};

const useBodyScrollLock = (open: boolean) => {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);
};

export const Modal = ({ open, onClose, title, children, footer, width }: BaseOverlayProps) => {
  useEscapeToClose(open, onClose);
  useBodyScrollLock(open);
  if (!open) return null;
  return createPortal(
    <div
      className="overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={width ? { width } : undefined}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
};

export const Drawer = ({ open, onClose, title, children, footer, width }: BaseOverlayProps) => {
  useEscapeToClose(open, onClose);
  useBodyScrollLock(open);
  if (!open) return null;
  return createPortal(
    <div
      className="overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={width ? { width } : undefined}
      >
        <div className="drawer-header">
          <h2>{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
};

/* ---- ConfirmDialog ---- */
export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export const ConfirmDialog = ({
  open,
  onClose,
  onConfirm,
  options,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  options: ConfirmOptions;
  loading?: boolean;
}) => (
  <Modal
    open={open}
    onClose={onClose}
    title={options.title}
    width={440}
    footer={
      <>
        <Button variant="ghost" onClick={onClose} disabled={loading}>
          {options.cancelLabel ?? 'Cancel'}
        </Button>
        <Button
          variant={options.destructive ? 'danger-solid' : 'primary'}
          onClick={onConfirm}
          loading={loading}
        >
          {options.confirmLabel ?? 'Confirm'}
        </Button>
      </>
    }
  >
    {options.description && (
      <p style={{ color: 'var(--text-1)', fontSize: 13, margin: 0 }}>{options.description}</p>
    )}
  </Modal>
);
