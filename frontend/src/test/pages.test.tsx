import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import RosterPage from '../pages/RosterPage';
import { setActiveWorkspaceId } from '../api';
import { mockFetch } from './setup';

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RosterPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const repsBody = {
  page: 0,
  size: 20,
  total: 1,
  items: [
    {
      id: 5,
      name: ' Dana Scott ',
      email: 'dana@example.test',
      discordUserId: null,
      verticalId: 1,
      verticalName: 'Sales',
      statusId: 1,
      statusName: 'Bench',
      statusKind: 'BENCH',
      experienceLevelId: 2,
      experienceLevelName: 'Mid',
      notes: 'Great closer',
      joinedDate: '2026-01-05',
      placed: false,
      offerId: null,
      offerTitle: null,
      clientName: null,
    },
  ],
};

describe('RosterPage', () => {
  it('shows stats, filters and rep cards from the API', async () => {
    setActiveWorkspaceId(1);
    mockFetch({
      '/api/stats': { body: { totalReps: 12, benchCount: 4, placedCount: 8, openOffers: 3 } },
      '/api/verticals': { body: [{ id: 1, name: 'Sales' }] },
      '/api/statuses': { body: [{ id: 1, name: 'Bench', kind: 'BENCH' }] },
      '/api/experience-levels': { body: [{ id: 2, name: 'Mid' }] },
      '/api/reps': { body: repsBody },
    });
    renderPage();

    // stats header
    expect(await screen.findByText('Total reps')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('On bench')).toBeInTheDocument();
    expect(screen.getByText('Open offers')).toBeInTheDocument();

    // filter chips
    const salesChip = await screen.findByRole('button', { name: 'Sales' });
    expect(screen.getByRole('button', { name: 'Bench' })).toBeInTheDocument();
    // "clear filters" appears only once a filter is active
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    await userEvent.click(salesChip);
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();

    // rep card: avatar initials, trimmed name, vertical, experience, pills, notes
    expect(await screen.findByText('DS')).toBeInTheDocument();
    expect(screen.getByText('Dana Scott')).toBeInTheDocument();
    expect(screen.getByText('Mid')).toBeInTheDocument();
    expect(screen.getByText('Bench', { selector: '.pill-bench' })).toBeInTheDocument();
    // the derived "Bench" pill is suppressed when a status pill already says Bench
    expect(screen.queryByText('Bench', { selector: '.pill-bench-now' })).not.toBeInTheDocument();
    expect(screen.getByText('Great closer')).toBeInTheDocument();

    // unplaced rep offers the place action
    expect(screen.getByRole('button', { name: 'Place on offer' })).toBeInTheDocument();
  });

  it('place picker lists only open offers and posts the placement', async () => {
    setActiveWorkspaceId(1);
    const requests = mockFetch({
      '/api/stats': { body: { totalReps: 1, benchCount: 1, placedCount: 0, openOffers: 1 } },
      '/api/verticals': { body: [] },
      '/api/statuses': { body: [] },
      '/api/experience-levels': { body: [] },
      '/api/reps': { body: repsBody },
      '/api/offers': {
        body: [
          {
            id: 77,
            clientId: 1,
            clientName: 'Acme',
            verticalId: null,
            verticalName: null,
            title: 'Closer needed',
            seats: 2,
            filledSeats: 1,
            notes: null,
            opensAt: null,
            closesAt: null,
            status: 'OPEN',
            effectiveStatus: 'OPEN',
            reps: [],
          },
        ],
      },
      '/api/placements': {
        status: 201,
        body: {
          id: 1,
          offerId: 77,
          offerTitle: 'Closer needed',
          repId: 5,
          repName: 'Dana Scott',
          status: 'ACTIVE',
          placedAt: '2026-10-11T10:00:00',
          endedAt: null,
          endReason: null,
        },
      },
    });
    renderPage();

    const placeButton = await screen.findByRole('button', { name: 'Place on offer' });
    await userEvent.click(placeButton);

    // picker shows the open offer with seat info
    const offerRow = await screen.findByText('Closer needed');
    expect(offerRow).toBeInTheDocument();
    expect(screen.getByText(/1\/2 seats filled/)).toBeInTheDocument();

    await userEvent.click(offerRow);

    await waitFor(() => {
      const placement = requests.find((r) => r.url === '/api/placements' && r.method === 'POST');
      expect(placement).toBeDefined();
      expect(placement?.body).toEqual({ offerId: 77, repId: 5 });
      expect(placement?.headers['X-Workspace']).toBe('1');
    });
  });
});
