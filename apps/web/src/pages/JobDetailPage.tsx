import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Calendar,
  CheckCircle2,
  Cpu,
  Download,
  FileText,
  Hash,
  RefreshCw,
  User,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { api, ApiError } from '../api/client.js';
import type { JobArtifact, ScheduledJob } from '../api/types.js';
import {
  compactNumber,
  JsonView,
  ProgressBar,
  SkeletonRows,
  StatusPill,
  TimeAgo,
} from '../components/data.js';
import { ConfirmDialog } from '../components/overlay.js';
import { Badge, Banner, Button, Card, IconButton } from '../components/primitives.js';
import { useToast } from '../components/toast.js';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { useAutoRefresh } from '../hooks/useAutoRefresh.js';

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD_LETTER']);

export const JobDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();

  const job = useApiQuery<ScheduledJob>(() => api.get(`/api/jobs/${id}`), [id]);
  const artifacts = useApiQuery<JobArtifact[]>(() => api.get(`/api/jobs/${id}/artifacts`), [id]);

  const [cancelling, setCancelling] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isTerminal = job.data ? TERMINAL.has(job.data.status) : true;

  // Auto-refresh while the job is live (every 2s). Stops once terminal.
  useAutoRefresh(() => job.refresh(), 2_000, !isTerminal);

  const onCancel = async () => {
    if (!id) return;
    setCancelling(true);
    try {
      await api.post(`/api/jobs/${id}/cancel`, {});
      toast.success('Cancellation requested', 'The worker will stop at the next chunk boundary.');
      await job.refresh();
      setConfirmOpen(false);
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.code, err.message);
      else toast.error('Failed to cancel', err instanceof Error ? err.message : String(err));
    } finally {
      setCancelling(false);
    }
  };

  const downloadArtifact = async (artifactId: string) => {
    try {
      const result = await api.get<{ url: string; expiresAt: string }>(
        `/api/artifacts/${artifactId}/signed-url`,
      );
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error('Failed to issue download URL', err instanceof Error ? err.message : String(err));
    }
  };

  if (job.loading && !job.data) {
    return (
      <div>
        <BackLink />
        <Card padded={false}><SkeletonRows rows={5} /></Card>
      </div>
    );
  }
  if (job.error) {
    return (
      <div>
        <BackLink />
        <Banner tone="error">{job.error.message}</Banner>
      </div>
    );
  }
  if (!job.data) return null;
  const j = job.data;

  const progressTone =
    j.status === 'SUCCEEDED' ? 'success'
    : (j.status === 'FAILED' || j.status === 'DEAD_LETTER') ? 'danger'
    : 'default';

  return (
    <div>
      <BackLink />

      <div className="page-header">
        <div className="page-header-text" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <StatusPill status={j.status} />
          <h1 style={{ fontSize: 18 }}><code>{j.type}</code></h1>
          <Badge tone="neutral">{j.projectSlug}</Badge>
          {j.entitySlug && <Badge tone="accent">{j.entitySlug}</Badge>}
        </div>
        <div className="page-header-actions">
          <IconButton label="Refresh" onClick={() => void job.refresh()}>
            <RefreshCw size={14} className={job.loading ? 'animate-spin' : undefined} />
          </IconButton>
          <Button
            variant="danger"
            iconLeft={<Ban size={14} />}
            disabled={isTerminal || cancelling}
            onClick={() => setConfirmOpen(true)}
          >
            Cancel
          </Button>
        </div>
      </div>

      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', marginBottom: 20 }}>
        <Hash size={11} style={{ verticalAlign: -1 }} /> {j.id}
      </div>

      {/* Progress hero */}
      <Card padded>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
            Progress
            {!isTerminal && <span className="u-dim" style={{ marginLeft: 8, fontSize: 11 }}>· live, refreshing every 2s</span>}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-0)' }}>{j.progress}%</div>
        </div>
        <ProgressBar value={j.progress} tone={progressTone} />
        <div style={{ display: 'flex', gap: 22, marginTop: 14, flexWrap: 'wrap' }}>
          <Stat icon={<Cpu size={12} />} label="Attempts" value={`${j.attempts} / ${j.maxAttempts}`} />
          <Stat icon={<CheckCircle2 size={12} />} label="Processed" value={compactNumber(j.processedUnits)} />
          <Stat icon={<CheckCircle2 size={12} />} label="Success" value={compactNumber(j.successCount)} />
          <Stat icon={<AlertTriangle size={12} />} label="Errors" value={compactNumber(j.errorCount)} />
          {j.totalUnits !== null && (
            <Stat icon={<Hash size={12} />} label="Total units" value={compactNumber(j.totalUnits)} />
          )}
          <Stat icon={<User size={12} />} label="Triggered by" value={`${j.triggeredBy} · ${j.triggerSource.toLowerCase()}`} />
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <Card>
          <h3 style={{ marginBottom: 12, color: 'var(--text-1)' }}>
            <Calendar size={13} style={{ verticalAlign: -1, marginRight: 6, color: 'var(--text-2)' }} />
            Timeline
          </h3>
          <div className="timeline">
            <TimelineRow label="Created"     value={<TimeAgo value={j.createdAt} />} />
            <TimelineRow label="Scheduled"   value={<TimeAgo value={j.scheduledFor} />} />
            <TimelineRow label="Started"     value={<TimeAgo value={j.startedAt} />} />
            <TimelineRow label="Completed"   value={<TimeAgo value={j.completedAt} />} />
            <TimelineRow label="Failed"      value={<TimeAgo value={j.failedAt} />} />
            <TimelineRow label="Cancelled"   value={<TimeAgo value={j.cancelledAt} />} />
            <TimelineRow label="Locked until" value={<TimeAgo value={j.lockedUntil} />} />
          </div>
        </Card>

        <Card>
          <h3 style={{ marginBottom: 12, color: 'var(--text-1)' }}>
            <FileText size={13} style={{ verticalAlign: -1, marginRight: 6, color: 'var(--text-2)' }} />
            Configuration
          </h3>
          <div className="timeline">
            <TimelineRow label="Priority" value={String(j.priority)} />
            <TimelineRow label="Max attempts" value={String(j.maxAttempts)} />
            <TimelineRow label="Parent job" value={j.parentJobId ? <Link to={`/jobs/${j.parentJobId}`}>{j.parentJobId.slice(0, 8)}…</Link> : <span className="u-dim">—</span>} />
            <TimelineRow label="Locked by worker" value={j.lockedById ? <code style={{ fontSize: 11 }}>{j.lockedById.slice(0, 8)}…</code> : <span className="u-dim">—</span>} />
          </div>
        </Card>
      </div>

      {j.error && (
        <div style={{ marginTop: 16 }}>
          <Card>
            <h3 style={{ color: 'var(--danger)', marginBottom: 10 }}>
              <AlertTriangle size={13} style={{ verticalAlign: -1, marginRight: 6 }} />Error
            </h3>
            <pre className="json-view" style={{ color: 'var(--danger)' }}>{j.error}</pre>
          </Card>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <Card>
          <h3 style={{ marginBottom: 10 }}>Payload</h3>
          <JsonView value={j.payload} />
        </Card>
      </div>

      {j.result !== null && j.result !== undefined && (
        <div style={{ marginTop: 16 }}>
          <Card>
            <h3 style={{ marginBottom: 10 }}>Result</h3>
            <JsonView value={j.result} />
          </Card>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <Card padded={false}>
          <div className="card-header">
            <h2>Artifacts</h2>
            <span className="u-dim" style={{ fontSize: 12 }}>
              {artifacts.data ? `${artifacts.data.length}` : '…'}
            </span>
          </div>
          {artifacts.loading && !artifacts.data && <SkeletonRows rows={2} />}
          {artifacts.data && artifacts.data.length === 0 && (
            <div style={{ padding: 18, color: 'var(--text-2)', fontSize: 13 }}>No artifacts.</div>
          )}
          {artifacts.data && artifacts.data.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Filename</th>
                  <th>Size</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {artifacts.data.map((a) => (
                  <tr key={a.id}>
                    <td><Badge tone={a.kind === 'ERROR_REPORT' ? 'danger' : 'neutral'}>{a.kind}</Badge></td>
                    <td><code style={{ fontSize: 12, color: 'var(--text-1)' }}>{a.filename}</code></td>
                    <td><span style={{ fontSize: 12 }}>{compactNumber(a.sizeBytes)} bytes</span></td>
                    <td><TimeAgo value={a.createdAt} /></td>
                    <td className="cell-actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        iconLeft={<Download size={14} />}
                        onClick={() => void downloadArtifact(a.id)}
                      >
                        Download
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void onCancel()}
        loading={cancelling}
        options={{
          title: 'Cancel this job?',
          description:
            'If the job is running, the worker will stop at the next chunk boundary. Already-completed work is not rolled back.',
          confirmLabel: 'Cancel job',
          cancelLabel: 'Keep running',
          destructive: true,
        }}
      />
    </div>
  );
};

const BackLink = () => (
  <Link to="/jobs" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-2)', marginBottom: 12 }}>
    <ArrowLeft size={12} /> All jobs
  </Link>
);

const Stat = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) => (
  <div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
      {icon}{label}
    </div>
    <div style={{ fontSize: 14, color: 'var(--text-0)', fontWeight: 500, marginTop: 4 }}>{value}</div>
  </div>
);

const TimelineRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="timeline-row">
    <span className="timeline-label">{label}</span>
    <span className="timeline-value">{value}</span>
  </div>
);
