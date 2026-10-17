import { Navigate, Route, Routes } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listWorkspaces, me } from './api';
import { currentToken, selectedWorkspaceId } from './session';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import AuthDiscordPage from './pages/AuthDiscordPage';
import WorkspacePickerPage from './pages/WorkspacePickerPage';
import CreateWorkspacePage from './pages/CreateWorkspacePage';
import RosterPage from './pages/RosterPage';
import OffersPage from './pages/OffersPage';
import SettingsPage from './pages/SettingsPage';
import PricingPage from './pages/PricingPage';
import ReportsPage from './pages/ReportsPage';
import PerformancePage from './pages/PerformancePage';

/**
 * Route guards:
 *  - RequireAuth: a JWT must exist (restored from localStorage at boot).
 *  - RequireWorkspace: in addition, an active workspace must be selected;
 *    otherwise the user is sent to the workspace picker.
 * The /api/workspaces query both verifies the token and gives the picker its
 * data, so it is primed here and shared.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = currentToken();
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function RequireWorkspace({ children }: { children: React.ReactNode }) {
  const token = currentToken();
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  const workspaceId = selectedWorkspaceId();
  const { data: workspaces, isLoading } = useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
  });
  if (isLoading && !workspaces) {
    return <div className="empty-state">Loading…</div>;
  }
  const valid = workspaces?.some((w) => w.id === workspaceId);
  if (!workspaceId || !valid) {
    return <Navigate to="/workspaces" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  void me; // token check only; /api/auth/me is used by the settings/nav later
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/auth/discord" element={<AuthDiscordPage />} />
      <Route
        path="/workspaces"
        element={
          <RequireAuth>
            <WorkspacePickerPage />
          </RequireAuth>
        }
      />
      <Route
        path="/workspaces/new"
        element={
          <RequireAuth>
            <CreateWorkspacePage />
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireWorkspace>
            <Layout />
          </RequireWorkspace>
        }
      >
        <Route path="/" element={<Navigate to="/roster" replace />} />
        <Route path="/roster" element={<RosterPage />} />
        <Route path="/offers" element={<OffersPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/performance" element={<PerformancePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/pricing" element={<PricingPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
