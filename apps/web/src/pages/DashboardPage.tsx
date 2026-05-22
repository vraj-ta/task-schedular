import {
  Activity,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Cpu,
  Plus,
  Server,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { api } from '../api/client.js';
import type { JobsListResult, PlatformConnection, ScheduledJob, WorkerRecord } from '../api/types.js';
import { useAuth } from '../auth/AuthContext.js';
import { EmptyState, TimeAgo } from '../components/data.js';
import { Banner, Button, Card } from '../components/primitives.js';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { useAutoRefresh } from '../hooks/useAutoRefresh.js';

/* ===========================================================================
   Dashboard — calm, spacious "home" screen.
   ========================================================================= */

const greeting = (date = new Date()): string => {
  const h = date.getHours();
  if (h < 5) return 'Burning the midnight oil';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Good evening';
};

const formatDate = (date = new Date()): string =>
  date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

const firstName = (email: string | undefined, displayName: string | undefined): string => {
  if (displayName) {
    const first = displayName.split(' ')[0];
    if (first) return first;
  }
  if (!email) return 'there';
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts[0]) return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  return 'there';
};

/* ---- Sparkline ---- */
const Sparkline = ({
  data,
  tone = 'accent',
}: {
  data: number[];
  tone?: 'accent' | 'success' | 'danger' | 'warning';
}) => {
  if (data.length === 0) return null;
  const w = 200;
  const h = 36;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const pts = data.map((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const stroke = tone === 'success' ? 'var(--success)'
    : tone === 'danger' ? 'var(--danger)'
    : tone === 'warning' ? 'var(--warning)'
    : 'var(--accent)';
  const fill = tone === 'success' ? 'rgba(74, 184, 132, 0.13)'
    : tone === 'danger' ? 'rgba(220, 80, 70, 0.12)'
    : tone === 'warning' ? 'rgba(232, 158, 36, 0.13)'
    : 'rgba(102, 84, 220, 0.13)';
  const id = `sg-${tone}`;
  return (
    <svg className="stat-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={fill} />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${h} ${pts.join(' ')} ${w},${h}`}
        fill={`url(#${id})`}
      />
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
};

/* ---- Stat card ---- */
const Stat = ({
  label,
  value,
  icon,
  tone = 'accent',
  delta,
  spark,
  donut,
}: {
  label: string;
  value: string | number;
  icon: ReactNode;
  tone?: 'success' | 'danger' | 'warning' | 'accent';
  delta?: ReactNode;
  spark?: number[];
  donut?: { pct: number; tone?: 'success' | 'danger' | 'warning' | 'accent' };
}) => (
  <div className="stat">
    <div className="stat-label">
      <span className={`stat-icon tone-${tone}`}>{icon}</span>
      {label}
    </div>
    {donut ? (
      <div className="donut-wrap">
        <Donut pct={donut.pct} tone={donut.tone ?? tone} />
        <div>
          <div className="stat-value">{value}</div>
          {delta && <div className="stat-delta">{delta}</div>}
        </div>
      </div>
    ) : (
      <>
        <div className="stat-value">{value}</div>
        {delta && <div className="stat-delta">{delta}</div>}
        {spark && spark.length > 0 && <Sparkline data={spark} tone={tone} />}
      </>
    )}
  </div>
);

/* ---- Donut chart ---- */
const Donut = ({
  pct,
  tone = 'accent',
}: {
  pct: number;
  tone?: 'success' | 'danger' | 'warning' | 'accent';
}) => {
  const size = 56;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const safe = Math.max(0, Math.min(100, pct));
  const dash = (safe / 100) * c;
  const color = tone === 'success' ? 'var(--success)'
    : tone === 'danger' ? 'var(--danger)'
    : tone === 'warning' ? 'var(--warning)'
    : 'var(--accent)';
  return (
    <svg className="donut" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none"
        stroke="var(--bg-3)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={`${dash} ${c - dash}`}
        strokeDashoffset={c / 4}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray .4s ease' }}
      />
    </svg>
  );
};

/* ---- Activity row tone helper ---- */
const statusTone = (status: ScheduledJob['status']): 'success' | 'danger' | 'warning' | 'accent' | 'neutral' => {
  switch (status) {
    case 'SUCCEEDED': return 'success';
    case 'FAILED':
    case 'DEAD_LETTER': return 'danger';
    case 'PENDING':
    case 'RETRYING': return 'warning';
    case 'CLAIMED':
    case 'RUNNING':
    case 'SCHEDULED': return 'accent';
    default: return 'neutral';
  }
};

const statusLabel = (status: ScheduledJob['status']): string => {
  switch (status) {
    case 'SUCCEEDED': return 'completed';
    case 'FAILED': return 'failed';
    case 'DEAD_LETTER': return 'dead-lettered';
    case 'CLAIMED': return 'claimed by worker';
    case 'RUNNING': return 'running';
    case 'PENDING': return 'queued';
    case 'SCHEDULED': return 'scheduled';
    case 'CANCELLED': return 'cancelled';
    case 'RETRYING': return 'retrying';
    default: return String(status).toLowerCase();
  }
};

/* ---- Synthetic sparkline data (until we wire real telemetry) ---- */
const synthSpark = (seed: number, baseline = 10): number[] => {
  const out: number[] = [];
  let n = baseline;
  for (let i = 0; i < 24; i++) {
    const r = Math.sin((seed + i) * 1.3) * 4 + Math.cos((seed + i) * 0.7) * 2;
    n = Math.max(0, n + r);
    out.push(n);
  }
  return out;
};

/* ===========================================================================
   Page
   ========================================================================= */

export const DashboardPage = () => {
  const { session } = useAuth();
  const navigate = useNavigate();

  const platforms = useApiQuery<PlatformConnection[]>(() => api.get('/api/platforms'), []);
  const workers = useApiQuery<WorkerRecord[]>(() => api.get('/api/workers'), []);
  const recent = useApiQuery<JobsListResult>(() => api.get('/api/jobs', { limit: 12 }), []);

  // Auto-refresh the activity feed every 5s.
  useAutoRefresh(() => recent.refresh(), 5_000);

  const items = recent.data?.items ?? [];
  const running = items.filter((j) => j.status === 'CLAIMED' || j.status === 'RUNNING').length;
  const succeeded = items.filter((j) => j.status === 'SUCCEEDED').length;
  const failed = items.filter((j) => j.status === 'FAILED' || j.status === 'DEAD_LETTER').length;
  const total = items.length;
  const successRate = total > 0 ? Math.round((succeeded / Math.max(1, succeeded + failed)) * 100) : 100;

  const noPlatforms = platforms.data?.length === 0;
  const name = firstName(session?.admin.email, session?.admin.displayName);
  const dateLine = formatDate();
  const hello = greeting();

  const enabledWorkers = workers.data?.filter((w) => w.enabled).length ?? 0;
  const totalWorkers = workers.data?.length ?? 0;

  const sparks = useMemo(
    () => ({
      workers: synthSpark(7, Math.max(4, totalWorkers || 4)),
      running: synthSpark(13, Math.max(2, running || 2)),
    }),
    [totalWorkers, running],
  );

  return (
    <div>
      {/* Hero greeting */}
      <div className="hero">
        <div className="hero-text">
          <div className="hero-eyebrow">{dateLine}</div>
          <h1 className="hero-title">{hello}, {name}.</h1>
          <p className="hero-subtitle">
            Here&rsquo;s a quick look at your scheduler. Jobs, workers and projects all in one place.
          </p>
        </div>
        <div className="hero-actions">
          <Link to="/jobs/new">
            <Button variant="primary" iconLeft={<Plus size={14} />}>Create job</Button>
          </Link>
          <Link to="/jobs">
            <Button variant="secondary" iconRight={<ArrowRight size={14} />}>Browse jobs</Button>
          </Link>
        </div>
      </div>

      {noPlatforms && (
        <div style={{ marginBottom: 24 }}>
          <Banner tone="warning" icon={<Server size={16} />}>
            <strong>No projects registered.</strong> Add a PlatformConnection to start enqueueing jobs.&nbsp;
            <Link to="/platforms">Go to Platforms →</Link>
          </Banner>
        </div>
      )}

      {/* Stat grid */}
      <div className="stat-grid">
        <Stat
          label="Projects"
          icon={<Server size={14} />}
          value={platforms.data?.length ?? '—'}
          tone="accent"
          delta={platforms.data ? `${platforms.data.length} connected` : 'loading…'}
        />
        <Stat
          label="Workers"
          icon={<Cpu size={14} />}
          value={totalWorkers || '—'}
          tone="accent"
          delta={workers.data ? `${enabledWorkers} of ${totalWorkers} enabled` : undefined}
          spark={sparks.workers}
        />
        <Stat
          label="Running now"
          icon={<Activity size={14} />}
          value={running}
          tone="accent"
          delta="across the last 12 jobs"
          spark={sparks.running}
        />
        <Stat
          label="Success rate"
          icon={<CheckCircle2 size={14} />}
          value={total > 0 ? `${successRate}%` : '—'}
          tone={failed > 0 ? 'warning' : 'success'}
          delta={
            <span>
              <span style={{ color: 'var(--success)', fontWeight: 600 }}>{succeeded}</span>
              {' / '}
              <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{failed}</span>
              {' succeeded / failed'}
            </span>
          }
          donut={{ pct: successRate, tone: failed > 0 ? 'warning' : 'success' }}
        />
      </div>

      {/* Two-column: activity + shortcuts side */}
      <div className="dash-cols">
        <Card padded={false}>
          <div className="card-header">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ClipboardList size={16} style={{ color: 'var(--accent)' }} />
              Recent activity
            </h2>
            <span className="u-dim" style={{ fontSize: 11.5 }}>auto-refresh · 5s</span>
            <Link
              to="/jobs"
              style={{ fontSize: 12.5, color: 'var(--text-2)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              View all <ArrowRight size={12} />
            </Link>
          </div>

          {recent.loading && !recent.data && (
            <EmptyState icon={<Activity size={20} />} title="Loading recent jobs…" />
          )}

          {recent.error && (
            <div style={{ padding: 18 }}>
              <Banner tone="error">{recent.error.message}</Banner>
            </div>
          )}

          {recent.data && items.length === 0 && (
            <EmptyState
              icon={<Sparkles size={22} />}
              title="A blank canvas"
              description="Enqueue your first job and you’ll see it stream through here in real time."
              action={
                <Link to="/jobs/new">
                  <Button variant="primary" iconLeft={<Plus size={14} />}>Create job</Button>
                </Link>
              }
            />
          )}

          {recent.data && items.length > 0 && (
            <ul className="activity-list">
              {items.map((j) => (
                <li
                  key={j.id}
                  className="activity-row"
                  onClick={() => navigate(`/jobs/${j.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/jobs/${j.id}`); }}
                >
                  <span className={`activity-dot tone-${statusTone(j.status)}`} />
                  <div className="activity-main">
                    <div className="activity-title">
                      <code>{j.type}</code>
                      <span className="u-muted" style={{ marginLeft: 8 }}>{statusLabel(j.status)}</span>
                    </div>
                    <div className="activity-meta">
                      {j.projectSlug}
                      {(j.status === 'RUNNING' || j.status === 'CLAIMED') && (
                        <> · <span style={{ color: 'var(--accent)' }}>{j.progress}%</span></>
                      )}
                    </div>
                  </div>
                  <span className="activity-time"><TimeAgo value={j.createdAt} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Shortcuts side column */}
        <div className="u-stack">
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 'var(--r-2)',
                background: 'var(--accent-soft)', color: 'var(--accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <TrendingUp size={16} />
              </div>
              <h2 style={{ fontSize: 15 }}>System health</h2>
            </div>
            <div className="u-stack-sm">
              <HealthRow
                label="API"
                tone="success"
                value="healthy"
              />
              <HealthRow
                label="Workers"
                tone={enabledWorkers > 0 ? 'success' : 'warning'}
                value={`${enabledWorkers}/${totalWorkers} enabled`}
              />
              <HealthRow
                label="Projects"
                tone={platforms.data?.length ? 'success' : 'warning'}
                value={platforms.data ? `${platforms.data.length} connected` : '—'}
              />
              <HealthRow
                label="Failure backlog"
                tone={failed > 0 ? 'danger' : 'success'}
                value={failed > 0 ? `${failed} recent` : 'clear'}
              />
            </div>
          </Card>

          <TileLink
            icon={<Calendar size={18} />}
            title="Schedules"
            description="Cron-driven recurring jobs."
            to="/schedules"
          />
          <TileLink
            icon={<Server size={18} />}
            title="Platforms"
            description="Register & manage project connections."
            to="/platforms"
          />
          <TileLink
            icon={<Cpu size={18} />}
            title="Workers"
            description="Inspect registered worker capacity."
            to="/workers"
          />
        </div>
      </div>
    </div>
  );
};

/* ---- Side helpers ---- */
const HealthRow = ({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'success' | 'warning' | 'danger';
}) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
    <span style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-1)' }}>
      <span
        style={{
          width: 8, height: 8, borderRadius: 'var(--r-full)',
          background: tone === 'success' ? 'var(--success)' : tone === 'warning' ? 'var(--warning)' : 'var(--danger)',
          boxShadow:
            tone === 'success' ? '0 0 0 3px var(--success-soft)'
            : tone === 'warning' ? '0 0 0 3px var(--warning-soft)'
            : '0 0 0 3px var(--danger-soft)',
        }}
      />
      <span style={{ fontSize: 13.5 }}>{label}</span>
    </span>
    <span style={{ fontSize: 13, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{value}</span>
  </div>
);

const TileLink = ({
  icon, title, description, to,
}: { icon: ReactNode; title: string; description: string; to: string }) => (
  <Link to={to} className="tile">
    <div className="tile-head">
      <span className="tile-icon">{icon}</span>
      <ArrowRight size={14} style={{ color: 'var(--text-3)' }} />
    </div>
    <div className="tile-title">{title}</div>
    <div className="tile-desc">{description}</div>
  </Link>
);
