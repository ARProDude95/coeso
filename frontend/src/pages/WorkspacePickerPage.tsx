import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listWorkspaces } from '../api';
import { selectWorkspace } from '../session';

/** Lists the caller's own memberships and selects the active workspace. */
export default function WorkspacePickerPage() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
  });

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ maxWidth: 520 }}>
        <h1>Your workspaces</h1>
        <p className="sub">Pick where you want to work today</p>

        {isLoading && <p className="muted">Loading…</p>}
        {error && <p className="error-text">Could not load workspaces.</p>}

        <div className="workspace-list">
          {data?.map((w) => (
            <div
              key={w.id}
              className="workspace-row"
              role="button"
              tabIndex={0}
              onClick={() => {
                selectWorkspace(w);
                navigate('/roster');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  selectWorkspace(w);
                  navigate('/roster');
                }
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{w.name}</div>
                <div className="slug">{w.slug}</div>
              </div>
              <span className="pill">{w.role}</span>
            </div>
          ))}
          {data?.length === 0 && (
            <p className="muted">You are not a member of any workspace yet.</p>
          )}
        </div>

        <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
          <Link to="/workspaces/new" className="btn btn-primary">
            + Create workspace
          </Link>
        </div>
      </div>
    </div>
  );
}
