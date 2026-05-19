import { Check, Copy, KeyRound, Plus, RefreshCw, Server, Sparkles, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { api, ApiError } from '../api/client.js';
import type { PlatformConnection } from '../api/types.js';
import { EmptyState, SkeletonRows, TimeAgo } from '../components/data.js';
import { ConfirmDialog, Drawer, Modal } from '../components/overlay.js';
import { Badge, Banner, Button, Card, Field, IconButton, Input, Select, Textarea } from '../components/primitives.js';
import { useToast } from '../components/toast.js';
import { useApiQuery } from '../hooks/useApiQuery.js';

/// Response shape when the API mints or rotates a JWT secret — same as a
/// PlatformConnection summary plus the plaintext secret (shown once).
type PlatformWithSecret = PlatformConnection & { jwtSecret: string };

export const PlatformsPage = () => {
  const toast = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PlatformConnection | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [rotateTarget, setRotateTarget] = useState<PlatformConnection | null>(null);
  const [rotating, setRotating] = useState(false);
  const [reveal, setReveal] = useState<
    | {
        id: string;
        slug: string;
        name: string;
        secret: string;
        mode: 'created' | 'rotated';
      }
    | null
  >(null);
  const list = useApiQuery<PlatformConnection[]>(() => api.get('/api/platforms'), []);

  const onCreated = async (result: PlatformWithSecret) => {
    setDrawerOpen(false);
    await list.refresh();
    setReveal({
      id: result.id,
      slug: result.projectSlug,
      name: result.name,
      secret: result.jwtSecret,
      mode: 'created',
    });
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

  const onRotate = async () => {
    if (!rotateTarget) return;
    setRotating(true);
    try {
      const result = await api.post<PlatformWithSecret>(
        `/api/platforms/${rotateTarget.id}/rotate-jwt-secret`,
        {},
      );
      setRotateTarget(null);
      await list.refresh();
      setReveal({
        id: result.id,
        slug: result.projectSlug,
        name: result.name,
        secret: result.jwtSecret,
        mode: 'rotated',
      });
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.code, err.message);
      else toast.error('Rotate failed', err instanceof Error ? err.message : String(err));
    } finally {
      setRotating(false);
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
                    <IconButton label="Rotate JWT secret" onClick={() => setRotateTarget(p)}>
                      <KeyRound size={14} />
                    </IconButton>
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

      <ConfirmDialog
        open={!!rotateTarget}
        onClose={() => setRotateTarget(null)}
        onConfirm={() => void onRotate()}
        loading={rotating}
        options={{
          title: `Rotate JWT secret for ${rotateTarget?.projectSlug}?`,
          description:
            'A new secret is minted server-side and shown once. The previous secret stops working immediately — the project\'s admin-backend must be updated with the new value before it can call the scheduler again.',
          confirmLabel: 'Rotate secret',
          destructive: true,
        }}
      />

      <SecretRevealModal
        open={!!reveal}
        id={reveal?.id ?? ''}
        slug={reveal?.slug ?? ''}
        name={reveal?.name ?? ''}
        secret={reveal?.secret ?? ''}
        mode={reveal?.mode ?? 'created'}
        onClose={() => setReveal(null)}
      />
    </div>
  );
};

const NewPlatformForm = ({
  onCreated,
  onCancel,
}: {
  onCreated: (result: PlatformWithSecret) => void;
  onCancel: () => void;
}) => {
  const toast = useToast();
  const [projectSlug, setProjectSlug] = useState('');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('http://localhost:3000');
  const [targetType, setTargetType] = useState<'NODE' | 'DOTNET'>('NODE');
  const [secretMode, setSecretMode] = useState<'generate' | 'paste'>('generate');
  // 32 random bytes → 64 hex chars. Browser crypto is the same strength as
  // server-side `crypto.randomBytes` — fine to mint here so the operator can
  // see and copy the secret before submitting.
  const mintSecret = (): string => {
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  };
  const [jwtSecret, setJwtSecret] = useState<string>(() => mintSecret());
  const [secretCopied, setSecretCopied] = useState(false);

  const onClickGenerate = () => {
    setSecretMode('generate');
    setJwtSecret(mintSecret());
    setSecretCopied(false);
  };

  /// Single .env line the operator can paste directly into the project's
  /// admin-backend config. The value is the same JWT secret the API will
  /// store encrypted after Register.
  const envLine = `SCHEDULER_JWT_SECRET="${jwtSecret}"`;

  const onCopySecret = async () => {
    try {
      await navigator.clipboard.writeText(envLine);
      setSecretCopied(true);
      window.setTimeout(() => setSecretCopied(false), 1500);
    } catch {
      // Clipboard blocked — user can still select manually.
    }
  };
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
      const result = await api.post<PlatformWithSecret>('/api/platforms', {
        projectSlug,
        name,
        baseUrl,
        targetType,
        jwtSecret,
        credentials,
      });
      onCreated(result);
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

      <Field
        label="JWT signing secret"
        hint={
          secretMode === 'generate'
            ? 'Click Generate to mint a new one. The same value will be encrypted at rest after you Register.'
            : 'AES-encrypted at rest; never echoed back after this submit.'
        }
      >
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <Button
            type="button"
            size="sm"
            variant={secretMode === 'generate' ? 'primary' : 'ghost'}
            iconLeft={<Sparkles size={12} />}
            onClick={onClickGenerate}
          >
            {secretMode === 'generate' ? 'Regenerate' : 'Generate'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={secretMode === 'paste' ? 'primary' : 'ghost'}
            onClick={() => setSecretMode('paste')}
          >
            Use existing
          </Button>
        </div>
        {secretMode === 'generate' ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '10px 12px',
              background: 'var(--bg-1)',
              border: '1px solid var(--border-1)',
              borderRadius: 6,
            }}
          >
            <code
              style={{
                flex: 1,
                fontSize: 12,
                color: 'var(--text-0)',
                wordBreak: 'break-all',
                userSelect: 'all',
                lineHeight: 1.5,
              }}
            >
              <span style={{ color: 'var(--text-2)' }}># Paste into the project&apos;s .env</span>
              <br />
              {envLine}
            </code>
            <IconButton label={secretCopied ? 'Copied' : 'Copy .env line'} onClick={() => void onCopySecret()}>
              {secretCopied ? <Check size={14} /> : <Copy size={14} />}
            </IconButton>
          </div>
        ) : (
          <Input
            type="password"
            value={jwtSecret}
            onChange={(e) => setJwtSecret(e.target.value)}
            required
            minLength={8}
            placeholder="Paste the project's existing JWT secret"
          />
        )}
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

/// Single label+value row with an inline copy button. Mirrors the Google AI
/// Studio "API key details" layout — one row per fact about the resource.
const CopyableRow = ({ label, value, mono }: { label: string; value: string; mono?: boolean }) => {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API blocked (non-secure context); user can select manually.
    }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-1)' }}>{label}</div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          background: 'var(--bg-1)',
          border: '1px solid var(--border-1)',
          borderRadius: 6,
        }}
      >
        <span
          style={{
            flex: 1,
            fontFamily: mono ? 'var(--font-mono, monospace)' : 'inherit',
            fontSize: mono ? 12 : 13,
            color: 'var(--text-0)',
            wordBreak: 'break-all',
            userSelect: 'all',
          }}
        >
          {value}
        </span>
        <IconButton label={copied ? 'Copied' : 'Copy'} onClick={() => void onCopy()}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </IconButton>
      </div>
    </div>
  );
};

const SecretRevealModal = ({
  open,
  id,
  slug,
  name,
  secret,
  mode,
  onClose,
}: {
  open: boolean;
  id: string;
  slug: string;
  name: string;
  secret: string;
  mode: 'created' | 'rotated';
  onClose: () => void;
}) => {
  const [copiedAll, setCopiedAll] = useState(false);
  /// Full .env block ready to paste into the project's admin-backend config.
  const envBlock =
    `# task-scheduler — paste into the project's .env\n` +
    `SCHEDULER_PROJECT_SLUG="${slug}"\n` +
    `SCHEDULER_JWT_SECRET="${secret}"`;

  const onCopyEnv = async () => {
    try {
      await navigator.clipboard.writeText(envBlock);
      setCopiedAll(true);
      window.setTimeout(() => setCopiedAll(false), 1500);
    } catch {
      // Ignored — clipboard blocked.
    }
  };

  const onCloseLocal = () => {
    setCopiedAll(false);
    onClose();
  };

  const title = mode === 'created' ? 'Project key details' : 'Rotated key details';

  return (
    <Modal
      open={open}
      onClose={onCloseLocal}
      title={title}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onCloseLocal}>Done</Button>
          <Button
            variant="primary"
            iconLeft={copiedAll ? <Check size={14} /> : <Copy size={14} />}
            onClick={() => void onCopyEnv()}
          >
            {copiedAll ? 'Copied .env block' : 'Copy .env block'}
          </Button>
        </>
      }
    >
      <div className="u-stack">
        <Banner tone="warning">
          This is the only time the secret will be shown. Paste the .env block into the
          project&apos;s admin-backend config. If you lose it, rotate to mint a new one.
        </Banner>

        <Field label=".env (paste into the project)">
          <pre
            style={{
              margin: 0,
              padding: '10px 12px',
              background: 'var(--bg-1)',
              border: '1px solid var(--border-1)',
              borderRadius: 6,
              fontSize: 12,
              color: 'var(--text-0)',
              lineHeight: 1.5,
              userSelect: 'all',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              overflowX: 'auto',
            }}
          >
            <span style={{ color: 'var(--text-2)' }}># task-scheduler — paste into the project&apos;s .env</span>{'\n'}
            SCHEDULER_PROJECT_SLUG=&quot;{slug}&quot;{'\n'}
            SCHEDULER_JWT_SECRET=&quot;{secret}&quot;
          </pre>
        </Field>

        <CopyableRow label="Project name" value={name} />
        <CopyableRow label="Project ID" value={id} mono />

        {mode === 'rotated' && (
          <Banner tone="info">
            The previous secret is no longer valid. Update the project&apos;s admin-backend
            configuration with this new value before it next calls the scheduler.
          </Banner>
        )}
      </div>
    </Modal>
  );
};
