import {
  Activity,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Cpu,
  Plus,
  Server,
  TrendingUp,
  XCircle,
  Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { api } from '../api/client.js';
import type { JobsListResult, PlatformConnection, WorkerRecord } from '../api/types.js';
import { EmptyState, ProgressBar, StatusPill, TimeAgo } from '../components/data.js';
import { Banner, Button, Card } from '../components/primitives.js';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { useAutoRefresh } from '../hooks/useAutoRefresh.js';

const Stat = ({
  label,
  value,
  icon,
  tone,
  delta,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  tone?: 'success' | 'danger' | 'warning' | 'accent';
  delta?: string;
}) => {
  const iconColor = tone === 'success' ? 'var(--success)'
    : tone === 'danger' ? 'var(--danger)'
    : tone === 'warning' ? 'var(--warning)'
    : 'var(--accent)';
  return (
    <div className="stat">
      <div className="stat-label">
        <span style={{ color: iconColor, display: 'flex' }}>{icon}</span>
        {label}
      </div>
      <div className="stat-value">{value}</div>
      {delta && <div className="stat-delta">{delta}</div>}
    </div>
  );
};

export const DashboardPage = () => {
  const platforms = useApiQuery<PlatformConnection[]>(() => api.get('/api/platforms'), []);
  const workers = useApiQuery<WorkerRecord[]>(() => api.get('/api/workers'), []);
  const recent = useApiQuery<JobsListResult>(() => api.get('/api/jobs', { limit: 10 }), []);

  // Auto-refresh the activity feed every 5s.
  useAutoRefresh(() => recent.refresh(), 5_000);

  const items = recent.data?.items ?? [];
  const running = items.filter((j) => j.status === 'CLAIMED' || j.status === 'RUNNING').length;
  const succeeded = items.filter((j) => j.status === 'SUCCEEDED').length;
  const failed = items.filter((j) => j.status === 'FAILED' || j.status === 'DEAD_LETTER').length;

  const noPlatforms = platforms.data?.length === 0;

  return (
    <div>
      <div className="page-header">
        <div className="page-header-text">
          <h1>Dashboard</h1>
          <div className="page-header-desc">Live overview of jobs, schedules and workers.</div>
        </div>
        <div className="page-header-actions">
          <Link to="/jobs/new">
            <Button variant="primary" iconLeft={<Plus size={14} />}>New job</Button>
          </Link>
        </div>
      </div>

      {noPlatforms && (
        <div style={{ marginBottom: 20 }}>
          <Banner tone="warning" icon={<Server size={16} />}>
            <strong>No projects registered.</strong> Add a PlatformConnection to start enqueueing jobs.&nbsp;
            <Link to="/platforms">Go to Platforms →</Link>
          </Banner>
        </div>
      )}

      <div className="stat-grid">
        <Stat
          label="Projects"
          icon={<Server size={13} />}
          value={platforms.data?.length ?? '—'}
          tone="accent"
        />
        <Stat
          label="Workers"
          icon={<Cpu size={13} />}
          value={workers.data?.length ?? '—'}
          tone="accent"
          delta={workers.data ? `${workers.data.filter((w) => w.enabled).length} enabled` : undefined}
        />
        <Stat
          label="Running"
          icon={<Activity size={13} />}
          value={running}
          tone="accent"
          delta="in the last 10 jobs"
        />
        <Stat
          label="Succeeded"
          icon={<CheckCircle2 size={13} />}
          value={succeeded}
          tone="success"
          delta="in the last 10 jobs"
        />
        <Stat
          label="Failed"
          icon={<XCircle size={13} />}
          value={failed}
          tone={failed > 0 ? 'danger' : 'success'}
          delta="in the last 10 jobs"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 18 }}>
        {/* Recent jobs */}
        <Card padded={false}>
          <div className="card-header">
            <h2><ClipboardList size={14} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--text-2)' }} />Recent activity</h2>
            <span className="u-dim" style={{ fontSize: 11 }}>auto-refresh · 5s</span>
            <Link to="/jobs" style={{ fontSize: 12, color: 'var(--text-2)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              View all <ArrowRight size={12} />
            </Link>
          </div>
          {recent.loading && !recent.data && (
            <EmptyState
              icon={<Activity size={20} />}
              title="Loading recent jobs…"
            />
          )}
          {recent.error && (
            <div style={{ padding: 14 }}>
              <Banner tone="error">{recent.error.message}</Banner>
            </div>
          )}
          {recent.data && items.length === 0 && (
            <EmptyState
              icon={<Zap size={20} />}
              title="No jobs yet"
              description="Enqueue your first job to see it stream through here."
              action={
                <Link to="/jobs/new">
                  <Button variant="primary" iconLeft={<Plus size={14} />}>Create job</Button>
                </Link>
              }
            />
          )}
          {recent.data && items.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Type</th>
                  <th>Project</th>
                  <th>Progress</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((j) => (
                  <tr key={j.id} className="clickable" onClick={() => { window.location.href = `/jobs/${j.id}`; }}>
                    <td><StatusPill status={j.status} /></td>
                    <td><code style={{ color: 'var(--text-1)' }}>{j.type}</code></td>
                    <td>{j.projectSlug}</td>
                    <td style={{ minWidth: 160 }}>
                      {(j.status === 'RUNNING' || j.status === 'CLAIMED')
                        ? <ProgressBar value={j.progress} />
                        : j.status === 'SUCCEEDED'
                          ? <ProgressBar value={100} tone="success" />
                          : (j.status === 'FAILED' || j.status === 'DEAD_LETTER')
                            ? <ProgressBar value={j.progress || 100} tone="danger" />
                            : <span className="u-dim" style={{ fontSize: 12 }}>—</span>}
                    </td>
                    <td className="u-muted"><TimeAgo value={j.createdAt} /></td>
                    <td className="cell-actions">
                      <Link to={`/jobs/${j.id}`} style={{ fontSize: 12 }}>open</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* Shortcuts row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          <ShortcutCard
            icon={<Calendar size={16} />}
            title="Schedules"
            description="Cron-driven recurring jobs."
            to="/schedules"
          />
          <ShortcutCard
            icon={<Server size={16} />}
            title="Platforms"
            description="Register & manage project connections."
            to="/platforms"
          />
          <ShortcutCard
            icon={<Cpu size={16} />}
            title="Workers"
            description="Inspect registered worker capacity."
            to="/workers"
          />
          <ShortcutCard
            icon={<TrendingUp size={16} />}
            title="All jobs"
            description="Browse + filter every job."
            to="/jobs"
          />
        </div>
      </div>
    </div>
  );
};

const ShortcutCard = ({
  icon, title, description, to,
}: { icon: React.ReactNode; title: string; description: string; to: string }) => (
  <Link to={to} style={{ color: 'inherit' }}>
    <div className="card card-pad" style={{ transition: 'border-color .12s ease', cursor: 'pointer' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-strong)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ color: 'var(--accent)', display: 'flex' }}>{icon}</span>
        <ArrowRight size={14} style={{ color: 'var(--text-3)' }} />
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)' }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>{description}</div>
    </div>
  </Link>
);
