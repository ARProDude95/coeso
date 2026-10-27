import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { setAuthToken, setActiveWorkspaceId } from '../api';
import { MOCK_ROUTES, MOCK_WORKSPACE, installMockFetch } from './mockApi';
import '../styles.css';

/**
 * Visual-regression harness: boots the REAL `<App/>` (same providers, same
 * routing, same CSS) but with `window.fetch` stubbed to deterministic fixtures
 * and a seeded session, so any workspace page renders with static data and can
 * be screenshotted in isolation.
 *
 * Mount behaviour is driven by the `?page=` query param:
 *   /__visual/pages  -> the index of every capturable page (links)
 *   /__visual/pages?page=roster  -> the real /roster route, framed for a shot
 *
 * The page is seeded into the workspace-scoped route by rendering `<App/>` at
 * the page's own path via `history.replaceState`, so `RequireWorkspace` sees a
 * valid token + workspace and `Layout` renders the real top nav.
 */

// 1) Stub the network BEFORE React mounts so no real request escapes.
installMockFetch(MOCK_ROUTES);

// 2) Seed a session so the auth/workspace guards pass.
const FAKE_TOKEN = 'visual-harness-token';
localStorage.setItem('roster.token', FAKE_TOKEN);
localStorage.setItem('roster.user', JSON.stringify({
  id: 1,
  email: 'demo@example.test',
  displayName: 'Demo Owner',
}));
localStorage.setItem('roster.workspace', String(MOCK_WORKSPACE.id));
setAuthToken(FAKE_TOKEN);
setActiveWorkspaceId(MOCK_WORKSPACE.id);

/** Every capturable workspace page: its slug and the real route to visit. */
export const PAGE_TARGETS: { slug: string; path: string; label: string }[] = [
  { slug: 'roster', path: '/roster', label: 'Roster' },
  { slug: 'offers', path: '/offers', label: 'Offers' },
  { slug: 'board', path: '/board', label: 'Board' },
  { slug: 'reports', path: '/reports', label: 'Reports' },
  { slug: 'performance', path: '/performance', label: 'Performance' },
  { slug: 'office-hours', path: '/office-hours', label: 'Office hours' },
  { slug: 'intros', path: '/intros', label: 'Intros' },
  { slug: 'pods', path: '/pods', label: 'Pods' },
  { slug: 'engagement', path: '/engagement', label: 'Engagement' },
  { slug: 'settings', path: '/settings', label: 'Settings' },
  { slug: 'pricing', path: '/pricing', label: 'Pricing' },
];

/** Reads `?page=` and rewrites the URL to that page's real route. */
function resolveTargetPath(): string {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('page');
  const target = PAGE_TARGETS.find((t) => t.slug === slug);
  // Always land on a real app route so <App/> routes it through Layout.
  const path = target ? target.path : '/roster';
  window.history.replaceState(null, '', path);
  return path;
}

resolveTargetPath();

const queryClient = new QueryClient({
  defaultOptions: {
    // Deterministic: never refetch, never retry, so a screenshot is stable.
    queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
