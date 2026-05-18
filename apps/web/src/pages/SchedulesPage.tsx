import { Calendar, Check, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { SCHEDULED_JOB_TYPES, type ScheduledJobType } from '@task-scheduler/shared-types';

import { api, ApiError } from '../api/client.js';
import type { PlatformConnection, RecurringSchedule } from '../api/types.js';
import { EmptyState, SkeletonRows, TimeAgo } from '../components/data.js';
import { ConfirmDialog, Drawer } from '../components/overlay.js';
import { Badge, Banner, Button, Card, Field, IconButton, Input, Select, Textarea } from '../components/primitives.js';
import { useToast } from '../components/toast.js';
import { useApiQuery } from '../hooks/useApiQuery.js';

export const SchedulesPage = () => {
  const toast = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RecurringSchedule | null>(null);
  const [deleting, setDeleting] = useState(false);

  const platforms = useApiQuery<PlatformConnection[]>(() => api.get('/api/platforms'), []);
  const list = useApiQuery<RecurringSchedule[]>(() => api.get('/api/schedules'), []);

  const toggle = async (s: RecurringSchedule) => {
    try {
      await api.patch(`/api/schedules/${s.id}`, { enabled: !s.enabled });
      await list.refresh();
    } catch (err) {
      toast.error('Update failed', err instanceof Error ? err.message : String(err));
    }
  };

  const onDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/schedules/${deleteTarget.id}`);
      toast.success('Schedule deleted', deleteTarget.name);
      setDeleteTarget(null);
      await list.refresh();
    } catch (err) {
      toast.error('Delete failed', err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header-text">
          <h1>Schedules</h1>
          <div className="page-header-desc">Cron-driven enqueue rules. Each tick enqueues a fresh job.</div>
        </div>
        <div className="page-header-actions">
          <IconButton label="Refresh" onClick={() => void list.refresh()}>
            <RefreshCw size={14} className={list.loading ? 'animate-spin' : undefined} />
          </IconButton>
          <Button variant="primary" iconLeft={<Plus size={14} />} onClick={() => setDrawerOpen(true)}>
            New schedule
          </Button>
        </div>
      </div>

      <Card padded={false}>
        {list.error && <div style={{ padding: 14 }}><Banner tone="error">{list.error.message}</Banner></div>}
        {list.loading && !list.data && <SkeletonRows rows={4} />}
        {list.data && list.data.length === 0 && (
          <EmptyState
            icon={<Calendar size={20} />}
            title="No schedules yet"
            description="Add a cron rule to enqueue recurring jobs automatically."
            action={<Button variant="primary" iconLeft={<Plus size={14} />} onClick={() => setDrawerOpen(true)}>New schedule</Button>}
          />
        )}
        {list.data && list.data.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Cron</th>
                <th>Next run</th>
                <th>Last run</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div style={{ fontWeight: 500, color: 'var(--text-0)' }}>{s.name}</div>
                    <div className="u-muted" style={{ fontSize: 11 }}>{s.timezone} · {s.overlapPolicy.toLowerCase()}</div>
                  </td>
                  <td><code style={{ color: 'var(--text-1)' }}>{s.type}</code></td>
                  <td><code style={{ fontSize: 12, color: 'var(--text-2)' }}>{s.cronExpression}</code></td>
                  <td><TimeAgo value={s.nextRunAt} /></td>
                  <td><TimeAgo value={s.lastRunAt} /></td>
                  <td>
                    <Badge tone={s.enabled ? 'success' : 'neutral'} dot>
                      {s.enabled ? 'enabled' : 'disabled'}
                    </Badge>
                  </td>
                  <td className="cell-actions">
                    <Button variant="ghost" size="sm" onClick={() => void toggle(s)}>
                      {s.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <IconButton label="Delete" onClick={() => setDeleteTarget(s)}>
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
        title="New schedule"
      >
        <NewScheduleForm
          platforms={platforms.data ?? []}
          onCreated={async () => {
            setDrawerOpen(false);
            await list.refresh();
            toast.success('Schedule created');
          }}
          onCancel={() => setDrawerOpen(false)}
        />
      </Drawer>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void onDelete()}
        loading={deleting}
        options={{
          title: `Delete '${deleteTarget?.name}'?`,
          description: 'The schedule stops firing immediately. Jobs already enqueued by it continue to run.',
          confirmLabel: 'Delete schedule',
          destructive: true,
        }}
      />
    </div>
  );
};

const NewScheduleForm = ({
  platforms,
  onCreated,
  onCancel,
}: {
  platforms: PlatformConnection[];
  onCreated: () => void;
  onCancel: () => void;
}) => {
  const toast = useToast();
  const [projectConnectionId, setProjectConnectionId] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<ScheduledJobType>('SYSTEM_CLEANUP_JOBS');
  const [cronExpression, setCronExpression] = useState('0 3 * * *');
  const [timezone, setTimezone] = useState('UTC');
  const [overlapPolicy, setOverlapPolicy] = useState<'SKIP' | 'QUEUE' | 'CANCEL_PREV'>('SKIP');
  const [payloadText, setPayloadText] = useState('{}');
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const [validation, setValidation] = useState<{ ok: boolean; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const validate = async () => {
    setValidation(null);
    try {
      const result = await api.post<{ valid: boolean; nextRunAt?: string; error?: string }>(
        '/api/schedules/validate-cron',
        { cronExpression, timezone },
      );
      if (result.valid) setValidation({ ok: true, text: `Next fire: ${new Date(result.nextRunAt!).toLocaleString()}` });
      else setValidation({ ok: false, text: result.error ?? 'invalid' });
    } catch (err) {
      setValidation({ ok: false, text: err instanceof Error ? err.message : 'failed' });
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    let payload: unknown;
    try {
      payload = payloadText.trim() ? JSON.parse(payloadText) : {};
      setPayloadError(null);
    } catch (err) {
      setPayloadError(`Not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/api/schedules', {
        projectConnectionId, name, type, cronExpression, timezone, overlapPolicy, payload,
      });
      onCreated();
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.code, err.message);
      else toast.error('Create failed', err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="u-stack">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Project" required>
          <Select value={projectConnectionId} onChange={(e) => setProjectConnectionId(e.target.value)} required>
            <option value="">— select —</option>
            {platforms.map((p) => <option key={p.id} value={p.id}>{p.projectSlug}</option>)}
          </Select>
        </Field>
        <Field label="Name" required hint="Unique per project.">
          <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="nightly-cleanup" />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Job type" required>
          <Select value={type} onChange={(e) => setType(e.target.value as ScheduledJobType)}>
            {SCHEDULED_JOB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Overlap policy" hint="What happens if a previous run is still active.">
          <Select value={overlapPolicy} onChange={(e) => setOverlapPolicy(e.target.value as 'SKIP' | 'QUEUE' | 'CANCEL_PREV')}>
            <option value="SKIP">SKIP</option>
            <option value="QUEUE">QUEUE</option>
            <option value="CANCEL_PREV">CANCEL_PREV</option>
          </Select>
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <Field label="Cron expression" required>
          <Input value={cronExpression} onChange={(e) => setCronExpression(e.target.value)} required />
        </Field>
        <Field label="Timezone" required>
          <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} required />
        </Field>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: -4 }}>
        <Button type="button" variant="secondary" size="sm" iconLeft={<Check size={13} />} onClick={() => void validate()}>
          Validate cron
        </Button>
        {validation && (
          <span style={{ fontSize: 12, color: validation.ok ? 'var(--success)' : 'var(--danger)' }}>
            {validation.text}
          </span>
        )}
      </div>

      <Field label="Payload" error={payloadError ?? undefined} hint={!payloadError ? 'Valid JSON — runner-specific.' : undefined}>
        <Textarea value={payloadText} onChange={(e) => setPayloadText(e.target.value)} rows={8} />
      </Field>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" loading={submitting}>Create</Button>
      </div>
    </form>
  );
};
