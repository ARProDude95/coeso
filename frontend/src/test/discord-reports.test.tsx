import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import AuthDiscordPage from '../pages/AuthDiscordPage';
import LoginPage from '../pages/LoginPage';
import ReportsPage from '../pages/ReportsPage';
import SettingsPage from '../pages/SettingsPage';
import { setActiveWorkspaceId, setAuthToken } from '../api';
import { mockFetch } from './setup';

// mockFetch matches by URL PREFIX, so longer paths must come first in routes
// (e.g. /api/workspaces/branding before /api/workspaces).

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

const reportsBody = {
  placementRate: { placedReps: 3, totalReps: 5, rate: 0.6 },
  averageBenchDays: 12.5,
  benchSamples: 4,
  placementsPerOffer: [
    {
      offerId: 1,
      title: 'AE — Acme',
      clientName: 'Acme',
      totalPlacements: 2,
      activePlacements: 1,
    },
  ],
  verticals: [
    { verticalId: 1, name: 'Sales', reps: 4, placedReps: 3 },
    { verticalId: null, name: 'Uncategorised', reps: 1, placedReps: 0 },
  ],
};

describe('ReportsPage', () => {
  it('renders placement rate, bench time and breakdowns from the API', async () => {
    login();
    mockFetch({ '/api/reports': { body: reportsBody } });
    renderPage(<ReportsPage />);

    expect(await screen.findByText('60%')).toBeInTheDocument();
    expect(screen.getByText('3/5')).toBeInTheDocument();
    expect(screen.getByText('12.5d')).toBeInTheDocument();
    expect(screen.getByText('AE — Acme')).toBeInTheDocument();
    expect(screen.getByText('1/2 placed')).toBeInTheDocument();
    expect(screen.getByText('Sales')).toBeInTheDocument();
    expect(screen.getByText('Uncategorised')).toBeInTheDocument();
  });
});

describe('AuthDiscordPage', () => {
  it('exchanges the OAuth code and stores the session', async () => {
    // Fresh browser: no session yet (module-level token state persists across
    // tests, so reset it explicitly).
    setAuthToken(null);
    const requests = mockFetch({
      '/api/auth/discord': {
        body: {
          token: 'discord-jwt',
          user: { id: 9, email: 'dx@example.test', displayName: 'DX' },
        },
      },
    });
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/auth/discord?code=oauth-code-1']}>
          <AuthDiscordPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(localStorage.getItem('roster.token')).toBe('discord-jwt');
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('/api/auth/discord');
    expect(requests[0].method).toBe('POST');
    expect(requests[0].body).toEqual({ code: 'oauth-code-1' });
    // No token header on the exchange itself (the code is the credential).
    expect(requests[0].headers['Authorization']).toBeUndefined();
  });

  it('shows an error when the code is missing', async () => {
    mockFetch({});
    renderPage(<AuthDiscordPage />);
    expect(
      await screen.findByText('Discord did not return an authorization code.'),
    ).toBeInTheDocument();
  });
});

describe('LoginPage Discord button', () => {
  it('reports a clear message when Discord is not configured (503)', async () => {
    const requests = mockFetch({
      '/api/auth/discord/url': {
        status: 503,
        body: { status: 503, code: 'DISCORD_NOT_CONFIGURED', message: 'not configured' },
      },
    });
    renderPage(<LoginPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Continue with Discord' }));

    expect(
      await screen.findByText('Discord login is not configured on this server.'),
    ).toBeInTheDocument();
    expect(requests.some((r) => r.url === '/api/auth/discord/url')).toBe(true);
  });
});

describe('SettingsPage Discord section', () => {
  it('saves the guild, channel and role map', async () => {
    login();
    const requests = mockFetch({
      '/api/workspaces': {
        body: [{ id: 1, name: 'Acme', slug: 'acme', role: 'ADMIN' }],
      },
      '/api/discord/settings': {
        body: {
          connected: false,
          guildId: null,
          notificationChannelId: null,
          roleMap: {},
        },
      },
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
      '/api/workspaces/branding': {
        body: { logoUrl: null, accentColor: null, customDomain: null },
      },
      '/api/verticals': { body: [] },
      '/api/statuses': { body: [] },
      '/api/experience-levels': { body: [] },
    });
    renderPage(<SettingsPage />);

    await userEvent.type(await screen.findByLabelText('Guild (server) ID'), '111222333');
    await userEvent.type(screen.getByLabelText('Notification channel ID'), '444555666');
    await userEvent.click(screen.getByRole('button', { name: '+ Add mapping' }));
    await userEvent.type(screen.getByLabelText('Discord role ID'), '999888777');
    await userEvent.click(screen.getByRole('button', { name: 'Save Discord settings' }));

    await waitFor(() => {
      const put = requests.find(
        (r) => r.url === '/api/discord/settings' && r.method === 'PUT',
      );
      expect(put).toBeDefined();
      expect(put?.body).toEqual({
        guildId: '111222333',
        notificationChannelId: '444555666',
        roleMap: { '999888777': 'MANAGER' },
      });
    });
  });

  it('saves branding through PUT', async () => {
    login();
    const requests = mockFetch({
      // Longer prefix first: mockFetch resolves routes by startsWith order.
      '/api/workspaces/branding': {
        body: { logoUrl: null, accentColor: '#cda35a', customDomain: null },
      },
      '/api/workspaces': {
        body: [{ id: 1, name: 'Acme', slug: 'acme', role: 'ADMIN' }],
      },
      '/api/discord/settings': {
        body: { connected: false, guildId: null, notificationChannelId: null, roleMap: {} },
      },
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
      '/api/verticals': { body: [] },
      '/api/statuses': { body: [] },
      '/api/experience-levels': { body: [] },
    });
    renderPage(<SettingsPage />);

    const accent = await screen.findByLabelText('Accent color (hex)');
    await waitFor(() => expect(accent).toHaveValue('#cda35a'));
    await userEvent.clear(accent);
    await userEvent.type(accent, '#123456');
    await userEvent.click(screen.getByRole('button', { name: 'Save branding' }));

    await waitFor(() => {
      const put = requests.find(
        (r) => r.url === '/api/workspaces/branding' && r.method === 'PUT',
      );
      expect(put?.body).toEqual({
        logoUrl: null,
        accentColor: '#123456',
        customDomain: null,
      });
    });
  });
});
