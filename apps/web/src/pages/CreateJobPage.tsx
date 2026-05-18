import { AlertTriangle, ArrowLeft, Zap } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { SCHEDULED_JOB_TYPES, type ScheduledJobType } from '@task-scheduler/shared-types';

import { api, ApiError } from '../api/client.js';
import type { PlatformConnection } from '../api/types.js';
import { Banner, Button, Card, Field, Input, Select, Textarea } from '../components/primitives.js';
import { useToast } from '../components/toast.js';
import { useApiQuery } from '../hooks/useApiQuery.js';

const PAYLOAD_TEMPLATES: Record<ScheduledJobType, unknown> = {
  BULK_IMPORT: {
    inputArtifactId: '<uuid of uploaded INPUT artifact>',
    mapping: { csvColumn: 'entityField' },
    upsertKey: '',
    dryRun: false,
    onRowError: 'skip',
    chunkSize: 500,
    maxRowsPerJob: 100_000,
  },
  BULK_UPDATE: { filter: {}, patch: {} },
  BULK_DELETE: { filter: {}, hard: false },
  BULK_EXPORT: { filter: {}, columns: [], format: 'csv' },
  SCHEDULED_ACTION: { actionSlug: 'my-action', params: {} },
  SYSTEM_CLEANUP_TOKENS: { retentionDays: 0 },
  SYSTEM_CLEANUP_AUDIT: { retentionDays: 365 },
  SYSTEM_CLEANUP_UPLOADS: { olderThanMinutes: 60 },
  SYSTEM_CLEANUP_JOBS: { retentionDays: 30 },
  WEBHOOK_DELIVERY: { url: 'https://...', payload: {} },
  EMAIL_BLAST: { templateId: '', recipients: [] },
  REPORT_GENERATION: { reportSlug: '', filter: {} },
  EXTERNAL_SYNC: { systemSlug: '', cursor: null },
};

const PROJECT_DB_TYPES = new Set<ScheduledJobType>([
  'BULK_IMPORT', 'BULK_UPDATE', 'BULK_DELETE', 'BULK_EXPORT',
  'SCHEDULED_ACTION',
  'SYSTEM_CLEANUP_TOKENS', 'SYSTEM_CLEANUP_AUDIT', 'SYSTEM_CLEANUP_UPLOADS',
]);

export const CreateJobPage = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const platforms = useApiQuery<PlatformConnection[]>(() => api.get('/api/platforms'), []);
  const [projectConnectionId, setProjectConnectionId] = useState('');
  const [type, setType] = useState<ScheduledJobType>('SYSTEM_CLEANUP_JOBS');
  const [entitySlug, setEntitySlug] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [priority, setPriority] = useState(0);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [payloadText, setPayloadText] = useState<string>(
    JSON.stringify(PAYLOAD_TEMPLATES.SYSTEM_CLEANUP_JOBS, null, 2),
  );
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isProjectDbType = useMemo(() => PROJECT_DB_TYPES.has(type), [type]);

  const onTypeChange = (newType: ScheduledJobType) => {
    setType(newType);
    setPayloadText(JSON.stringify(PAYLOAD_TEMPLATES[newType] ?? {}, null, 2));
    setPayloadError(null);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    let payload: unknown;
    try {
      payload = payloadText.trim() ? JSON.parse(payloadText) : {};
      setPayloadError(null);
    } catch (err) {
      setPayloadError(`Payload is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.post<{ id: string }>('/api/jobs', {
        projectConnectionId,
        type,
        entitySlug: entitySlug || undefined,
        payload,
        scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
        priority,
        maxAttempts,
      });
      toast.success('Job enqueued', `id ${result.id.slice(0, 8)}…`);
      navigate(`/jobs/${result.id}`);
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.code, err.message);
      else toast.error('Failed to create job', err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <Link to="/jobs" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-2)', marginBottom: 12 }}>
        <ArrowLeft size={12} /> All jobs
      </Link>

      <div className="page-header">
        <div className="page-header-text">
          <h1>Create job</h1>
          <div className="page-header-desc">
            Enqueue a one-off job. For recurring work, create a Schedule instead.
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 18 }}>
        <Card>
          <form onSubmit={onSubmit} className="u-stack">
            <Field label="Project" required>
              <Select
                value={projectConnectionId}
                onChange={(e) => setProjectConnectionId(e.target.value)}
                required
              >
                <option value="">— select a registered project —</option>
                {platforms.data?.map((p) => (
                  <option key={p.id} value={p.id}>{p.projectSlug} · {p.name}</option>
                ))}
              </Select>
            </Field>

            <Field
              label="Job type"
              hint={isProjectDbType
                ? "This runner needs PlatformConnection.credentials.databaseUrl set."
                : 'Operates on the control-plane DB; no project credentials required.'}
            >
              <Select value={type} onChange={(e) => onTypeChange(e.target.value as ScheduledJobType)}>
                {SCHEDULED_JOB_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Entity slug (optional)">
                <Input
                  value={entitySlug}
                  onChange={(e) => setEntitySlug(e.target.value)}
                  placeholder="customer"
                />
              </Field>
              <Field label="Scheduled for (optional)" hint="Defaults to now.">
                <Input
                  type="datetime-local"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                />
              </Field>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Priority" hint="Higher = picked first. Default 0.">
                <Input
                  type="number"
                  value={priority}
                  onChange={(e) => setPriority(parseInt(e.target.value, 10) || 0)}
                  min={-100}
                  max={100}
                />
              </Field>
              <Field label="Max attempts">
                <Input
                  type="number"
                  value={maxAttempts}
                  onChange={(e) => setMaxAttempts(parseInt(e.target.value, 10) || 1)}
                  min={1}
                  max={50}
                />
              </Field>
            </div>

            <Field label="Payload" error={payloadError ?? undefined} hint={!payloadError ? 'Valid JSON. Runner-specific shape.' : undefined}>
              <Textarea
                value={payloadText}
                onChange={(e) => setPayloadText(e.target.value)}
                rows={14}
              />
            </Field>

            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <Button
                type="submit"
                variant="primary"
                iconLeft={<Zap size={14} />}
                loading={submitting}
                disabled={!projectConnectionId}
              >
                Enqueue job
              </Button>
              <Button type="button" variant="ghost" onClick={() => navigate('/jobs')}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>

        <div className="u-stack">
          <Card>
            <h3 style={{ marginBottom: 8 }}>About {type}</h3>
            <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6, margin: 0 }}>
              {getTypeBlurb(type)}
            </p>
          </Card>

          {isProjectDbType && (
            <Banner tone="warning" icon={<AlertTriangle size={14} />}>
              <strong style={{ display: 'block', marginBottom: 4 }}>Project DB required</strong>
              <span style={{ fontSize: 12 }}>
                Make sure the selected platform's <code>credentials.databaseUrl</code> is set; otherwise the runner fails immediately.
              </span>
            </Banner>
          )}

          {platforms.data && platforms.data.length === 0 && (
            <Banner tone="error">
              No projects registered. <Link to="/platforms">Add one →</Link>
            </Banner>
          )}
        </div>
      </div>
    </div>
  );
};

const getTypeBlurb = (type: ScheduledJobType): string => {
  switch (type) {
    case 'BULK_IMPORT': return 'Stream CSV/XLSX into chunked entity inserts. Requires per-project worker (Phase 2 — currently fails cleanly).';
    case 'BULK_UPDATE': return 'Apply a Prisma-style patch to every row matching the filter. Phase 2.';
    case 'BULK_DELETE': return 'Soft- or hard-delete rows matching the filter. Phase 2.';
    case 'BULK_EXPORT': return 'Stream a dataset to CSV/XLSX/PDF and emit a signed-URL artifact. Phase 2.';
    case 'SCHEDULED_ACTION':
      return 'Forward an ActionDefinition invocation to the project backend via PlatformDriver. Needs credentials.serviceToken.';
    case 'SYSTEM_CLEANUP_JOBS':
      return 'Purge old terminal ScheduledJob rows from the control-plane DB. Fully functional today.';
    case 'SYSTEM_CLEANUP_TOKENS':
      return 'Delete expired RefreshToken / Session rows in the project DB.';
    case 'SYSTEM_CLEANUP_AUDIT':
      return 'Delete AuditLog rows older than retentionDays in the project DB.';
    case 'SYSTEM_CLEANUP_UPLOADS':
      return 'Sweep StagedUpload rows that were never committed.';
    case 'WEBHOOK_DELIVERY':
    case 'EMAIL_BLAST':
    case 'REPORT_GENERATION':
    case 'EXTERNAL_SYNC':
      return 'Phase 2 runner — schema is in place but the runner is not implemented yet.';
  }
};
