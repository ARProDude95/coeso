import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, discordLogin } from '../api';
import { saveSession } from '../session';

/**
 * OAuth callback: Discord redirects here with ?code=... The code is exchanged
 * for a Roster JWT (the backend links or creates the account by email), then
 * the session is stored and the user lands on the workspace picker.
 */
export default function AuthDiscordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) {
      return; // React 18 strict mode runs effects twice; exchange once
    }
    started.current = true;
    const code = params.get('code');
    if (!code) {
      setError('Discord did not return an authorization code.');
      return;
    }
    discordLogin(code)
      .then((auth) => {
        saveSession(auth.token, auth.user);
        navigate('/workspaces', { replace: true });
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Discord login failed');
      });
  }, [params, navigate]);

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Roster</h1>
        <p className="sub">Signing in with Discord…</p>
        {error && <p className="error-text">{error}</p>}
        <p className="muted" style={{ textAlign: 'center' }}>
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
