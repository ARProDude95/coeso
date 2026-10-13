// Typed API client. Every workspace-scoped call carries the active workspace
// as X-Workspace — the value comes from the user's own membership list, never
// from anything a page invents.

export interface ApiErrorBody {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown> | null;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown> | null;

  constructor(status: number, code: string, message: string,
              details?: Record<string, unknown> | null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface UserResponse {
  id: number;
  email: string;
  displayName: string;
}

export interface AuthResponse {
  token: string;
  user: UserResponse;
}

export interface WorkspaceSummary {
  id: number;
  name: string;
  slug: string;
  role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'REP';
}

export interface WorkspaceResponse {
  id: number;
  name: string;
  slug: string;
  role: string;
}

export interface Vertical { id: number; name: string }
export interface ExperienceLevel { id: number; name: string }
export interface RepStatus {
  id: number;
  name: string;
  kind: 'BENCH' | 'TRAINING' | 'INACTIVE';
}

export interface Rep {
  id: number;
  name: string;
  email: string | null;
  discordUserId: string | null;
  verticalId: number | null;
  verticalName: string | null;
  statusId: number | null;
  statusName: string | null;
  statusKind: string | null;
  experienceLevelId: number | null;
  experienceLevelName: string | null;
  notes: string | null;
  joinedDate: string | null;
  placed: boolean;
  offerId: number | null;
  offerTitle: string | null;
  clientName: string | null;
}

export interface RepPage {
  page: number;
  size: number;
  total: number;
  items: Rep[];
}

export interface RepInput {
  name: string;
  email?: string | null;
  discordUserId?: string | null;
  verticalId?: number | null;
  statusId?: number | null;
  experienceLevelId?: number | null;
  notes?: string | null;
  joinedDate?: string | null;
}

export interface Client {
  id: number;
  name: string;
  contactEmail: string | null;
  notes: string | null;
}

export interface Offer {
  id: number;
  clientId: number;
  clientName: string | null;
  verticalId: number | null;
  verticalName: string | null;
  title: string;
  seats: number;
  filledSeats: number;
  notes: string | null;
  opensAt: string | null;
  closesAt: string | null;
  status: 'OPEN' | 'CLOSED';
  effectiveStatus: 'OPEN' | 'FILLED' | 'CLOSED';
  reps: { repId: number; repName: string }[];
}

export interface OfferInput {
  clientId: number;
  verticalId?: number | null;
  title: string;
  seats: number;
  notes?: string | null;
  opensAt?: string | null;
  closesAt?: string | null;
}

export interface Placement {
  id: number;
  offerId: number;
  offerTitle: string | null;
  repId: number;
  repName: string | null;
  status: 'ACTIVE' | 'ENDED';
  placedAt: string | null;
  endedAt: string | null;
  endReason: string | null;
}

export interface Stats {
  totalReps: number;
  benchCount: number;
  placedCount: number;
  openOffers: number;
}

export interface RepFilters {
  q?: string;
  verticalId?: number;
  statusId?: number;
  experienceId?: number;
  placed?: boolean;
  page?: number;
  size?: number;
}

export interface OfferFilters {
  q?: string;
  verticalId?: number;
  effectiveStatus?: string;
}

let authToken: string | null = null;
let activeWorkspaceId: number | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function setActiveWorkspaceId(id: number | null): void {
  activeWorkspaceId = id;
}

export function getActiveWorkspaceId(): number | null {
  return activeWorkspaceId;
}

async function request<T>(path: string, options: RequestInit = {},
                          workspaceScoped = true): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  if (workspaceScoped && activeWorkspaceId != null) {
    headers['X-Workspace'] = String(activeWorkspaceId);
  }
  const response = await fetch(path, { ...options, headers });
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!response.ok) {
    const err = (body ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(
      response.status,
      err.code ?? 'UNKNOWN',
      err.message ?? `Request failed with status ${response.status}`,
      err.details,
    );
  }
  return body as T;
}

// ----------------------------------------------------------------------- auth

export function register(email: string, password: string, displayName: string) {
  return request<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName }),
  }, false);
}

export function login(email: string, password: string) {
  return request<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  }, false);
}

export function me() {
  return request<UserResponse>('/api/auth/me', {}, false);
}

// ----------------------------------------------------------------- workspaces

export function listWorkspaces() {
  return request<WorkspaceSummary[]>('/api/workspaces', {}, false);
}

export function createWorkspace(name: string, slug?: string) {
  return request<WorkspaceResponse>('/api/workspaces', {
    method: 'POST',
    body: JSON.stringify(slug ? { name, slug } : { name }),
  }, false);
}

export function deleteWorkspace(id: number) {
  return request<void>(`/api/workspaces/${id}`, { method: 'DELETE' }, false);
}

// ---------------------------------------------------------------------- reps

export function listReps(filters: RepFilters) {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.verticalId != null) params.set('verticalId', String(filters.verticalId));
  if (filters.statusId != null) params.set('statusId', String(filters.statusId));
  if (filters.experienceId != null) params.set('experienceId', String(filters.experienceId));
  if (filters.placed != null) params.set('placed', String(filters.placed));
  if (filters.page != null) params.set('page', String(filters.page));
  if (filters.size != null) params.set('size', String(filters.size));
  const qs = params.toString();
  return request<RepPage>(`/api/reps${qs ? `?${qs}` : ''}`);
}

export function createRep(input: RepInput) {
  return request<Rep>('/api/reps', { method: 'POST', body: JSON.stringify(input) });
}

export function updateRep(id: number, input: RepInput) {
  return request<Rep>(`/api/reps/${id}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function deleteRep(id: number) {
  return request<void>(`/api/reps/${id}`, { method: 'DELETE' });
}

// ------------------------------------------------------------------- clients

export function listClients() {
  return request<Client[]>('/api/clients');
}

export function createClient(name: string) {
  return request<Client>('/api/clients', { method: 'POST', body: JSON.stringify({ name }) });
}

// -------------------------------------------------------------------- offers

export function listOffers(filters: OfferFilters = {}) {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.verticalId != null) params.set('verticalId', String(filters.verticalId));
  if (filters.effectiveStatus) params.set('effectiveStatus', filters.effectiveStatus);
  const qs = params.toString();
  return request<Offer[]>(`/api/offers${qs ? `?${qs}` : ''}`);
}

export function createOffer(input: OfferInput) {
  return request<Offer>('/api/offers', { method: 'POST', body: JSON.stringify(input) });
}

export function updateOffer(id: number, input: OfferInput) {
  return request<Offer>(`/api/offers/${id}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function closeOffer(id: number) {
  return request<Offer>(`/api/offers/${id}/close`, { method: 'POST' });
}

// ---------------------------------------------------------------- placements

export function placeRep(offerId: number, repId: number) {
  return request<Placement>('/api/placements', {
    method: 'POST',
    body: JSON.stringify({ offerId, repId }),
  });
}

export function endPlacement(id: number, reason?: string) {
  return request<Placement>(`/api/placements/${id}/end`, {
    method: 'POST',
    body: JSON.stringify(reason ? { reason } : {}),
  });
}

export function listPlacements(params: { offerId?: number; repId?: number }) {
  const qs = new URLSearchParams();
  if (params.offerId != null) qs.set('offerId', String(params.offerId));
  if (params.repId != null) qs.set('repId', String(params.repId));
  return request<Placement[]>(`/api/placements?${qs.toString()}`);
}

// ------------------------------------------------------------------- lookups

export function listVerticals() {
  return request<Vertical[]>('/api/verticals');
}

export function createVertical(name: string) {
  return request<Vertical>('/api/verticals', { method: 'POST', body: JSON.stringify({ name }) });
}

export function updateVertical(id: number, name: string) {
  return request<Vertical>(`/api/verticals/${id}`, {
    method: 'PUT', body: JSON.stringify({ name }),
  });
}

export function deleteVertical(id: number) {
  return request<void>(`/api/verticals/${id}`, { method: 'DELETE' });
}

export function listStatuses() {
  return request<RepStatus[]>('/api/statuses');
}

export function createStatus(name: string, kind: RepStatus['kind']) {
  return request<RepStatus>('/api/statuses', {
    method: 'POST', body: JSON.stringify({ name, kind }),
  });
}

export function updateStatus(id: number, name: string, kind: RepStatus['kind']) {
  return request<RepStatus>(`/api/statuses/${id}`, {
    method: 'PUT', body: JSON.stringify({ name, kind }),
  });
}

export function deleteStatus(id: number) {
  return request<void>(`/api/statuses/${id}`, { method: 'DELETE' });
}

export function listExperienceLevels() {
  return request<ExperienceLevel[]>('/api/experience-levels');
}

export function createExperienceLevel(name: string) {
  return request<ExperienceLevel>('/api/experience-levels', {
    method: 'POST', body: JSON.stringify({ name }),
  });
}

export function updateExperienceLevel(id: number, name: string) {
  return request<ExperienceLevel>(`/api/experience-levels/${id}`, {
    method: 'PUT', body: JSON.stringify({ name }),
  });
}

export function deleteExperienceLevel(id: number) {
  return request<void>(`/api/experience-levels/${id}`, { method: 'DELETE' });
}

// --------------------------------------------------------------------- stats

export function fetchStats() {
  return request<Stats>('/api/stats');
}

// ------------------------------------------------------------------- billing

export interface Plan {
  code: string;
  name: string;
  maxReps: number | null;
  maxMembers: number | null;
  current: boolean;
}

export interface Subscription {
  planCode: string;
  planName: string;
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED';
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  provider: string | null;
}

export interface CheckoutSession {
  provider: string;
  url: string;
}

export function listPlans() {
  return request<Plan[]>('/api/billing/plans');
}

export function fetchSubscription() {
  return request<Subscription>('/api/billing/subscription');
}

export function startCheckout(planCode: string) {
  return request<CheckoutSession>('/api/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({ planCode }),
  });
}

export function changePlan(planCode: string) {
  return request<Subscription>('/api/billing/plan', {
    method: 'POST',
    body: JSON.stringify({ planCode }),
  });
}

// ------------------------------------------------------------------ discord

export interface DiscordSettings {
  connected: boolean;
  guildId: string | null;
  notificationChannelId: string | null;
  roleMap: Record<string, string>;
}

export function discordAuthorizeUrl() {
  return request<{ url: string }>('/api/auth/discord/url', {}, false);
}

export function discordLogin(code: string) {
  return request<AuthResponse>('/api/auth/discord', {
    method: 'POST',
    body: JSON.stringify({ code }),
  }, false);
}

export function fetchDiscordSettings() {
  return request<DiscordSettings>('/api/discord/settings');
}

export function saveDiscordSettings(input: {
  guildId: string;
  notificationChannelId: string | null;
  roleMap: Record<string, string>;
}) {
  return request<DiscordSettings>('/api/discord/settings', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

// ----------------------------------------------------------------- branding

export interface Branding {
  logoUrl: string | null;
  accentColor: string | null;
  customDomain: string | null;
}

export function fetchBranding() {
  return request<Branding>('/api/workspaces/branding');
}

export function saveBranding(input: Branding) {
  return request<Branding>('/api/workspaces/branding', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

// ------------------------------------------------------------------ reports

export interface Reports {
  placementRate: { placedReps: number; totalReps: number; rate: number };
  averageBenchDays: number | null;
  benchSamples: number;
  placementsPerOffer: {
    offerId: number;
    title: string;
    clientName: string | null;
    totalPlacements: number;
    activePlacements: number;
  }[];
  verticals: {
    verticalId: number | null;
    name: string;
    reps: number;
    placedReps: number;
  }[];
}

export function fetchReports() {
  return request<Reports>('/api/reports');
}
