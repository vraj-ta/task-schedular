import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Circle,
  PauseCircle,
  RotateCw,
  Skull,
  Loader2,
  XCircle,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import type { ScheduledJobStatus } from '@task-scheduler/shared-types';

/* ===========================================================================
   Data display components — empty state, skeleton, progress, JSON view,
   relative time, status pill.
   =========================================================================== */

export const EmptyState = ({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) => (
  <div className="empty">
    {icon && <div className="empty-icon">{icon}</div>}
    <div className="empty-title">{title}</div>
    {description && <div className="empty-desc">{description}</div>}
    {action && <div className="empty-actions">{action}</div>}
  </div>
);

export const SkeletonRows = ({ rows = 4 }: { rows?: number }) => (
  <div style={{ padding: 16 }}>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="skeleton skeleton-row" style={{ width: `${80 + Math.random() * 20}%` }} />
    ))}
  </div>
);

export const ProgressBar = ({
  value,
  tone = 'default',
  indeterminate,
}: {
  value: number;
  tone?: 'default' | 'success' | 'danger' | 'warning';
  indeterminate?: boolean;
}) => {
  if (indeterminate) {
    return (
      <div className="progress">
        <div className="progress-bar progress-indeterminate" />
      </div>
    );
  }
  const cls = ['progress'];
  if (tone === 'success') cls.push('progress-success');
  if (tone === 'danger') cls.push('progress-danger');
  if (tone === 'warning') cls.push('progress-warning');
  return (
    <div className={cls.join(' ')}>
      <div className="progress-bar" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
};

export const JsonView = ({ value, maxHeight }: { value: unknown; maxHeight?: number }) => {
  const text = (() => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  })();
  return (
    <pre className="json-view" style={maxHeight ? { maxHeight } : undefined}>
      {text}
    </pre>
  );
};

/* ---- Relative time ---- */
const formatRel = (date: Date, now: Date): string => {
  const diff = (date.getTime() - now.getTime()) / 1000;
  const abs = Math.abs(diff);
  const fmt = (n: number, unit: string) => {
    const rounded = Math.round(n);
    return `${rounded} ${unit}${rounded === 1 ? '' : 's'}`;
  };
  let text: string;
  if (abs < 5) text = 'just now';
  else if (abs < 60) text = fmt(abs, 'second');
  else if (abs < 3600) text = fmt(abs / 60, 'minute');
  else if (abs < 86_400) text = fmt(abs / 3600, 'hour');
  else if (abs < 86_400 * 30) text = fmt(abs / 86_400, 'day');
  else if (abs < 86_400 * 365) text = fmt(abs / (86_400 * 30), 'month');
  else text = fmt(abs / (86_400 * 365), 'year');
  if (text === 'just now') return text;
  return diff < 0 ? `${text} ago` : `in ${text}`;
};

export const TimeAgo = ({ value, fallback = '—' }: { value: string | Date | null | undefined; fallback?: string }) => {
  const [, force] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => force((x) => x + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  if (!value) return <span className="u-dim">{fallback}</span>;
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return <span className="u-dim">{fallback}</span>;
  return (
    <span title={date.toLocaleString()}>{formatRel(date, new Date())}</span>
  );
};

/* ---- Status pill ---- */
const STATUS_META: Record<ScheduledJobStatus, { icon: ReactNode; label: string }> = {
  PENDING:      { icon: <Clock size={11} />,        label: 'pending' },
  SCHEDULED:    { icon: <Clock size={11} />,        label: 'scheduled' },
  CLAIMED:      { icon: <Circle size={11} />,       label: 'claimed' },
  RUNNING:      { icon: <Loader2 size={11} className="animate-spin" />, label: 'running' },
  SUCCEEDED:    { icon: <CheckCircle2 size={11} />, label: 'succeeded' },
  FAILED:       { icon: <XCircle size={11} />,      label: 'failed' },
  CANCELLED:    { icon: <PauseCircle size={11} />,  label: 'cancelled' },
  RETRYING:     { icon: <RotateCw size={11} />,     label: 'retrying' },
  DEAD_LETTER:  { icon: <Skull size={11} />,        label: 'dead letter' },
};

export const StatusPill = ({ status }: { status: ScheduledJobStatus }) => {
  const meta = STATUS_META[status] ?? { icon: <AlertCircle size={11} />, label: status };
  return (
    <span className={`status-pill status-${status}`}>
      {meta.icon}
      {meta.label}
    </span>
  );
};

/* ---- Small helper: number formatter ---- */
export const compactNumber = (n: number | string | bigint | null | undefined): string => {
  if (n === null || n === undefined) return '—';
  const num = typeof n === 'bigint' ? Number(n) : typeof n === 'string' ? Number(n) : n;
  if (!Number.isFinite(num)) return String(n);
  if (Math.abs(num) >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (Math.abs(num) >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
  return String(num);
};
