import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { Spinner } from '../components/Feedback.jsx';
import { Field } from '../components/Field.jsx';
import { BrandMark } from '../components/shell/AppShell.jsx';

const DEMO_ACCOUNTS = [
  { label: 'Admin', email: 'admin@demo.test', password: 'admin123' },
  { label: 'Agent', email: 'priya@demo.test', password: 'agent123' },
];

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      navigate(location.state?.from?.pathname || '/', { replace: true });
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <form className="card login-card" onSubmit={handleSubmit} noValidate>
        <div className="login-brand">
          <BrandMark size={40} />
          <div>
            <h1>Comhord</h1>
            <p className="muted">Sign in to your support workspace</p>
          </div>
        </div>

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        <Field label="Email" htmlFor="email">
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="password">
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
          {submitting ? <Spinner small /> : null} {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <div className="demo-accounts">
          <span className="muted">Demo accounts:</span>
          {DEMO_ACCOUNTS.map((a) => (
            <button
              key={a.email}
              type="button"
              className="btn btn-small"
              onClick={() => {
                setEmail(a.email);
                setPassword(a.password);
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}
