import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import PerformancePage from '../pages/PerformancePage';
import SettingsPage from '../pages/SettingsPage';
import { setActiveWorkspaceId, setAuthToken } from '../api';
import { mockFetch } from './setup';

/**
 * Phase 7 — performance, commissions & payouts on the UI:
 *  - a free-plan workspace sees the [PRO] upgrade notice instead of data;
 *  - reps get only Log + Earnings, manager+ also Payouts and Commission rules;
 *  - logging money enters major units but travels as integer minor units;
 *  - a payout batch is one POST per rep with exactly the selected entries;
 *  - Settings manages the per-workspace metric vocabulary.
 */

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

function login(role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'REP' = 'MANAGER') {
  setAuthToken('jwt-token-123');
  setActiveWorkspaceId(1);
  localStorage.setItem('roster.workspace', '1');
  return [{ id: 1, name: 'Acme', slug: 'acme', role }];
}

type Routes = Parameters<typeof mockFetch>[0];

const METRICS = [
  { id: 1, name: 'Calls', unit: 'count' },
  { id: 4, name: 'Revenue generated', unit: 'currency' },
];

const META = [
  { placementId: 77, offerId: 3, offerTitle: 'AE — Acme', repId: 5, repName: 'Dana Scott' },
];

function activityEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 901,
    placementId: 77,
    repId: 5,
    repName: 'Dana Scott',
    offerId: 3,
    offerTitle: 'AE — Acme',
    metricTypeId: 1,
    metricName: 'Calls',
    metricUnit: 'count',
    occurredOn: '2026-10-01',
    valueMinor: 12,
    notes: 'follow-ups',
    loggedBy: 2,
    createdAt: '2026-10-01T12:00:00',
    updatedAt: '2026-10-01T12:00:00',
    canEdit: true,
    ...overrides,
  };
}

function earningsEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    repId: 5,
    repName: 'Dana Scott',
    placementId: 77,
    offerId: 3,
    offerTitle: 'AE — Acme',
    activityEntryId: 901,
    commissionRuleId: 1,
    payoutId: null,
    reversesEntryId: null,
    status: 'approved',
    amountMinor: 50000,
    currency: 'USD',
    enteredOn: '2026-10-02',
    createdAt: '2026-10-02T09:00:00',
    reversal: false,
    ...overrides,
  };
}

function perfRoutes(workspaces: unknown[], extra: Routes = {}): Routes {
  return {
    '/api/metric-types': { body: METRICS },
    '/api/activity/meta': { body: META },
    '/api/activity': { body: { page: 0, size: 200, total: 1, items: [activityEntry()] } },
    '/api/reps': { body: { page: 0, size: 200, total: 1, items: [
      { id: 5, name: 'Dana Scott' },
    ] } },
    '/api/offers': { body: [{ id: 3, title: 'AE — Acme' }] },
    '/api/earnings': { body: { total: 1, netMinor: 50000, currency: 'USD', items: [earningsEntry()] } },
    '/api/payouts': { body: [] },
    '/api/commission-rules': { body: [] },
    '/api/leaderboard': {
      body: {
        period: 'month',
        metricTypeId: 1,
        metricName: 'Calls',
        metricUnit: 'count',
        from: '2026-10-01',
        to: '2026-10-31',
        showNames: true,
        selfRank: null,
        items: [
          { rank: 1, repId: 5, repName: 'Dana Scott', value: 120, self: false },
        ],
      },
    },
    '/api/workspaces': { body: workspaces },
    ...extra,
  };
}

describe('PerformancePage PRO gating', () => {
  it('replaces the whole page with an upgrade notice on the free plan', async () => {
    const workspaces = login();
    mockFetch({
      '/api/metric-types': {
        status: 402,
        body: {
          status: 402,
          code: 'PRO_FEATURE_REQUIRED',
          message: 'Upgrade your plan to unlock performance logging',
        },
      },
      '/api/workspaces': { body: workspaces },
    });
    renderPage(<PerformancePage />);

    await waitFor(() => {
      expect(screen.getByText('Performance is a Pro feature')).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'Upgrade your plan' })).toHaveAttribute(
      'href',
      '/pricing',
    );
  });
});

describe('PerformancePage manager view', () => {
  it('renders the activity log, manager-only tabs and the leaderboard', async () => {
    const workspaces = login('MANAGER');
    const requests = mockFetch(perfRoutes(workspaces));
    renderPage(<PerformancePage />);

    await waitFor(() => {
      expect(screen.getByText('Activity log')).toBeInTheDocument();
    });
    // Entry rows (and their Delete button) only exist once data arrives.
    await screen.findByRole('button', { name: 'Delete' });
    // The row's metric name and offer title sit inside one lookup-row element.
    expect(
      screen.getAllByText(
        (_content, element) =>
          element?.classList.contains('lookup-row') === true &&
          (element.textContent ?? '').includes('Calls — AE — Acme'),
      ).length,
    ).toBeGreaterThan(0);

    // Manager tabs: Payouts + Commission rules exist.
    expect(screen.getByRole('tab', { name: 'Payouts' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Commission rules' })).toBeInTheDocument();

    // Leaderboard widget below.
    expect(await screen.findByText(/#1 Dana Scott/)).toBeInTheDocument();

    // Delete is manager-only and shown for each entry.
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();

    // The rep filter is manager-only and travels to the API.
    const repFilter = screen.getByLabelText('Rep');
    await userEvent.selectOptions(repFilter, '5');
    await waitFor(() => {
      expect(
        requests.some((r) => r.url.startsWith('/api/activity') && r.url.includes('repId=5')),
      ).toBe(true);
    });
  });
});

describe('PerformancePage rep view', () => {
  it('shows only Log + Earnings, hides delete and the rep filter', async () => {
    const workspaces = login('REP');
    mockFetch(perfRoutes(workspaces));
    renderPage(<PerformancePage />);

    await waitFor(() => {
      expect(screen.getByText('Activity log')).toBeInTheDocument();
    });
    expect(screen.queryByRole('tab', { name: 'Payouts' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Commission rules' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Earnings' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByLabelText('Rep')).toBeNull();
  });
});

describe('PerformancePage logging', () => {
  it('converts major units to integer minor units on submit', async () => {
    const workspaces = login('MANAGER');
    const requests = mockFetch(
      perfRoutes(workspaces, {
        '/api/activity': [
          { method: 'GET', body: { page: 0, size: 200, total: 1, items: [activityEntry()] } },
          {
            method: 'POST',
            status: 201,
            body: activityEntry({ id: 902, metricTypeId: 4, valueMinor: 1250 }),
          },
        ],
      }),
    );
    renderPage(<PerformancePage />);

    await userEvent.click(await screen.findByRole('button', { name: '+ Log activity' }));
    const dialog = await screen.findByRole('dialog', { name: 'Log activity' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Placement'), '77');
    await userEvent.selectOptions(within(dialog).getByLabelText('Metric'), '4');
    await userEvent.type(within(dialog).getByLabelText('Value'), '12.5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Log entry' }));

    await waitFor(() => {
      const post = requests.find((r) => r.method === 'POST' && r.url === '/api/activity');
      expect(post).toBeTruthy();
      expect(post!.body).toMatchObject({
        placementId: 77,
        metricTypeId: 4,
        valueMinor: 1250,
        notes: null,
      });
      // Money never travels as floats: an integer, always.
      expect(Number.isInteger((post!.body as { valueMinor: number }).valueMinor)).toBe(true);
    });
  });
});

describe('PerformancePage payouts', () => {
  it('batches the selected approved entries into one payout per rep', async () => {
    const workspaces = login('MANAGER');
    const requests = mockFetch(
      perfRoutes(workspaces, {
        '/api/earnings': {
          body: {
            total: 2,
            netMinor: 80000,
            currency: 'USD',
            items: [
              earningsEntry({ id: 11, amountMinor: 50000 }),
              earningsEntry({ id: 12, amountMinor: 30000 }),
              earningsEntry({ id: 13, amountMinor: 7000, status: 'accrued' }),
            ],
          },
        },
        '/api/payouts': [
          { method: 'GET', body: [] },
          {
            method: 'POST',
            status: 201,
            body: {
              id: 1,
              repId: 5,
              repName: 'Dana Scott',
              amountMinor: 80000,
              currency: 'USD',
              entryCount: 2,
              paidOn: '2026-10-17',
              referenceNote: null,
              createdBy: 2,
              createdAt: '2026-10-17T10:00:00',
            },
          },
        ],
      }),
    );
    renderPage(<PerformancePage />);

    await userEvent.click(await screen.findByRole('tab', { name: 'Payouts' }));
    // Approved entries only are selectable; accrued ones are not listed.
    const approvedChecks = await screen.findAllByLabelText(/Select entry/);
    expect(approvedChecks).toHaveLength(2);
    await userEvent.click(approvedChecks[0]);
    await userEvent.click(approvedChecks[1]);

    const payButton = await screen.findByRole('button', { name: /Pay 2 entries/ });
    await userEvent.click(payButton);

    await waitFor(() => {
      const post = requests.find((r) => r.method === 'POST' && r.url === '/api/payouts');
      expect(post).toBeTruthy();
      expect(post!.body).toMatchObject({ entryIds: [11, 12] });
      // One rep, one payout: no repId mixing in the batch.
      const ids = (post!.body as { entryIds: number[] }).entryIds;
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});

describe('Settings performance metrics', () => {
  it('lists metric types and adds a new one with its unit', async () => {
    login('ADMIN');
    const requests = mockFetch({
      // Order matters: the more specific path must come first.
      '/api/workspaces/settings': { body: { leaderboardShowNames: false } },
      '/api/workspaces/branding': { body: { logoUrl: null, accentColor: null, customDomain: null } },
      '/api/workspaces': { body: [{ id: 1, name: 'Acme', slug: 'acme', role: 'ADMIN' }] },
      '/api/billing/subscription': {
        body: {
          planCode: 'free',
          planName: 'Free',
          status: 'TRIALING',
          trialEndsAt: null,
          currentPeriodEnd: null,
          provider: null,
        },
      },
      '/api/billing/plans': { body: [] },
      '/api/discord/settings': {
        body: { connected: false, guildId: null, notificationChannelId: null, roleMap: {} },
      },
      '/api/metric-types': [
        { method: 'GET', body: METRICS },
        { method: 'POST', status: 201, body: { id: 9, name: 'Demos booked', unit: 'count' } },
      ],
    });
    renderPage(<SettingsPage />);

    expect(await screen.findByText('Calls')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Metric name'), 'Demos booked');
    await userEvent.click(screen.getByRole('button', { name: 'Add metric' }));

    await waitFor(() => {
      const post = requests.find(
        (r) => r.method === 'POST' && r.url === '/api/metric-types',
      );
      expect(post).toBeTruthy();
      expect(post!.body).toEqual({ name: 'Demos booked', unit: 'count' });
    });
  });
});
