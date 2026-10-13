import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchBranding, listWorkspaces, WorkspaceSummary } from '../api';
import { clearSession, selectWorkspace, selectedWorkspaceId } from '../session';

/**
 * Shell for workspace-scoped pages. The workspace switcher lists the caller's
 * own memberships (never an arbitrary id) and switching re-selects the
 * X-Workspace value the API client sends.
 */
export default function Layout() {
  const navigate = useNavigate();
  const { data: workspaces } = useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
  });
  const activeId = selectedWorkspaceId();
  const active: WorkspaceSummary | undefined =
    workspaces?.find((w) => w.id === activeId);

  // White-label branding: the workspace's accent color drives the --accent
  // CSS variable (and its logo replaces the wordmark in the header).
  const { data: branding } = useQuery({
    queryKey: ['branding'],
    queryFn: fetchBranding,
    enabled: activeId != null,
    staleTime: 5 * 60_000,
  });
  useEffect(() => {
    if (branding?.accentColor) {
      document.documentElement.style.setProperty('--accent', branding.accentColor);
      return () => {
        document.documentElement.style.removeProperty('--accent');
      };
    }
  }, [branding?.accentColor]);

  function switchWorkspace(id: number) {
    const target = workspaces?.find((w) => w.id === id);
    if (target) {
      selectWorkspace(target);
      navigate('/roster');
      window.location.reload();
    }
  }

  function logout() {
    clearSession();
    navigate('/login');
  }

  return (
    <div className="app-shell">
      <header className="topnav">
        <span className="brand">
          {branding?.logoUrl ? (
            <img className="brand-logo" src={branding.logoUrl} alt={active?.name ?? 'Logo'} />
          ) : (
            'Roster'
          )}
        </span>
        <nav>
          <NavLink to="/roster">Roster</NavLink>
          <NavLink to="/offers">Offers</NavLink>
          <NavLink to="/reports">Reports</NavLink>
          <NavLink to="/pricing">Pricing</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        {active && (
          <select
            aria-label="Active workspace"
            value={active.id}
            onChange={(e) => switchWorkspace(Number(e.target.value))}
            style={{ width: 'auto' }}
          >
            {workspaces?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/workspaces')}>
          Switch
        </button>
        <button className="btn btn-ghost btn-sm" onClick={logout}>
          Log out
        </button>
      </header>
      <Outlet />
    </div>
  );
}
