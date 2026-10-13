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
      <div className="auth-card">
        <h1>Roster</h1>
        <p className="sub">Sign in to your workspace</p>
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
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="auth-divider"><span>or</span></div>
        <button
          className="btn"
          type="button"
          style={{ width: '100%', justifyContent: 'center' }}
          onClick={onDiscord}
          disabled={discordBusy}
        >
          {discordBusy ? 'Redirecting…' : 'Continue with Discord'}
        </button>
        {discordError && <p className="error-text">{discordError}</p>}
        <p className="muted" style={{ marginTop: '1rem', textAlign: 'center' }}>
          No account? <Link to="/register">Create one</Link>
        </p>
      </div>
    </div>
  );
}
