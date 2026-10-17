import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import ReportsPage from '../pages/ReportsPage';
import RosterPage from '../pages/RosterPage';
import { setActiveWorkspaceId, setAuthToken } from '../api';
import { mockFetch } from './setup';

function renderPage(node: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function login() {
  setAuthToken('jwt-token-123');
  setActiveWorkspaceId(1);
  localStorage.setItem('roster.workspace', '1');
}

// mockFetch matches by URL prefix, so /api/reps/export must come before
// /api/reps and each audit page keys on its own query string.
type Routes = Parameters<typeof mockFetch>[0];

function rosterRoutes(items: unknown[]): Routes {
  return {
    '/api/stats': {
      body: { totalReps: items.length, benchCount: 0, placedCount: 0, openOffers: 0 },
    },
    '/api/verticals': { body: [{ id: 1, name: 'Sales' }] },
    '/api/statuses': { body: [{ id: 1, name: 'Bench', kind: 'BENCH' }] },
    '/api/experience-levels': { body: [] },
    '/api/reps/export': { body: 'name,email\nDana Scott,dana@example.test\n' },
    '/api/reps': {
      body: { page: 0, size: 20, total: items.length, items },
    },
  };
}

function rep(overrides: Partial<Record<string, unknown>>) {
  return {
    id: 5,
    name: 'Dana Scott',
    email: 'dana@example.test',
    discordUserId: null,
    verticalId: 1,
    verticalName: 'Sales',
    statusId: 1,
    statusName: 'Bench',
    statusKind: 'BENCH',
    experienceLevelId: null,
    experienceLevelName: null,
    notes: null,
    joinedDate: '2026-01-05',
    placed: false,
    offerId: null,
    offerTitle: null,
    clientName: null,
    benchDays: 5,
    ...overrides,
  };
}

describe('RosterPage bench aging', () => {
  it('shows a muted pill for a short bench and a red one past two weeks', async () => {
    login();
    mockFetch(
      rosterRoutes([
        rep({ id: 5, name: 'Dana Scott', benchDays: 5 }),
        rep({ id: 6, name: 'Rex Pullman', benchDays: 21 }),
        rep({
          id: 7,
          name: 'Pam Hall',
          placed: true,
          benchDays: null,
          offerId: 77,
          offerTitle: 'AE — Acme',
          clientName: 'Acme',
        }),
      ]),
    );
    renderPage(<RosterPage />);

    const mild = await screen.findByText('5d bench');
    expect(mild.className).toContain('pill-muted');
    expect(screen.getByText('21d bench').className).toContain('pill-danger');

    // A placed rep has no bench age at all.
    const pamCard = screen.getByRole('heading', { name: 'Pam Hall' }).closest('article')!;
    expect(within(pamCard).queryByText(/\dd bench/)).toBeNull();
    expect(within(pamCard).getByText('Placed')).toBeInTheDocument();
  });

  it('omits the pill entirely when the API sends no bench age', async () => {
    login();
    mockFetch(rosterRoutes([rep({ benchDays: null })]));
    renderPage(<RosterPage />);
    expect(await screen.findByRole('heading', { name: 'Dana Scott' })).toBeInTheDocument();
    expect(screen.queryByText(/\dd bench/)).toBeNull();
  });
});

describe('RosterPage CSV export', () => {
  it('downloads the filtered roster with the workspace header', async () => {
    login();
    const requests = mockFetch(rosterRoutes([rep({})]));
    const downloads: (Blob | MediaSource)[] = [];
    const createObjectURL = vi.fn((payload: Blob | MediaSource) => {
      downloads.push(payload);
      return 'blob:roster-export';
    });
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    renderPage(<RosterPage />);
    await screen.findByText('Dana Scott');

    // An active filter must travel into the export query.
    await userEvent.click(await screen.findByRole('button', { name: 'Sales' }));
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    const request = requests.find((r) => r.url.startsWith('/api/reps/export'));
    expect(request).toBeDefined();
    expect(request!.method).toBe('GET');
    expect(request!.url).toContain('verticalId=1');
    expect(request!.headers['X-Workspace']).toBe('1');
    expect(request!.headers['Authorization']).toBe('Bearer jwt-token-123');

    // The CSV text became the download payload.
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(downloads[0]).toBeInstanceOf(Blob);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:roster-export');
  });

  it('surfaces a failed export instead of downloading', async () => {
    login();
    const routes = rosterRoutes([rep({})]);
    routes['/api/reps/export'] = {
      status: 500,
      body: { status: 500, code: 'INTERNAL', message: 'boom' },
    };
    mockFetch(routes);
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    renderPage(<RosterPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Export CSV' }));

    expect(await screen.findByText('Export failed with status 500')).toBeInTheDocument();
    expect(clickSpy).not.toHaveBeenCalled();
    // The button is usable again.
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
  });
});

describe('ReportsPage activity feed', () => {
  const entryA = {
    id: 1,
    action: 'CREATE',
    entityType: 'REP',
    entityId: 5,
    actorUserId: 9,
    actorName: 'Aarya',
    details: '{"name":"Dana Scott"}',
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  };
  const entryB = {
    id: 2,
    action: 'UPDATE',
    entityType: 'REP',
    entityId: 6,
    actorUserId: 9,
    actorName: 'Sam',
    details: '{"name":"Rex Pullman"}',
    createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  };
  const entryC = {
    id: 3,
    action: 'UNPLACE',
    entityType: 'PLACEMENT',
    entityId: 9,
    actorUserId: null,
    actorName: null,
    details: null,
    createdAt: new Date(Date.now() - 30 * 60_000).toISOString(),
  };

  it('renders recent activity and appends older entries on load', async () => {
    login();
    const requests = mockFetch({
      '/api/reports': {
        body: {
          placementRate: { placedReps: 3, totalReps: 5, rate: 0.6 },
          averageBenchDays: 12.5,
          benchSamples: 4,
          placementsPerOffer: [],
          verticals: [],
        },
      },
      '/api/audit?page=0': {
        body: { page: 0, size: 2, total: 3, items: [entryA, entryB] },
      },
      '/api/audit?page=1': {
        body: { page: 1, size: 2, total: 3, items: [entryC] },
      },
    });
    renderPage(<ReportsPage />);

    // First page: action pill, entity, name summary from details, actor, time.
    expect(await screen.findByText('CREATE', { selector: '.pill-open' })).toBeInTheDocument();
    expect(screen.getByText('REP #5')).toBeInTheDocument();
    expect(screen.getByText(/Dana Scott/)).toBeInTheDocument();
    expect(screen.getByText('Aarya')).toBeInTheDocument();
    expect(screen.getByText('5m ago')).toBeInTheDocument();
    expect(screen.getByText('2h ago')).toBeInTheDocument();

    // total > loaded → older entries can be fetched.
    const loadOlder = screen.getByRole('button', { name: 'Load older' });
    await userEvent.click(loadOlder);

    await waitFor(() => {
      expect(
        requests.some((r) => r.url.startsWith('/api/audit?page=1')),
      ).toBe(true);
    });
    expect(await screen.findByText('UNPLACE', { selector: '.pill-bench' })).toBeInTheDocument();
    expect(screen.getByText('PLACEMENT #9')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByText('30m ago')).toBeInTheDocument();

    // Appended, not replaced: the newest entries are still on screen.
    expect(screen.getByText('CREATE', { selector: '.pill-open' })).toBeInTheDocument();
    expect(screen.getByText('REP #6')).toBeInTheDocument();

    // Everything is loaded now — no further paging offered.
    expect(screen.queryByRole('button', { name: 'Load older' })).not.toBeInTheDocument();
  });

  it('shows an empty state when nothing has happened yet', async () => {
    login();
    mockFetch({
      '/api/reports': {
        body: {
          placementRate: { placedReps: 0, totalReps: 0, rate: 0 },
          averageBenchDays: null,
          benchSamples: 0,
          placementsPerOffer: [],
          verticals: [],
        },
      },
      '/api/audit?page=0': { body: { page: 0, size: 25, total: 0, items: [] } },
    });
    renderPage(<ReportsPage />);

    expect(await screen.findByText('No activity yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load older' })).not.toBeInTheDocument();
  });
});
