import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import BoardPage from '../pages/BoardPage';
import { setActiveWorkspaceId } from '../api';
import { mockFetch, RouteTable } from './setup';

function renderBoard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BoardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const stages = [
  { id: 1, name: 'Sourcing', position: 1 },
  { id: 2, name: 'Interviewing', position: 2 },
  { id: 3, name: 'Onboarding', position: 3 },
  { id: 4, name: 'Live', position: 4 },
];

function offer(
  id: number,
  title: string,
  stageId: number | null,
  stageName: string | null,
) {
  return {
    id,
    clientId: 1,
    clientName: 'Acme',
    verticalId: null,
    verticalName: null,
    title,
    seats: 2,
    filledSeats: 0,
    notes: null,
    opensAt: null,
    closesAt: null,
    status: 'OPEN',
    effectiveStatus: 'OPEN',
    reps: [],
    stageId,
    stageName,
  };
}

const boardBody = [
  { stage: stages[0], offers: [offer(77, 'Closer needed', 1, 'Sourcing')] },
  { stage: stages[1], offers: [] },
  { stage: stages[2], offers: [] },
  { stage: stages[3], offers: [offer(81, 'Account Executive', 4, 'Live')] },
];

/**
 * Route table note: the specific stage paths are declared before the generic
 * '/api/pipeline/stages' key — mockFetch picks the first prefix whose methods
 * match, and move/delete URLs start with that same prefix.
 */
function boardRoutes(): RouteTable {
  return {
    '/api/pipeline/board': { body: boardBody },
    '/api/workspaces': {
      body: [{ id: 1, name: 'Acme', slug: 'acme', role: 'OWNER' }],
    },
    '/api/offers/77/stage': {
      method: 'POST',
      body: offer(77, 'Closer needed', 4, 'Live'),
    },
    '/api/pipeline/stages/2/move': {
      method: 'POST',
      body: [stages[1], stages[0], stages[2], stages[3]],
    },
    '/api/pipeline/stages/3': {
      method: 'DELETE',
      status: 409,
      body: {
        status: 409,
        code: 'CONFLICT',
        message: 'Stage is used by 1 offer(s); move them before deleting it',
      },
    },
    '/api/pipeline/stages': [
      { method: 'GET', body: stages },
      { method: 'POST', status: 201, body: { id: 5, name: 'Escalation', position: 5 } },
    ],
  };
}

describe('BoardPage', () => {
  it('renders columns, grouped cards and a labelled move menu per card', async () => {
    setActiveWorkspaceId(1);
    mockFetch(boardRoutes());
    renderBoard();

    // Every stage becomes a named region with a real list of cards inside.
    const sourcing = await screen.findByRole('region', { name: /Sourcing/ });
    expect(screen.getByRole('region', { name: /Interviewing/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Onboarding/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Live/ })).toBeInTheDocument();

    expect(within(sourcing).getByText('Closer needed')).toBeInTheDocument();
    expect(screen.getByText('Account Executive')).toBeInTheDocument();

    // Counts are textual, empty columns say so, live region exists.
    expect(screen.getAllByText(/1 offer/)).toHaveLength(2);
    expect(screen.getAllByText('No offers in this stage.')).toHaveLength(2);
    expect(screen.getByRole('status')).toBeInTheDocument();

    // The accessible move control carries the offer's title in its name.
    expect(
      screen.getByRole('combobox', { name: 'Move Closer needed to stage' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: 'Move Account Executive to stage' }),
    ).toBeInTheDocument();

    // Manager+ users get the stage management affordance.
    expect(screen.getByRole('button', { name: 'Manage stages' })).toBeInTheDocument();
  });

  it('moves a card with the keyboard alone and announces the result', async () => {
    setActiveWorkspaceId(1);
    const requests = mockFetch(boardRoutes());
    renderBoard();

    const select = await screen.findByRole('combobox', {
      name: 'Move Closer needed to stage',
    });
    // Keyboard path: pick a target stage in the labelled select (no drag).
    await userEvent.selectOptions(select, '4');

    await waitFor(() => {
      const move = requests.find(
        (r) => r.url === '/api/offers/77/stage' && r.method === 'POST',
      );
      expect(move).toBeDefined();
      expect(move?.body).toEqual({ stageId: 4 });
    });

    // The polite live region confirms the move for screen readers.
    expect(
      await screen.findByText('Moved Closer needed to Live.'),
    ).toBeInTheDocument();
  });

  it('creates, reorders and deletes stages from the management panel', async () => {
    setActiveWorkspaceId(1);
    const requests = mockFetch(boardRoutes());
    renderBoard();

    await userEvent.click(await screen.findByRole('button', { name: 'Manage stages' }));

    // Add a column.
    await userEvent.type(screen.getByLabelText('New stage name'), 'Escalation');
    await userEvent.click(screen.getByRole('button', { name: 'Add stage' }));
    await waitFor(() => {
      const create = requests.find(
        (r) => r.url === '/api/pipeline/stages' && r.method === 'POST',
      );
      expect(create?.body).toEqual({ name: 'Escalation' });
    });

    // Reorder with explicit buttons (no drag gesture needed).
    await userEvent.click(
      await screen.findByRole('button', { name: 'Move Interviewing up' }),
    );
    await waitFor(() => {
      const move = requests.find(
        (r) => r.url === '/api/pipeline/stages/2/move' && r.method === 'POST',
      );
      expect(move?.body).toEqual({ direction: 'UP' });
    });

    // A conflict from the server (stage still holds offers) is surfaced,
    // never swallowed.
    await userEvent.click(
      screen.getByRole('button', { name: 'Delete Onboarding' }),
    );
    expect(await screen.findByText(/move them before deleting it/)).toBeInTheDocument();

    // First column cannot move up further.
    expect(
      screen.getByRole('button', { name: 'Move Sourcing up' }),
    ).toBeDisabled();
  });

  it('tells a rep the board needs manager access instead of showing an empty grid', async () => {
    setActiveWorkspaceId(2);
    mockFetch({
      '/api/pipeline/board': {
        status: 403,
        body: { status: 403, code: 'FORBIDDEN', message: 'Insufficient role for this operation' },
      },
      '/api/workspaces': {
        body: [{ id: 2, name: 'Acme', slug: 'acme', role: 'REP' }],
      },
    });
    renderBoard();

    expect(
      await screen.findByText('Manager access is required to view the pipeline board.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    // Reps never see stage management.
    expect(
      screen.queryByRole('button', { name: 'Manage stages' }),
    ).not.toBeInTheDocument();
  });
});
