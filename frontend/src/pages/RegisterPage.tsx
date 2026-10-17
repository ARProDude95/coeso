import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, register } from '../api';
import { saveSession } from '../session';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Registration creates a user only; the workspace is a separate step.
      const auth = await register(email.trim(), password, displayName.trim());
      saveSession(auth.token, auth.user);
      navigate('/workspaces');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <span className="aside-brand">Roster</span>
        <div>
          <h2>Bring your team onto one roster.</h2>
          <p className="aside-copy">
            Accounts are separate from workspaces — create one, then start a
            workspace as its owner, or accept an invite from an agency you
            already work with.
          </p>
          <ul className="auth-points">
            <li>Own the workspace you create: defaults and a free trial are seeded for you.</li>
            <li>Invite managers and reps by link — roles stay per-workspace.</li>
            <li>Leave or switch workspaces any time; nothing is shared across tenants.</li>
          </ul>
        </div>
        <p className="aside-foot">No credit card needed to start on the free plan.</p>
      </aside>
      <main className="auth-panel">
        <div className="auth-card">
          <h1>Create account</h1>
          <p className="sub">Then create or join a workspace</p>
          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="displayName">Name</label>
              <input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            {error && <p className="error-text">{error}</p>}
            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {busy ? 'Creating…' : 'Create account'}
            </button>
          </form>
          <p className="auth-alt">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
