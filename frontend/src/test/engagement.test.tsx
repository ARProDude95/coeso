import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import EngagementPage from '../pages/EngagementPage';
import { setActiveWorkspaceId } from '../api';
import { mockFetch, RouteTable } from './setup';

function renderPage(page: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{page}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const dashboard = {
  snapshotDate: '2026-10-22',
  membersConsidered: 3,
  atRisk: [
    {
      userId: 42,
      displayName: 'Priya',
      score: 2,
      previousScore: 30,
      daysInactive: 0,
      reasons: ['DROP'],
    },
    {
      userId: 43,
      displayName: 'Rahul',
      score: 0,
      previousScore: null,
      daysInactive: 21,
      reasons: ['INACTIVE'],
    },
  ],
};

describe('EngagementPage', () => {
  it('lists at-risk members with reasons and sends a templated nudge', async () => {
    setActiveWorkspaceId(1);
    const requests = mockFetch({
      '/api/engagement/dashboard': { body: dashboard },
      '/api/engagement/members/42/nudge': {
        method: 'POST',
        body: {
          userId: 42,
          displayName: 'Priya',
          reason: 'engagement dropped from 30 to 2',
        },
      },
    } as RouteTable);

    renderPage(<EngagementPage />);

    await screen.findByText(/Priya/);
    expect(screen.getByText('DROP')).toBeInTheDocument();
    expect(screen.getByText('INACTIVE')).toBeInTheDocument();
    expect(screen.getByText(/was 30/)).toBeInTheDocument();
    expect(screen.getByText(/21d inactive/)).toBeInTheDocument();

    // The first row's nudge posts to the member's nudge endpoint and flips
    // the button into a "sent" confirmation carrying the server's reason.
    await userEvent.click(screen.getAllByRole('button', { name: 'Nudge' })[0]);
    await waitFor(() => {
      expect(
        requests.some(
          (r) => r.url === '/api/engagement/members/42/nudge' && r.method === 'POST',
        ),
      ).toBe(true);
    });
    await screen.findByText(/nudge sent — engagement dropped from 30 to 2/);
  });

  it('replaces the dashboard with an upgrade notice on the free plan', async () => {
    setActiveWorkspaceId(1);
    mockFetch({
      '/api/engagement/dashboard': {
        status: 402,
        body: {
          status: 402,
          code: 'PRO_FEATURE_REQUIRED',
          message:
            "Feature 'engagement health' needs the Pro plan, but this workspace is on 'Free'.",
        },
      },
    } as RouteTable);

    renderPage(<EngagementPage />);

    // The [PRO] gate is a plan state, not an error to shout about.
    await screen.findByText('Engagement health is a Pro feature');
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upgrade your plan' })).toHaveAttribute(
      'href',
      '/pricing',
    );
    // No data surface, no refresh action, and no raw error line behind it.
    expect(screen.queryByRole('button', { name: /Refresh snapshots/ })).toBeNull();
    expect(screen.queryByText(/needs the Pro plan/)).toBeNull();
  });

  it('switches to the upgrade notice when a refresh answers 402', async () => {
    // A downgrade mid-session: the dashboard loaded fine, then every write is
    // refused. The page must re-check the plan instead of leaving a dead button.
    setActiveWorkspaceId(1);
    let dashboardCalls = 0;
    vi.stubGlobal('fetch', (input: string | URL) => {
      const url = String(input);
      const reply = (status: number, body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (url.startsWith('/api/engagement/dashboard')) {
        dashboardCalls += 1;
        return dashboardCalls === 1
          ? reply(200, dashboard)
          : reply(402, {
              status: 402,
              code: 'PRO_FEATURE_REQUIRED',
              message: 'Feature \'engagement health\' needs the Pro plan.',
            });
      }
      return reply(402, {
        status: 402,
        code: 'PRO_FEATURE_REQUIRED',
        message: 'Feature \'engagement health\' needs the Pro plan.',
      });
    });

    renderPage(<EngagementPage />);
    await screen.findByText(/Priya/);

    await userEvent.click(screen.getByRole('button', { name: /Refresh snapshots/ }));

    await screen.findByText('Engagement health is a Pro feature');
    expect(screen.queryByText(/Priya/)).toBeNull();
  });

  it('shows the empty state before any snapshot and refreshes on demand', async () => {
    setActiveWorkspaceId(1);
    const requests = mockFetch({
      '/api/engagement/dashboard': {
        body: { snapshotDate: null, membersConsidered: 0, atRisk: [] },
      },
      '/api/engagement/refresh': { method: 'POST', body: [] },
    } as RouteTable);

    renderPage(<EngagementPage />);

    await screen.findByText(/No snapshots yet/i);
    await userEvent.click(screen.getByRole('button', { name: /Refresh snapshots/ }));
    await waitFor(() => {
      expect(
        requests.some((r) => r.url === '/api/engagement/refresh' && r.method === 'POST'),
      ).toBe(true);
    });
  });
});
