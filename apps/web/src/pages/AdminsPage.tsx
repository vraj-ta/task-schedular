import { Plus, RefreshCw, Trash2, UserPlus, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { api, ApiError } from '../api/client.js';
import type { AdminUser } from '../api/types.js';
import { useAuth } from '../auth/AuthContext.js';
import { EmptyState, SkeletonRows, TimeAgo } from '../components/data.js';
import { ConfirmDialog, Drawer } from '../components/overlay.js';
import { Badge, Banner, Button, Card, Field, IconButton, Input, Select } from '../components/primitives.js';
import { useToast } from '../components/toast.js';
import { useApiQuery } from '../hooks/useApiQuery.js';

export const AdminsPage = () => {
  const { session } = useAuth();
  const toast = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState(false);
  const list = useApiQuery<AdminUser[]>(() => api.get('/api/admin/users'), []);

  const toggle = async (a: AdminUser) => {
    try {
      await api.patch(`/api/admin/users/${a.id}`, { enabled: !a.enabled });
      await list.refresh();
    } catch (err) {
      toast.error('Update failed', err instanceof Error ? err.message : String(err));
    }
  };

  const onDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/admin/users/${deleteTarget.id}`);
      toast.success('Admin deleted', deleteTarget.email);
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
          <h1>Admins</h1>
          <div className="page-header-desc">
            Operators authorized to sign in to this console. Service scripts use the static
            <code> SCHEDULER_ADMIN_API_KEY</code>.
          </div>
        </div>
        <div className="page-header-actions">
          <IconButton label="Refresh" onClick={() => void list.refresh()}>
            <RefreshCw size={14} className={list.loading ? 'animate-spin' : undefined} />
          </IconButton>
          <Button variant="primary" iconLeft={<UserPlus size={14} />} onClick={() => setDrawerOpen(true)}>
            Add admin
          </Button>
        </div>
      </div>

      <Card padded={false}>
        {list.error && <div style={{ padding: 14 }}><Banner tone="error">{list.error.message}</Banner></div>}
        {list.loading && !list.data && <SkeletonRows rows={3} />}
        {list.data && list.data.length === 0 && (
          <EmptyState
            icon={<Users size={20} />}
            title="No admins"
            description="Add a teammate to the operator console."
            action={<Button variant="primary" iconLeft={<Plus size={14} />} onClick={() => setDrawerOpen(true)}>Add admin</Button>}
          />
        )}
        {list.data && list.data.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last login</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((a) => {
                const isSelf = a.id === session?.admin.id;
                return (
                  <tr key={a.id}>
                    <td>
                      <span style={{ color: 'var(--text-0)' }}>{a.email}</span>
                      {isSelf && <Badge tone="accent" >&nbsp;you</Badge>}
                    </td>
                    <td>{a.displayName}</td>
                    <td><Badge tone={a.role === 'ADMIN' ? 'accent' : 'neutral'}>{a.role}</Badge></td>
                    <td>
                      <Badge tone={a.enabled ? 'success' : 'neutral'} dot>
                        {a.enabled ? 'enabled' : 'disabled'}
                      </Badge>
                    </td>
                    <td><TimeAgo value={a.lastLoginAt} /></td>
                    <td className="cell-actions">
                      <Button variant="ghost" size="sm" disabled={isSelf} onClick={() => void toggle(a)}>
                        {a.enabled ? 'Disable' : 'Enable'}
                      </Button>
                      <IconButton label="Delete" disabled={isSelf} onClick={() => setDeleteTarget(a)}>
                        <Trash2 size={14} />
                      </IconButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Add admin"
      >
        <NewAdminForm
          onCreated={async () => {
            setDrawerOpen(false);
            await list.refresh();
            toast.success('Admin added');
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
          title: `Delete admin ${deleteTarget?.email}?`,
          description: 'They lose access immediately. Active sessions remain valid until their refresh token expires.',
          confirmLabel: 'Delete admin',
          destructive: true,
        }}
      />
    </div>
  );
};

const NewAdminForm = ({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) => {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'VIEWER'>('ADMIN');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/api/admin/users', { email, displayName, password, role });
      onCreated();
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.code, err.message);
      else toast.error('Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="u-stack">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Email" required>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Display name" required>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Password" required hint="Min 8 characters.">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </Field>
        <Field label="Role" required>
          <Select value={role} onChange={(e) => setRole(e.target.value as 'ADMIN' | 'VIEWER')}>
            <option value="ADMIN">ADMIN</option>
            <option value="VIEWER">VIEWER</option>
          </Select>
        </Field>
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" loading={submitting}>Add admin</Button>
      </div>
    </form>
  );
};
