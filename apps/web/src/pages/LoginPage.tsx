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
          <div className="sidebar-brand-mark" style={{ width: 42, height: 42 }}><Zap size={20} /></div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-0)', letterSpacing: '-0.012em' }}>Task Scheduler</div>
            <div style={{ fontSize: 12, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>
              Operator console
            </div>
          </div>
        </div>

        <h1 style={{ marginBottom: 8, fontSize: 28 }}>Welcome back</h1>
        <p style={{ color: 'var(--text-2)', fontSize: 14, marginBottom: 28, lineHeight: 1.6 }}>
          Sign in with the admin credentials provisioned by the bootstrap script.
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

        <Button type="submit" variant="primary" size="lg" block loading={loading}>
          Sign in
        </Button>

        <div
          style={{
            marginTop: 24,
            padding: '14px 16px',
            background: 'var(--bg-2)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-3)',
            fontSize: 12,
            color: 'var(--text-2)',
            lineHeight: 1.6,
          }}
        >
          <strong style={{ color: 'var(--text-1)', fontWeight: 600 }}>First time here?</strong>
          {' '}Bootstrap the initial admin from the api workspace:<br />
          <code style={{ color: 'var(--text-1)', fontSize: 11.5 }}>
            npm run bootstrap-admin --workspace=@task-scheduler/api
          </code>
        </div>
      </form>
    </div>
  );
};
