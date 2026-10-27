/**
 * Deterministic mock API for the visual-regression harness.
 *
 * The stub mirrors `request()`'s contract in api.ts: path-prefix match, optional
 * method match, and the `{status, code, message, details}` error envelope for
 * unrouted paths. All fixtures are static (no clocks, no randomness) so the
 * rendered pages screenshot identically across runs.
 */

type Body = unknown;

export interface MockRoute {
  status?: number;
  body: Body;
  method?: string;
}

export type MockTable = Record<string, MockRoute | MockRoute[]>;

/** Installs the stub on `window.fetch`; returns nothing (read-only harness). */
export function installMockFetch(table: MockTable): void {
  const stub = (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();

    const match = Object.entries(table)
      .map(([prefix, value]) => [prefix, Array.isArray(value) ? value : [value]] as const)
      .find(
        ([prefix, routes]) =>
          url.startsWith(prefix) &&
          routes.some((r) => !r.method || r.method.toUpperCase() === method),
      );

    if (!match) {
      return Promise.resolve(
        json({ status: 404, code: 'NOT_FOUND', message: `no mock for ${method} ${url}` }, 404),
      );
    }

    const routes = match[1];
    const chosen =
      routes.find((r) => !r.method || r.method.toUpperCase() === method) ?? routes[0];
    const status = chosen.status ?? 200;
    return Promise.resolve(
      status === 204 ? new Response(null, { status: 204 }) : json(chosen.body, status),
    );
  };
  window.fetch = stub as unknown as typeof fetch;
}

function json(body: Body, status: number): Response {
  return new Response(JSON.stringify(body ?? null), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ------------------------------------------------------------------ fixtures

/** The one workspace every mocked page belongs to. */
export const MOCK_WORKSPACE = {
  id: 1,
  name: 'Demo Agency',
  slug: 'demo-agency',
  role: 'OWNER' as const,
};

const VERTICALS = [
  { id: 1, name: 'Sales' },
  { id: 2, name: 'Advertising' },
  { id: 3, name: 'Partnerships' },
];

const STATUSES = [
  { id: 1, name: 'Bench', kind: 'BENCH' as const },
  { id: 2, name: 'Training', kind: 'TRAINING' as const },
  { id: 3, name: 'Inactive', kind: 'INACTIVE' as const },
];

const LEVELS = [
  { id: 1, name: 'Junior' },
  { id: 2, name: 'Mid' },
  { id: 3, name: 'Senior' },
];

const REPS = [
  {
    id: 1,
    name: 'Amara Okafor',
    email: 'amara@example.test',
    discordUserId: null,
    verticalId: 1,
    verticalName: 'Sales',
    statusId: 1,
    statusName: 'Bench',
    statusKind: 'BENCH',
    experienceLevelId: 3,
    experienceLevelName: 'Senior',
    notes: 'Enterprise closer, 8 years.',
    joinedDate: '2026-08-12',
    placed: true,
    offerId: 5,
    offerTitle: 'Enterprise AE',
    clientName: 'Northwind Retail',
    benchDays: null,
  },
  {
    id: 2,
    name: 'Diego Ramirez',
    email: 'diego@example.test',
    discordUserId: null,
    verticalId: 1,
    verticalName: 'Sales',
    statusId: 1,
    statusName: 'Bench',
    statusKind: 'BENCH',
    experienceLevelId: 2,
    experienceLevelName: 'Mid',
    notes: 'Strong outbound SDR background.',
    joinedDate: '2026-07-28',
    placed: false,
    offerId: null,
    offerTitle: null,
    clientName: null,
    benchDays: 14,
  },
  {
    id: 3,
    name: 'Priya Nair',
    email: 'priya@example.test',
    discordUserId: null,
    verticalId: 1,
    verticalName: 'Sales',
    statusId: 2,
    statusName: 'Training',
    statusKind: 'TRAINING',
    experienceLevelId: 1,
    experienceLevelName: 'Junior',
    notes: 'Newest rep, ramping on CRM.',
    joinedDate: '2026-09-30',
    placed: false,
    offerId: null,
    offerTitle: null,
    clientName: null,
    benchDays: 3,
  },
];

const OFFERS = [
  {
    id: 5,
    clientId: 1,
    clientName: 'Northwind Retail',
    verticalId: 1,
    verticalName: 'Sales',
    title: 'Enterprise AE',
    seats: 2,
    filledSeats: 1,
    notes: 'Quota-carrying AE for the retail book.',
    opensAt: null,
    closesAt: null,
    status: 'OPEN' as const,
    effectiveStatus: 'OPEN' as const,
    reps: [{ repId: 1, repName: 'Amara Okafor' }],
    requiredLevelName: 'Mid',
    requiredLanguage: 'English',
    requiredSkills: ['closing', 'CRM'],
    stageId: 2,
    stageName: 'Interviewing',
  },
  {
    id: 8,
    clientId: 5,
    clientName: 'Lumen Media',
    verticalId: 2,
    verticalName: 'Advertising',
    title: 'Growth Marketer',
    seats: 3,
    filledSeats: 3,
    notes: 'Paid acquisition across social.',
    opensAt: null,
    closesAt: null,
    status: 'OPEN' as const,
    effectiveStatus: 'FILLED' as const,
    reps: [{ repId: 2, repName: 'Diego Ramirez' }],
    requiredLevelName: 'Mid',
    requiredLanguage: null,
    requiredSkills: ['paid social'],
    stageId: 4,
    stageName: 'Live',
  },
];

const STAGES = [
  { id: 1, name: 'Sourcing', position: 1 },
  { id: 2, name: 'Interviewing', position: 2 },
  { id: 3, name: 'Onboarding', position: 3 },
  { id: 4, name: 'Live', position: 4 },
];

const BOARD = [
  {
    stage: STAGES[0],
    offers: [OFFERS[0]],
  },
  { stage: STAGES[1], offers: [] },
  { stage: STAGES[2], offers: [] },
  { stage: STAGES[3], offers: [OFFERS[1]] },
];

const STATS = { totalReps: 3, benchCount: 2, placedCount: 1, openOffers: 2 };

const REPORTS = {
  placementRate: { placedReps: 1, totalReps: 3, rate: 0.33 },
  averageBenchDays: 8.5,
  benchSamples: 2,
  placementsPerOffer: [
    {
      offerId: 5,
      title: 'Enterprise AE',
      clientName: 'Northwind Retail',
      totalPlacements: 1,
      activePlacements: 1,
    },
    {
      offerId: 8,
      title: 'Growth Marketer',
      clientName: 'Lumen Media',
      totalPlacements: 1,
      activePlacements: 1,
    },
  ],
  verticals: [
    { verticalId: 1, name: 'Sales', reps: 2, placedReps: 1 },
    { verticalId: 2, name: 'Advertising', reps: 1, placedReps: 0 },
    { verticalId: 3, name: 'Partnerships', reps: 0, placedReps: 0 },
  ],
};

const BRANDING = { logoUrl: null, accentColor: null, customDomain: null };

const PLANS = [
  { code: 'free', name: 'Free', maxReps: 10, maxMembers: 3, current: true },
  { code: 'starter', name: 'Starter', maxReps: 50, maxMembers: 10, current: false },
  { code: 'pro', name: 'Pro', maxReps: 250, maxMembers: 50, current: false },
];

const SUBSCRIPTION = {
  planCode: 'free',
  planName: 'Free',
  status: 'TRIALING' as const,
  trialEndsAt: '2026-11-06',
  currentPeriodEnd: null,
  provider: null,
};

/**
 * The mock table. Prefix matching is first-wins, so more specific prefixes
 * (e.g. `/api/pipeline/board`) are declared before broader ones (`/api/offers`).
 */
export const MOCK_ROUTES: MockTable = {
  '/api/auth/me': { body: { id: 1, email: 'demo@example.test', displayName: 'Demo Owner' } },
  '/api/workspaces/branding': { body: BRANDING },
  '/api/workspaces': { body: [MOCK_WORKSPACE] },
  '/api/verticals': { body: VERTICALS },
  '/api/statuses': { body: STATUSES },
  '/api/experience-levels': { body: LEVELS },
  '/api/stats': { body: STATS },
  '/api/reports': { body: REPORTS },
  '/api/digest': {
    body: {
      id: 1,
      weekStart: '2026-10-19',
      body:
        'Weekly digest — Demo Agency\n'
        + 'Week of 2026-10-19\n'
        + 'Activity: 8 active members · 5 pod check-ins\n'
        + 'New members: Priya Raman\n'
        + 'Top contributors: Dana Scott (12), Priya Raman (7)\n'
        + 'Pipeline: 6 open offers · 3 bookings (last 7d) · 2 pending intro requests',
      generatedAt: '2026-10-19T08:00:00',
    },
  },
  '/api/pipeline/board': { body: BOARD },
  '/api/pipeline/stages': { body: STAGES },
  '/api/clients': {
    body: [
      { id: 1, name: 'Northwind Retail', contactEmail: null, notes: null },
      { id: 5, name: 'Lumen Media', contactEmail: null, notes: null },
    ],
  },
  '/api/offers': { body: OFFERS },
  '/api/reps': {
    body: { page: 0, size: 25, total: REPS.length, items: REPS },
  },
  '/api/billing/plans': { body: PLANS },
  '/api/billing/subscription': { body: SUBSCRIPTION },
  '/api/office-hours/slots/mine': { body: [] },
  '/api/office-hours/slots': {
    body: [
      {
        id: 1,
        expertUserId: 9,
        expertName: 'Sofia Almeida',
        startsAt: '2026-10-27T15:00:00Z',
        durationMinutes: 45,
        priceMinor: 7500,
        currency: 'USD',
        status: 'OPEN' as const,
      },
    ],
  },
  '/api/office-hours/bookings': { body: { asMember: [], asExpert: [] } },
  '/api/office-hours/experts': {
    body: [{ userId: 9, displayName: 'Sofia Almeida', expert: true }],
  },
  '/api/office-hours/commission': { body: { commissionBp: 1000 } },
  '/api/office-hours/payouts': { body: [] },
};
