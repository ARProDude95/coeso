import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import IntrosPage from '../pages/IntrosPage';
import OfficeHoursPage from '../pages/OfficeHoursPage';
import PodsPage from '../pages/PodsPage';
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

// ------------------------------------------------------------- intros

const introProfile = {
  userId: 1,
  displayName: 'You',
  offeringTags: ['fundraising'],
  lookingForTags: ['legal'],
  industry: 'Fintech',
};

const suggestions = [
  {
    userId: 42,
    displayName: 'Priya',
    reason: 'You offer fundraising; she looks for it',
    percent: 80,
    pendingWithYou: false,
  },
  {
    userId: 43,
    displayName: 'Rahul',
    reason: 'Shared industry + tag overlap',
    percent: 55,
    pendingWithYou: true,
  },
];

const incoming = [
  {
    id: 9,
    fromUserId: 44,
    fromName: 'Meera',
    toUserId: 1,
    toName: 'You',
    status: 'PENDING',
    reason: 'Need ops help',
    contactEmail: null,
    createdAt: '2026-10-01T10:00:00',
  },
];

describe('IntrosPage', () => {
  it('shows suggestions with reasons and requests an intro', async () => {
    setActiveWorkspaceId(1);
    const requests = mockFetch({
      '/api/intros/profile': { body: introProfile },
      '/api/intros/suggestions': { body: suggestions },
      '/api/intros/requests/incoming': { body: incoming },
      '/api/intros/requests/outgoing': { body: [] },
      '/api/intros/requests': { method: 'POST', status: 201, body: { id: 10, status: 'PENDING' } },
    } as RouteTable);

    renderPage(<IntrosPage />);

    await screen.findByText(/You offer fundraising; she looks for it/i);
    // The pending one shows a pill, not a button.
    expect(screen.getByText('requested')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Request intro/i }));
    await waitFor(() => {
      const introPost = requests.find(
        (r) => r.url === '/api/intros/requests' && r.method === 'POST',
      );
      expect(introPost?.body).toEqual({ targetUserId: 42 });
    });
  });

  it('accepts an incoming request and reveals the contact', async () => {
    setActiveWorkspaceId(1);
    const requests = mockFetch({
      '/api/intros/profile': { body: introProfile },
      '/api/intros/suggestions': { body: [] },
      '/api/intros/requests/incoming': [
        { body: incoming },
        {
          body: [{ ...incoming[0], status: 'ACCEPTED', contactEmail: 'meera@example.com' }],
        },
      ],
      '/api/intros/requests/outgoing': { body: [] },
      '/api/intros/requests/9/accept': { method: 'POST', body: { id: 9, status: 'ACCEPTED' } },
    } as RouteTable);

    renderPage(<IntrosPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Accept' }));

    await waitFor(() => {
      expect(
        requests.some((r) => r.url === '/api/intros/requests/9/accept' && r.method === 'POST'),
      ).toBe(true);
    });
  });
});

// --------------------------------------------------------- office hours

const slots = [
  {
    id: 5,
    expertUserId: 7,
    expertName: 'Anita',
    startsAt: '2026-11-01T10:00:00',
    durationMinutes: 30,
    priceMinor: 250000,
    currency: 'INR',
    status: 'OPEN',
  },
];

const bookings = {
  asMember: [
    {
      id: 11,
      slotId: 5,
      expertUserId: 7,
      memberUserId: 1,
      status: 'CONFIRMED',
      priceMinor: 250000,
      expertAmountMinor: 225000,
      platformAmountMinor: 25000,
      currency: 'INR',
      meetingLink: 'https://meet.example.com/abc',
      providerOrderId: 'order_1',
      confirmedAt: '2026-10-19T09:00:00',
      cancelledAt: null,
      startsAt: '2026-11-01T10:00:00',
      durationMinutes: 30,
      expertName: 'Anita',
      createdAt: '2026-10-19T08:59:00',
    },
  ],
  asExpert: [],
};

describe('OfficeHoursPage', () => {
  it('lists open slots with INR prices and books one', async () => {
    setActiveWorkspaceId(1);
    const requests = mockFetch({
      '/api/office-hours/bookings': { body: { asMember: [], asExpert: [] } },
      '/api/office-hours/slots/mine': { method: 'GET', body: [] },
      '/api/office-hours/slots': { method: 'GET', body: slots },
      '/api/office-hours/commission': { body: { commissionBp: 1000 } },
      '/api/office-hours/slots/5/book': {
        method: 'POST',
        body: {
          bookingId: 12,
          provider: 'razorpay',
          orderId: 'order_2',
          amountMinor: 250000,
          currency: 'INR',
          status: 'PENDING',
        },
      },
    } as RouteTable);

    renderPage(<OfficeHoursPage />);
    await screen.findByText(/Anita/);
    expect(screen.getByText('₹2,500.00')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Book & pay/i }));
    await waitFor(() => {
      expect(
        requests.some((r) => r.url === '/api/office-hours/slots/5/book' && r.method === 'POST'),
      ).toBe(true);
    });
  });

  it('shows a confirmed booking with its meeting link', async () => {
    setActiveWorkspaceId(1);
    mockFetch({
      '/api/office-hours/bookings': { body: bookings },
      '/api/office-hours/slots/mine': { method: 'GET', body: [] },
      '/api/office-hours/slots': { method: 'GET', body: [] },
      '/api/office-hours/commission': { body: { commissionBp: 1000 } },
    } as RouteTable);

    renderPage(<OfficeHoursPage />);
    await screen.findByText('confirmed');
    expect(screen.getByRole('link', { name: 'Join link' })).toHaveAttribute(
      'href',
      'https://meet.example.com/abc',
    );
  });
});

// ---------------------------------------------------------------- pods

const myPods = [
  {
    id: 3,
    name: 'Cohort 1',
    industry: 'Fintech',
    members: [
      { userId: 1, displayName: 'You', streak: 2, revenueStage: 'Seed' },
      { userId: 8, displayName: 'Vikram', streak: null, revenueStage: 'Series A' },
    ],
  },
];

describe('PodsPage', () => {
  it('shows the member pod with streaks and files a check-in', async () => {
    setActiveWorkspaceId(1);
    // Specific paths must precede the generic '/api/pods' prefix — mockFetch
    // matches the first prefix whose methods fit.
    const requests = mockFetch({
      '/api/workspaces': { body: [{ id: 1, name: 'Acme', slug: 'acme', role: 'MANAGER' }] },
      // The thread route must precede the generic pod-detail prefix.
      '/api/pods/3/messages': [
        { method: 'GET', body: [] },
        {
          method: 'POST',
          body: {
            id: 1,
            podId: 3,
            userId: 1,
            displayName: 'You',
            body: 'Standup Mondays 9am',
            createdAt: '2026-10-20T10:00:00',
          },
        },
      ],
      '/api/pods/3/checkins': [
        { body: [] },
        {
          body: [
            {
              id: 1,
              podId: 3,
              userId: 1,
              displayName: 'You',
              weekStart: '2026-10-19',
              wins: 'Shipped',
              blockers: 'None',
              ask: null,
            },
          ],
        },
      ],
      '/api/pods/3': { body: myPods[0] },
      '/api/pods': { body: myPods },
    } as RouteTable);

    renderPage(<PodsPage />);
    await screen.findByText('Cohort 1');
    await screen.findByText('2-week streak');

    await userEvent.click(screen.getByRole('button', { name: 'Check in this week' }));
    await userEvent.type(screen.getByPlaceholderText(/What went well/i), 'Closed two deals');
    await userEvent.type(screen.getByPlaceholderText(/What's in the way/i), 'Hiring');
    await userEvent.click(screen.getByRole('button', { name: 'Submit check-in' }));

    await waitFor(() => {
      const post = requests.find(
        (r) => r.url === '/api/pods/3/checkins' && r.method === 'POST',
      );
      expect(post?.body).toEqual({
        wins: 'Closed two deals',
        blockers: 'Hiring',
        ask: null,
      });
    });

    // The private thread posts through the same pod scope.
    await userEvent.type(
      screen.getByPlaceholderText(/Share an update/i),
      'Standup Mondays 9am',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => {
      const post = requests.find(
        (r) => r.url === '/api/pods/3/messages' && r.method === 'POST',
      );
      expect(post?.body).toEqual({ body: 'Standup Mondays 9am' });
    });
  });

  it('hides the generate panel from managers', async () => {
    setActiveWorkspaceId(1);
    localStorage.setItem('roster.workspace', '1');
    mockFetch({
      '/api/workspaces': { body: [{ id: 1, name: 'Acme', slug: 'acme', role: 'MANAGER' }] },
      '/api/pods': { body: [] },
    } as RouteTable);
    const { container } = renderPage(<PodsPage />);
    await screen.findByText(/You're not in any active pod yet/i);
    expect(container.querySelector('h2')).not.toHaveTextContent('Generate pods');
  });

  it('shows the revenue-stage composition on the pod card and in the preview', async () => {
    setActiveWorkspaceId(1);
    localStorage.setItem('roster.workspace', '1');
    mockFetch({
      '/api/workspaces': { body: [{ id: 1, name: 'Acme', slug: 'acme', role: 'OWNER' }] },
      '/api/pods/3/messages': { method: 'GET', body: [] },
      '/api/pods/3/checkins': { method: 'GET', body: [] },
      '/api/pods/3': { body: myPods[0] },
      '/api/pods/generate': {
        method: 'POST',
        body: [
          {
            industry: 'Fintech',
            userIds: [1, 2],
            names: ['You', 'Sam'],
            revenueStages: ['Seed', 'Seed'],
          },
        ],
      },
      '/api/pods': { body: myPods },
    } as RouteTable);

    renderPage(<PodsPage />);

    // Published pod card: one pill per distinct stage with its member count.
    await screen.findByText('Cohort 1');
    expect(await screen.findAllByText(/^Seed · 1$/)).not.toHaveLength(0);
    expect(await screen.findAllByText(/^Series A · 1$/)).not.toHaveLength(0);

    // The admin preview shows the draft's stage mix before publishing.
    await userEvent.click(await screen.findByRole('button', { name: 'Generate preview' }));
    expect(await screen.findAllByText(/^Seed · 2$/)).not.toHaveLength(0);
  });

  it('lets an owner preview and publish pods', async () => {
    setActiveWorkspaceId(1);
    // AdminPanel resolves the caller's role through the session's workspace.
    localStorage.setItem('roster.workspace', '1');
    const requests = mockFetch({
      '/api/workspaces': { body: [{ id: 1, name: 'Acme', slug: 'acme', role: 'OWNER' }] },
      '/api/pods/publish': {
        method: 'POST',
        body: [{ id: 9, name: 'Pod 1', industry: 'Fintech', members: [] }],
      },
      '/api/pods/generate': {
        method: 'POST',
        body: [{ industry: 'Fintech', userIds: [1, 2], names: ['You', 'Sam'] }],
      },
      '/api/pods': { body: [] },
    } as RouteTable);

    renderPage(<PodsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Generate preview' }));
    await userEvent.click(await screen.findByRole('button', { name: /Publish 1 pods/i }));
    await waitFor(() => {
      expect(
        requests.some((r) => r.url === '/api/pods/publish' && r.method === 'POST'),
      ).toBe(true);
    });
  });
});
