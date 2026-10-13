import { setActiveWorkspaceId, setAuthToken, WorkspaceSummary } from './api';

const TOKEN_KEY = 'roster.token';
const USER_KEY = 'roster.user';
const WORKSPACE_KEY = 'roster.workspace';

/** Restores the persisted session (if any) into the API client at boot. */
export function restoreSession(): void {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    setAuthToken(token);
  }
  const ws = localStorage.getItem(WORKSPACE_KEY);
  if (ws) {
    const parsed = Number(ws);
    if (Number.isFinite(parsed)) {
      setActiveWorkspaceId(parsed);
    }
  }
}

export function saveSession(token: string, user: unknown): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  setAuthToken(token);
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(WORKSPACE_KEY);
  setAuthToken(null);
  setActiveWorkspaceId(null);
}

export function currentToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function selectWorkspace(workspace: WorkspaceSummary): void {
  localStorage.setItem(WORKSPACE_KEY, String(workspace.id));
  setActiveWorkspaceId(workspace.id);
}

export function selectedWorkspaceId(): number | null {
  const raw = localStorage.getItem(WORKSPACE_KEY);
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
