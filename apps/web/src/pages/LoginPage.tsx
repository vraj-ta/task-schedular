import { Lock, Mail, Zap } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext.js';
import { Banner, Button, Field, Input } from '../components/primitives.js';

export const LoginPage = () => {
  const { login, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  return (
    <div className="login-shell">
      <form onSubmit={onSubmit} className="login-card">
        <div className="login-brand">
          <div className="sidebar-brand-mark"><Zap size={16} /></div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-0)' }}>Task Scheduler</div>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Operator console</div>
          </div>
        </div>

        <h1 style={{ marginBottom: 6 }}>Sign in</h1>
        <p style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 22 }}>
          Use the admin credentials provisioned by the bootstrap script.
        </p>

        {error && (
          <div style={{ marginBottom: 16 }}>
            <Banner tone="error">{error}</Banner>
          </div>
        )}

        <div className="u-stack" style={{ marginBottom: 22 }}>
          <Field label="Email" required>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              leadingIcon={<Mail size={14} />}
              required
            />
          </Field>
          <Field label="Password" required>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              leadingIcon={<Lock size={14} />}
              required
            />
          </Field>
        </div>

        <Button type="submit" variant="primary" block loading={loading}>
          Sign in
        </Button>

        <p style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 18, lineHeight: 1.6 }}>
          Bootstrap the first admin from the api workspace:<br />
          <code style={{ color: 'var(--text-2)' }}>
            npm run bootstrap-admin --workspace=@task-scheduler/api
          </code>
        </p>
      </form>
    </div>
  );
};
