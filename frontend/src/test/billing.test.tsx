import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import PricingPage from '../pages/PricingPage';
import SettingsPage from '../pages/SettingsPage';
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

const plansBody = [
  { code: 'free', name: 'Free', maxReps: 10, maxMembers: 3, current: true },
  { code: 'starter', name: 'Starter', maxReps: 50, maxMembers: 10, current: false },
  { code: 'pro', name: 'Pro', maxReps: 250, maxMembers: 50, current: false },
  { code: 'unlimited', name: 'Unlimited', maxReps: null, maxMembers: null, current: false },
];

function login() {
  setAuthToken('jwt-token-123');
  setActiveWorkspaceId(1);
  // selectedWorkspaceId() reads the persisted workspace key, so the owner gate
  // in Settings resolves the role for workspace 1.
  localStorage.setItem('roster.workspace', '1');
}

describe('PricingPage', () => {
  it('lists every plan with limits and flags the current one', async () => {
    login();
    mockFetch({ '/api/billing/plans': { body: plansBody } });
    renderPage(<PricingPage />);

    expect(await screen.findByText('Free')).toBeInTheDocument();
    expect(screen.getByText('Starter')).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('Unlimited')).toBeInTheDocument();
    // limits render; null means unlimited. '10' appears twice (free reps,
    // starter members), so match all of them.
    expect(screen.getAllByText('10')).toHaveLength(2);
    expect(screen.getAllByText('∞')).toHaveLength(2);
    // exactly one plan carries the current badge
    expect(screen.getByText('Current plan')).toBeInTheDocument();
  });
});

describe('SettingsPage billing section', () => {
  it('shows plan actions to the owner and posts a plan switch', async () => {
    login();
    const requests = mockFetch({
      '/api/workspaces': {
        body: [{ id: 1, name: 'Acme', slug: 'acme', role: 'OWNER' }],
      },
      '/api/billing/subscription': {
        body: {
          planCode: 'free',
          planName: 'Free',
          status: 'TRIALING',
          trialEndsAt: '2026-10-26T10:00:00',
          currentPeriodEnd: null,
          provider: null,
        },
      },
      '/api/billing/plans': { body: plansBody },
      '/api/verticals': { body: [] },
      '/api/statuses': { body: [] },
      '/api/experience-levels': { body: [] },
    });
    renderPage(<SettingsPage />);

    // subscription status is shown
    expect(await screen.findByText('TRIALING')).toBeInTheDocument();

    // Owner sees actions on the three non-current paid plans: each gets both
    // Upgrade (hosted checkout) and Switch (no-payment path).
    const upgradeButtons = await screen.findAllByRole('button', { name: 'Upgrade' });
    expect(upgradeButtons).toHaveLength(3); // starter, pro, unlimited
    const switchButtons = screen.getAllByRole('button', { name: 'Switch' });
    expect(switchButtons).toHaveLength(3);

    // switching hits /api/billing/plan with the plan code (free is current,
    // so the first switchable card is starter)
    await userEvent.click(switchButtons[0]);
    await waitFor(() => {
      const call = requests.find((r) => r.url === '/api/billing/plan');
      expect(call).toBeDefined();
      expect(call?.method).toBe('POST');
      expect(call?.headers['X-Workspace']).toBe('1');
      expect(call?.body).toEqual({ planCode: 'starter' });
    });
  });

  it('hides plan actions from non-owners and surfaces a 409 downgrade block', async () => {
    login();
    mockFetch({
      '/api/workspaces': {
        body: [{ id: 1, name: 'Acme', slug: 'acme', role: 'ADMIN' }],
      },
      '/api/billing/subscription': {
        body: {
          planCode: 'pro',
          planName: 'Pro',
          status: 'ACTIVE',
          trialEndsAt: null,
          currentPeriodEnd: null,
          provider: 'stripe',
        },
      },
      '/api/billing/plans': { body: plansBody },
      '/api/verticals': { body: [] },
      '/api/statuses': { body: [] },
      '/api/experience-levels': { body: [] },
    });
    renderPage(<SettingsPage />);

    // admin is not the owner: no action buttons, explanatory note instead
    expect(await screen.findByText('Only the workspace owner can change plans.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upgrade' })).not.toBeInTheDocument();
  });

  it('renders the blocked-downgrade message from a 409 response', async () => {
    login();
    mockFetch({
      '/api/workspaces': {
        body: [{ id: 1, name: 'Acme', slug: 'acme', role: 'OWNER' }],
      },
      '/api/billing/subscription': {
        body: {
          planCode: 'pro',
          planName: 'Pro',
          status: 'ACTIVE',
          trialEndsAt: null,
          currentPeriodEnd: null,
          provider: 'stripe',
        },
      },
      '/api/billing/plans': { body: plansBody },
      '/api/billing/plan': {
        status: 409,
        body: {
          status: 409,
          code: 'CONFLICT',
          message:
            'Cannot switch to the free plan: it allows 10 reps but the workspace currently has 60.',
        },
      },
      '/api/verticals': { body: [] },
      '/api/statuses': { body: [] },
      '/api/experience-levels': { body: [] },
    });
    renderPage(<SettingsPage />);

    const switchButtons = await screen.findAllByRole('button', { name: 'Switch' });
    await userEvent.click(switchButtons[0]);
    expect(
      await screen.findByText(/Cannot switch to the free plan/),
    ).toBeInTheDocument();
  });
});
