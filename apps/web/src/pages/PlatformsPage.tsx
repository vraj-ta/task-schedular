import { Plus, RefreshCw, Server, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { api, ApiError } from '../api/client.js';
import type { PlatformConnection } from '../api/types.js';
import { EmptyState, SkeletonRows, TimeAgo } from '../components/data.js';
import { ConfirmDialog, Drawer } from '../components/overlay.js';
import { Badge, Banner, Button, Card, Field, IconButton, Input, Select, Textarea } from '../components/primitives.js';
import { useToast } from '../components/toast.js';
import { useApiQuery } from '../hooks/useApiQuery.js';

export const PlatformsPage = () => {
  const toast = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PlatformConnection | null>(null);
  const [deleting, setDeleting] = useState(false);
  const list = useApiQuery<PlatformConnection[]>(() => api.get('/api/platforms'), []);

  const onCreated = async () => {
    setDrawerOpen(false);
    await list.refresh();
    toast.success('Project registered');
  };

  const onDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/platforms/${deleteTarget.id}`);
      toast.success('Project deleted', `${deleteTarget.projectSlug} removed`);
      setDeleteTarget(null);
      await list.refresh();
    } catch (err) {
      toast.error('Delete failed', err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  const toggle = async (p: PlatformConnection) => {
    try {
      await api.patch(`/api/platforms/${p.id}`, { enabled: !p.enabled });
      await list.refresh();
    } catch (err) {
      toast.error('Update failed', err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header-text">
          <h1>Platforms</h1>
          <div className="page-header-desc">
            Each registered project. The control-plane decrypts its JWT secret to verify forwarded user tokens.
          </div>
        </div>
        <div className="page-header-actions">
          <IconButton label="Refresh" onClick={() => void list.refresh()}>
            <RefreshCw size={14} className={list.loading ? 'animate-spin' : undefined} />
          </IconButton>
          <Button variant="primary" iconLeft={<Plus size={14} />} onClick={() => setDrawerOpen(true)}>
            Register project
          </Button>
        </div>
      </div>

      <Card padded={false}>
        {list.error && <div style={{ padding: 14 }}><Banner tone="error">{list.error.message}</Banner></div>}
        {list.loading && !list.data && <SkeletonRows rows={4} />}
        {list.data && list.data.length === 0 && (
          <EmptyState
            icon={<Server size={20} />}
            title="No projects registered"
            description="Register a project to start enqueueing jobs against it."
            action={<Button variant="primary" iconLeft={<Plus size={14} />} onClick={() => setDrawerOpen(true)}>Register project</Button>}
          />
        )}
        {list.data && list.data.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Base URL</th>
                <th>Target</th>
                <th>Status</th>
                <th>Registered</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <code style={{ color: 'var(--text-0)', fontWeight: 500 }}>{p.projectSlug}</code>
                      <span className="u-muted" style={{ fontSize: 12 }}>{p.name}</span>
                    </div>
                  </td>
                  <td><code style={{ fontSize: 12, color: 'var(--text-2)' }}>{p.baseUrl}</code></td>
                  <td><Badge tone={p.targetType === 'NODE' ? 'accent' : 'warning'}>{p.targetType}</Badge></td>
                  <td>
                    <Badge tone={p.enabled ? 'success' : 'neutral'} dot>
                      {p.enabled ? 'enabled' : 'disabled'}
                    </Badge>
                  </td>
                  <td><TimeAgo value={p.createdAt} /></td>
                  <td className="cell-actions">
                    <Button variant="ghost" size="sm" onClick={() => void toggle(p)}>
                      {p.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <IconButton label="Delete" onClick={() => setDeleteTarget(p)}>
                      <Trash2 size={14} />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Register a project"
      >
        <NewPlatformForm onCreated={onCreated} onCancel={() => setDrawerOpen(false)} />
      </Drawer>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void onDelete()}
        loading={deleting}
        options={{
          title: `Delete project ${deleteTarget?.projectSlug}?`,
          description: 'This cascades to all jobs, schedules, workers and artifacts for the project. Cannot be undone.',
          confirmLabel: 'Delete project',
          destructive: true,
        }}
      />
    </div>
  );
};

const NewPlatformForm = ({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) => {
  const toast = useToast();
  const [projectSlug, setProjectSlug] = useState('');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('http://localhost:3000');
  const [targetType, setTargetType] = useState<'NODE' | 'DOTNET'>('NODE');
  const [jwtSecret, setJwtSecret] = useState('');
  const [credentialsText, setCredentialsText] = useState(
    '{\n  "databaseUrl": "postgresql://user:pass@host:5432/db"\n}',
  );
  const [credentialsError, setCredentialsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    let credentials: unknown;
    try {
      credentials = credentialsText.trim() ? JSON.parse(credentialsText) : undefined;
      setCredentialsError(null);
    } catch (err) {
      setCredentialsError(`Not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/api/platforms', {
        projectSlug, name, baseUrl, targetType, jwtSecret, credentials,
      });
      onCreated();
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.code, err.message);
      else toast.error('Register failed', err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="u-stack">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="projectSlug" required hint="Lowercase kebab-case. Used as X-Project-Id.">
          <Input value={projectSlug} onChange={(e) => setProjectSlug(e.target.value)} required placeholder="acme-prod" />
        </Field>
        <Field label="Display name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Acme (production)" />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <Field label="Base URL" required hint="Project backend the scheduler reaches.">
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} required type="url" />
        </Field>
        <Field label="Target" required>
          <Select value={targetType} onChange={(e) => setTargetType(e.target.value as 'NODE' | 'DOTNET')}>
            <option value="NODE">NODE</option>
            <option value="DOTNET">DOTNET</option>
          </Select>
        </Field>
      </div>
      <Field label="JWT signing secret" required hint="AES-encrypted at rest; never echoed back.">
        <Input type="password" value={jwtSecret} onChange={(e) => setJwtSecret(e.target.value)} required minLength={8} />
      </Field>
      <Field
        label="Credentials JSON"
        error={credentialsError ?? undefined}
        hint={!credentialsError ? 'Set databaseUrl + serviceToken (used by PlatformDriver).' : undefined}
      >
        <Textarea
          value={credentialsText}
          onChange={(e) => setCredentialsText(e.target.value)}
          rows={6}
        />
      </Field>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" loading={submitting}>Register</Button>
      </div>
    </form>
  );
};
