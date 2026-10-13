import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, createWorkspace } from '../api';
import { selectWorkspace } from '../session';

export default function CreateWorkspacePage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Becoming owner, seeding defaults and starting the trial all happen
      // server-side in one call.
      const ws = await createWorkspace(name.trim(), slug.trim() || undefined);
      selectWorkspace({ id: ws.id, name: ws.name, slug: ws.slug, role: 'OWNER' });
      navigate('/roster');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create workspace');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>New workspace</h1>
        <p className="sub">You will be the owner. Defaults are seeded automatically.</p>
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              placeholder="Acme Agency"
            />
          </div>
          <div className="field">
            <label htmlFor="slug">Slug (optional)</label>
            <input
              id="slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="acme — derived from the name if empty"
            />
          </div>
          {error && <p className="error-text">{error}</p>}
          <div className="modal-actions">
            <Link to="/workspaces" className="btn">Cancel</Link>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Creating…' : 'Create workspace'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
