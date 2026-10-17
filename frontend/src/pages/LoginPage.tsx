import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, discordAuthorizeUrl, login } from '../api';
import { saveSession } from '../session';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [discordBusy, setDiscordBusy] = useState(false);
  const [discordError, setDiscordError] = useState<string | null>(null);

  async function onDiscord() {
    setDiscordBusy(true);
    setDiscordError(null);
    try {
      const { url } = await discordAuthorizeUrl();
      window.location.assign(url);
    } catch (err) {
      setDiscordError(
        err instanceof ApiError && err.status === 503
          ? 'Discord login is not configured on this server.'
          : err instanceof ApiError
            ? err.message
            : 'Could not start Discord login',
      );
      setDiscordBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const auth = await login(email.trim(), password);
      saveSession(auth.token, auth.user);
      navigate('/workspaces');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <span className="aside-brand">Roster</span>
        <div>
          <h2>Run your roster like the pros do.</h2>
          <p className="aside-copy">
            One workspace for your reps, offers and placements — with live
            capacity, placement rules that hold under pressure, and reports
            that show where the revenue actually is.
          </p>
          <ul className="auth-points">
            <li>Seats fill in order: one active placement per rep, enforced in the database.</li>
            <li>Offers, clients and verticals in one place, filtered the way you think.</li>
            <li>Placement rate, bench time and per-vertical breakdowns on demand.</li>
          </ul>
        </div>
        <p className="aside-foot">Multi-tenant by design — your data never leaves your workspace.</p>
      </aside>
      <main className="auth-panel">
        <div className="auth-card">
          <h1>Sign in</h1>
          <p className="sub">Welcome back. Pick up where your roster left off.</p>
          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <p className="error-text">{error}</p>}
            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <div className="auth-divider"><span>or</span></div>
          <button className="btn btn-block" type="button" onClick={onDiscord} disabled={discordBusy}>
            {discordBusy ? 'Redirecting…' : 'Continue with Discord'}
          </button>
          {discordError && <p className="error-text">{discordError}</p>}
          <p className="auth-alt">
            No account? <Link to="/register">Create one</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
