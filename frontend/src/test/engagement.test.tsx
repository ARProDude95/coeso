import { describe, expect, it } from 'vitest';
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
