import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import OffersPage from '../pages/OffersPage';
import RosterPage from '../pages/RosterPage';
import { setActiveWorkspaceId, setAuthToken } from '../api';
import { mockFetch } from './setup';

/**
 * Phase 6 — skills, profiles & smart matching on the UI:
 *  - roster filters by skill, language and availability (query params travel
 *    to the API and drive the list),
 *  - the rep edit form round-trips the expanded profile (skills, languages,
 *    preferred verticals, timezone, hours, availability date),
 *  - the offer form saves requirements (skills, level, language, timezone
 *    window as UTC minutes, start date),
 *  - the "Suggested reps" panel renders scores + the per-factor why and one
 *    click places through POST /api/placements.
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

function login() {
  setAuthToken('jwt-token-123');
  setActiveWorkspaceId(1);
  localStorage.setItem('roster.workspace', '1');
}

type Routes = Parameters<typeof mockFetch>[0];

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
    experienceLevelId: 11,
    experienceLevelName: 'Senior',
    notes: null,
    joinedDate: '2026-01-05',
    placed: false,
    offerId: null,
    offerTitle: null,
    clientName: null,
    benchDays: 5,
    bio: null,
    timezone: null,
    hoursPerWeek: null,
    availableFrom: null,
    skills: ['Cold Calling'],
    languages: ['English'],
    preferredVerticalIds: [],
    hasPhoto: false,
    ...overrides,
  };
}

function rosterRoutes(items: unknown[]): Routes {
  return {
    '/api/stats': {
      body: { totalReps: items.length, benchCount: items.length, placedCount: 0, openOffers: 1 },
    },
    '/api/verticals': { body: [{ id: 1, name: 'Sales' }, { id: 2, name: 'Advertising' }] },
    '/api/statuses': { body: [{ id: 1, name: 'Bench', kind: 'BENCH' }] },
    '/api/experience-levels': {
      body: [{ id: 11, name: 'Junior' }, { id: 12, name: 'Mid' }, { id: 13, name: 'Senior' }],
    },
    '/api/skills': { body: [{ id: 9, name: 'Enterprise Selling' }, { id: 10, name: 'Cold Calling' }] },
    '/api/languages': { body: ['English', 'Spanish'] },
    '/api/reps/export': { body: 'name,email\nDana Scott,dana@example.test\n' },
    // Specific route first: PUT /api/reps/5 must not fall into the list route.
    '/api/reps/5': { method: 'PUT', status: 200, body: rep({ name: 'Dana Scott' }) },
    '/api/reps': { body: { page: 0, size: 20, total: items.length, items } },
  };
}

describe('RosterPage Phase 6 filters', () => {
  it('filters by skill, language and availability together', async () => {
    login();
    const requests = mockFetch(rosterRoutes([rep({})]));
    renderPage(<RosterPage />);
    await screen.findByText('Dana Scott');

    // By skill (tag id from /api/skills).
    await userEvent.click(screen.getByRole('button', { name: 'Enterprise Selling' }));
    await waitFor(() =>
      expect(requests.some((r) => r.url.startsWith('/api/reps?') && r.url.includes('skillId=9'))).toBe(true),
    );

    // By language (chip from /api/languages).
    await userEvent.click(screen.getByRole('button', { name: 'Spanish' }));
    await waitFor(() =>
      expect(requests.some((r) => r.url.includes('language=Spanish'))).toBe(true),
    );

    // By availability.
    await userEvent.click(screen.getByRole('button', { name: 'Available now' }));
    await waitFor(() =>
      expect(requests.some((r) => r.url.includes('available=true'))).toBe(true),
    );

    // The workspace header still rides along on every filtered call.
    const filtered = requests.filter((r) => r.url.startsWith('/api/reps?'));
    const last = filtered[filtered.length - 1];
    expect(last.headers['X-Workspace']).toBe('1');
    expect(last.headers['Authorization']).toBe('Bearer jwt-token-123');

    // Clearing restores an unfiltered list request.
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() =>
      expect(requests.some((r) => r.url === '/api/reps')).toBe(true),
    );
  });
});

describe('RosterPage rep profile form (Phase 6)', () => {
  it('saves skills, languages, preferred verticals, timezone, hours and date', async () => {
    login();
    const requests = mockFetch(rosterRoutes([rep({})]));
    renderPage(<RosterPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await screen.findByLabelText('Skills');

    fireEvent.change(screen.getByLabelText('Skills'), {
      target: { value: 'Java, SQL' },
    });
    fireEvent.change(screen.getByLabelText('Languages'), {
      target: { value: 'English, Spanish' },
    });
    fireEvent.change(screen.getByLabelText('Timezone'), {
      target: { value: 'Europe/Berlin' },
    });
    fireEvent.change(screen.getByLabelText('Hours / week'), {
      target: { value: '25' },
    });
    fireEvent.change(screen.getByLabelText('Available from'), {
      target: { value: '2026-05-01' },
    });
    fireEvent.change(screen.getByLabelText('Bio'), {
      target: { value: 'Enterprise closer.' },
    });

    // Preferred vertical: toggle "Advertising" inside the modal's own field.
    const prefField = screen.getByText('Preferred verticals').closest('.field')!;
    await userEvent.click(within(prefField as HTMLElement).getByText('Advertising'));

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const put = requests.find((r) => r.url === '/api/reps/5' && r.method === 'PUT');
      expect(put).toBeDefined();
      const body = put!.body as Record<string, unknown>;
      expect(body.skills).toEqual(['Java', 'SQL']);
      expect(body.languages).toEqual(['English', 'Spanish']);
      expect(body.timezone).toBe('Europe/Berlin');
      expect(body.hoursPerWeek).toBe(25);
      expect(body.availableFrom).toBe('2026-05-01');
      expect(body.bio).toBe('Enterprise closer.');
      expect(body.preferredVerticalIds).toEqual([2]);
      expect(put!.headers['X-Workspace']).toBe('1');
    });
  });
});

// ---------------------------------------------------------------------------

const factorSet = [
  { key: 'vertical', label: 'Vertical', weight: 20, points: 20, applicable: true, detail: 'Matches the rep\'s vertical' },
  { key: 'skills', label: 'Skills', weight: 24, points: 12, applicable: true, detail: 'Missing: sql (1/2)' },
  { key: 'experience', label: 'Experience', weight: 16, points: 16, applicable: true, detail: 'Meets or exceeds the required level' },
  { key: 'language', label: 'Language', weight: 8, points: 8, applicable: true, detail: 'Speaks English' },
  { key: 'timezone', label: 'Timezone', weight: 8, points: 8, applicable: true, detail: 'Works 08:00–17:00 UTC' },
  { key: 'availability', label: 'Availability', weight: 16, points: 16, applicable: true, detail: 'Available immediately' },
  { key: 'performance', label: 'Performance', weight: 8, points: 0, applicable: false, detail: 'No performance data yet (Phase 7)' },
];

function offerCard(overrides: Partial<Record<string, unknown>>) {
  return {
    id: 7,
    clientId: 5,
    clientName: 'Acme',
    verticalId: 1,
    verticalName: 'Sales',
    title: 'Backend AE',
    seats: 2,
    filledSeats: 0,
    notes: null,
    opensAt: null,
    closesAt: null,
    status: 'OPEN',
    effectiveStatus: 'OPEN',
    reps: [],
    requiredLevelId: 13,
    requiredLevelName: 'Senior',
    requiredLanguage: 'English',
    tzWindowStart: 480,
    tzWindowEnd: 1020,
    startDate: '2026-05-01',
    requiredSkills: ['Java', 'Cold Calling'],
    ...overrides,
  };
}

const suggestedBody = [
  {
    repId: 3,
    repName: 'Strong Contender',
    email: 'strong@example.test',
    verticalName: 'Sales',
    experienceLevelName: 'Senior',
    statusName: 'Bench',
    benchDays: 4,
    hoursPerWeek: 40,
    timezone: 'Europe/Berlin',
    score: 92,
    factors: factorSet,
  },
  {
    repId: 4,
    repName: 'Weak Contender',
    email: 'weak@example.test',
    verticalName: 'Advertising',
    experienceLevelName: null,
    statusName: 'Bench',
    benchDays: 40,
    hoursPerWeek: 10,
    timezone: null,
    score: 41,
    factors: factorSet.map((f) => ({ ...f, points: 0, applicable: f.key !== 'availability' })),
  },
];

function offerRoutes(list: unknown[]): Routes {
  return {
    // Specific route first: /api/offers/{id}/suggested must not fall into
    // the /api/offers list route (prefix match).
    '/api/offers/7/suggested': { body: suggestedBody },
    '/api/clients': { body: [{ id: 5, name: 'Acme' }] },
    '/api/verticals': { body: [{ id: 1, name: 'Sales' }, { id: 2, name: 'Advertising' }] },
    '/api/experience-levels': {
      body: [{ id: 11, name: 'Junior' }, { id: 12, name: 'Mid' }, { id: 13, name: 'Senior' }],
    },
    '/api/skills': { body: [{ id: 9, name: 'Java' }, { id: 10, name: 'Cold Calling' }] },
    '/api/languages': { body: ['English'] },
    '/api/placements': {
      method: 'POST',
      status: 201,
      body: { id: 77, offerId: 7, repId: 3, status: 'ACTIVE' },
    },
    '/api/offers': { body: list },
  };
}

describe('OffersPage Suggested reps panel', () => {
  it('shows ranked scores with the why breakdown and places with one click', async () => {
    login();
    const requests = mockFetch(offerRoutes([offerCard({})]));
    renderPage(<OffersPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Suggested reps' }));

    // Scores and ranking are visible.
    expect(await screen.findByText('92')).toBeInTheDocument();
    expect(screen.getByText('41')).toBeInTheDocument();
    expect(screen.getByText('Strong Contender')).toBeInTheDocument();

    // Why: every factor with label, points/weight and the detail text.
    expect(screen.getAllByText('Skills').length).toBeGreaterThan(0);
    expect(screen.getAllByText('12/24').length).toBe(1); // strong row only
    expect(screen.getAllByText('0/24').length).toBe(1); // weak row got nothing
    expect(screen.getAllByText('Missing: sql (1/2)').length).toBe(2);
    expect(screen.getAllByText('No performance data yet (Phase 7)').length).toBe(2);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0); // n/a factor

    // One-click place → the normal placements endpoint (its rules apply).
    const [placeButton] = screen.getAllByRole('button', { name: 'Place' });
    await userEvent.click(placeButton);

    await waitFor(() => {
      const post = requests.find(
        (r) => r.url === '/api/placements' && r.method === 'POST',
      );
      expect(post).toBeDefined();
      expect(post!.body).toEqual({ offerId: 7, repId: 3 });
    });
  });

  it('shows requirement chips on the card so the needs are visible', async () => {
    login();
    mockFetch(offerRoutes([offerCard({})]));
    renderPage(<OffersPage />);

    expect(await screen.findByText(/Needs: Java, Cold Calling/)).toBeInTheDocument();
    expect(screen.getByText('Senior+')).toBeInTheDocument();
    expect(screen.getByText('Speaks English')).toBeInTheDocument();
    expect(screen.getByText('UTC 08:00–17:00')).toBeInTheDocument();
    expect(screen.getByText('Starts 2026-05-01')).toBeInTheDocument();
  });
});

describe('OffersPage requirement form', () => {
  it('saves skills, level, language, timezone window and start date', async () => {
    login();
    const requests = mockFetch(offerRoutes([]));
    renderPage(<OffersPage />);

    await userEvent.click(await screen.findByRole('button', { name: '+ New offer' }));
    await screen.findByLabelText('Required skills');

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Backend AE' } });
    await userEvent.selectOptions(screen.getByLabelText('Client'), '5');
    fireEvent.change(screen.getByLabelText('Required skills'), {
      target: { value: 'Java, Outbound' },
    });
    await userEvent.selectOptions(screen.getByLabelText('Required experience'), '13');
    fireEvent.change(screen.getByLabelText('Required language'), {
      target: { value: 'English' },
    });
    fireEvent.change(screen.getByLabelText('Window start (UTC)'), {
      target: { value: '08:00' },
    });
    fireEvent.change(screen.getByLabelText('Window end (UTC)'), {
      target: { value: '17:00' },
    });
    fireEvent.change(screen.getByLabelText('Start date'), {
      target: { value: '2026-05-01' },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const post = requests.find(
        (r) => r.url === '/api/offers' && r.method === 'POST',
      );
      expect(post).toBeDefined();
      const body = post!.body as Record<string, unknown>;
      expect(body.title).toBe('Backend AE');
      expect(body.clientId).toBe(5);
      expect(body.requiredSkills).toEqual(['Java', 'Outbound']);
      expect(body.requiredLevelId).toBe(13);
      expect(body.requiredLanguage).toBe('English');
      expect(body.tzWindowStart).toBe(480); // 08:00 UTC in minutes
      expect(body.tzWindowEnd).toBe(1020); // 17:00 UTC in minutes
      expect(body.startDate).toBe('2026-05-01');
    });
  });
});