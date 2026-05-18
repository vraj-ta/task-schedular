import { Cpu, RefreshCw } from 'lucide-react';

import { api } from '../api/client.js';
import type { WorkerRecord } from '../api/types.js';
import { EmptyState, SkeletonRows, TimeAgo } from '../components/data.js';
import { Badge, Banner, Card, IconButton } from '../components/primitives.js';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { useAutoRefresh } from '../hooks/useAutoRefresh.js';

const isFresh = (lastSeenAt: string): boolean =>
  Date.now() - new Date(lastSeenAt).getTime() < 60_000;

export const WorkersPage = () => {
  const workers = useApiQuery<WorkerRecord[]>(() => api.get('/api/workers'), []);
  useAutoRefresh(() => workers.refresh(), 10_000);

  return (
    <div>
      <div className="page-header">
        <div className="page-header-text">
          <h1>Workers</h1>
          <div className="page-header-desc">
            Worker processes registered with the control-plane. The in-process worker
            appears as <code>workerId="in-process"</code> per active project.
          </div>
        </div>
        <div className="page-header-actions">
          <IconButton label="Refresh" onClick={() => void workers.refresh()}>
            <RefreshCw size={14} className={workers.loading ? 'animate-spin' : undefined} />
          </IconButton>
        </div>
      </div>

      <Card padded={false}>
        {workers.error && <div style={{ padding: 14 }}><Banner tone="error">{workers.error.message}</Banner></div>}
        {workers.loading && !workers.data && <SkeletonRows rows={4} />}
        {workers.data && workers.data.length === 0 && (
          <EmptyState
            icon={<Cpu size={20} />}
            title="No workers registered"
            description="Workers appear here once they call POST /api/dispatch/register, or as soon as the in-process worker has a project to serve."
          />
        )}
        {workers.data && workers.data.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Worker</th>
                <th>Project</th>
                <th>Capabilities</th>
                <th>Health</th>
                <th>Last seen</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {workers.data.map((w) => {
                const fresh = isFresh(w.lastSeenAt);
                return (
                  <tr key={w.id}>
                    <td>
                      <div style={{ fontWeight: 500, color: 'var(--text-0)' }}>
                        <code>{w.workerId}</code>
                      </div>
                      <div className="u-muted" style={{ fontSize: 11 }}>{w.id.slice(0, 8)}…</div>
                    </td>
                    <td>{w.projectSlug}</td>
                    <td className="u-muted" style={{ fontSize: 12 }}>
                      {w.capabilities.length} job types
                    </td>
                    <td>
                      <Badge tone={fresh ? 'success' : 'warning'} dot>
                        {fresh ? 'live' : 'stale'}
                      </Badge>
                    </td>
                    <td><TimeAgo value={w.lastSeenAt} /></td>
                    <td>
                      <Badge tone={w.enabled ? 'success' : 'neutral'}>
                        {w.enabled ? 'enabled' : 'disabled'}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
};
