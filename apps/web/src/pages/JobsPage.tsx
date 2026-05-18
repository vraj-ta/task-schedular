import { ClipboardList, Filter, Plus, RefreshCw, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { SCHEDULED_JOB_STATUSES } from '@task-scheduler/shared-types';

import { api } from '../api/client.js';
import type { JobsListResult, PlatformConnection } from '../api/types.js';
import { EmptyState, ProgressBar, SkeletonRows, StatusPill, TimeAgo } from '../components/data.js';
import { Banner, Button, Card, IconButton, Input, Select } from '../components/primitives.js';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { useAutoRefresh } from '../hooks/useAutoRefresh.js';

export const JobsPage = () => {
  const navigate = useNavigate();
  const [projectConnectionId, setProjectConnectionId] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [search, setSearch] = useState<string>('');

  const platforms = useApiQuery<PlatformConnection[]>(() => api.get('/api/platforms'), []);
  const jobs = useApiQuery<JobsListResult>(
    () =>
      api.get('/api/jobs', {
        projectConnectionId: projectConnectionId || undefined,
        status: status || undefined,
        limit: 100,
      }),
    [projectConnectionId, status],
  );

  // Auto-refresh every 4s — pauses when the tab is hidden.
  useAutoRefresh(() => jobs.refresh(), 4_000);

  const filtered = useMemo(() => {
    const items = jobs.data?.items ?? [];
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((j) =>
      j.id.includes(search) ||
      j.type.toLowerCase().includes(q) ||
      (j.entitySlug ?? '').toLowerCase().includes(q) ||
      j.triggeredBy.toLowerCase().includes(q),
    );
  }, [jobs.data, search]);

  return (
    <div>
      <div className="page-header">
        <div className="page-header-text">
          <h1>Jobs</h1>
          <div className="page-header-desc">
            Every job the control-plane has scheduled, claimed, or completed.
          </div>
        </div>
        <div className="page-header-actions">
          <IconButton label="Refresh" onClick={() => void jobs.refresh()}>
            <RefreshCw size={14} className={jobs.loading ? 'animate-spin' : undefined} />
          </IconButton>
          <Link to="/jobs/new">
            <Button variant="primary" iconLeft={<Plus size={14} />}>New job</Button>
          </Link>
        </div>
      </div>

      <div className="toolbar">
        <div style={{ flex: '1 1 240px', minWidth: 200 }}>
          <Input
            placeholder="Search by id, type, entity, trigger…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leadingIcon={<Search size={14} />}
          />
        </div>
        <Select
          value={projectConnectionId}
          onChange={(e) => setProjectConnectionId(e.target.value)}
          style={{ width: 200, flex: '0 0 auto' }}
        >
          <option value="">All projects</option>
          {platforms.data?.map((p) => (
            <option key={p.id} value={p.id}>{p.projectSlug}</option>
          ))}
        </Select>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          style={{ width: 170, flex: '0 0 auto' }}
        >
          <option value="">All statuses</option>
          {SCHEDULED_JOB_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        {(projectConnectionId || status || search) && (
          <Button
            variant="ghost"
            size="sm"
            iconLeft={<Filter size={14} />}
            onClick={() => { setProjectConnectionId(''); setStatus(''); setSearch(''); }}
          >
            Clear
          </Button>
        )}
        <div className="u-grow" />
        <span className="u-dim" style={{ fontSize: 12 }}>
          {jobs.data ? `${filtered.length} of ${jobs.data.items.length}` : ''}
          {jobs.data && ' · auto-refresh 4s'}
        </span>
      </div>

      <Card padded={false}>
        {jobs.error && (
          <div style={{ padding: 16 }}>
            <Banner tone="error">{jobs.error.message}</Banner>
          </div>
        )}
        {jobs.loading && !jobs.data && <SkeletonRows rows={6} />}
        {jobs.data && filtered.length === 0 && (
          <EmptyState
            icon={<ClipboardList size={20} />}
            title={search || projectConnectionId || status ? 'No matches' : 'No jobs yet'}
            description={
              search || projectConnectionId || status
                ? 'Try clearing some filters.'
                : 'Enqueue your first job — it will appear here in real time.'
            }
            action={
              !search && !projectConnectionId && !status ? (
                <Link to="/jobs/new">
                  <Button variant="primary" iconLeft={<Plus size={14} />}>Create job</Button>
                </Link>
              ) : (
                <Button variant="secondary" onClick={() => { setProjectConnectionId(''); setStatus(''); setSearch(''); }}>
                  Clear filters
                </Button>
              )
            }
          />
        )}
        {jobs.data && filtered.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Type</th>
                <th>Project</th>
                <th>Progress</th>
                <th>Triggered by</th>
                <th>Attempts</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((j) => (
                <tr
                  key={j.id}
                  className="clickable"
                  onClick={() => navigate(`/jobs/${j.id}`)}
                >
                  <td><StatusPill status={j.status} /></td>
                  <td><code style={{ color: 'var(--text-1)' }}>{j.type}</code></td>
                  <td>{j.projectSlug}</td>
                  <td style={{ minWidth: 140 }}>
                    {(j.status === 'RUNNING' || j.status === 'CLAIMED')
                      ? <ProgressBar value={j.progress} />
                      : j.status === 'SUCCEEDED'
                        ? <ProgressBar value={100} tone="success" />
                        : (j.status === 'FAILED' || j.status === 'DEAD_LETTER')
                          ? <ProgressBar value={j.progress || 100} tone="danger" />
                          : <span className="u-dim" style={{ fontSize: 12 }}>—</span>}
                  </td>
                  <td>
                    <span style={{ fontSize: 12 }}>{j.triggeredBy}</span>
                    <span className="u-dim" style={{ fontSize: 11, marginLeft: 4 }}>·&nbsp;{j.triggerSource.toLowerCase()}</span>
                  </td>
                  <td>{j.attempts}/{j.maxAttempts}</td>
                  <td><TimeAgo value={j.createdAt} /></td>
                  <td className="cell-actions">
                    <Link to={`/jobs/${j.id}`} onClick={(e) => e.stopPropagation()} style={{ fontSize: 12 }}>open →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
};

