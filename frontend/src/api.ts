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
  /** Days on the bench (since last ended placement / joined date);
   *  null while placed. */
  benchDays: number | null;
  // Phase 6 profile (optional so older payloads still type-check)
  bio?: string | null;
  timezone?: string | null;
  hoursPerWeek?: number | null;
  availableFrom?: string | null;
  skills?: string[];
  languages?: string[];
  preferredVerticalIds?: number[];
  hasPhoto?: boolean;
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
  // Phase 6 profile
  bio?: string | null;
  timezone?: string | null;
  hoursPerWeek?: number | null;
  availableFrom?: string | null;
  skills?: string[];
  languages?: string[];
  preferredVerticalIds?: number[];
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
  // Phase 6 requirements (undefined on older payloads)
  requiredLevelId?: number | null;
  requiredLevelName?: string | null;
  requiredLanguage?: string | null;
  tzWindowStart?: number | null;
  tzWindowEnd?: number | null;
  startDate?: string | null;
  requiredSkills?: string[];
  // Phase 8 pipeline (undefined on older payloads)
  stageId?: number | null;
  stageName?: string | null;
}

export interface OfferInput {
  clientId: number;
  verticalId?: number | null;
  title: string;
  seats: number;
  notes?: string | null;
  opensAt?: string | null;
  closesAt?: string | null;
  // Phase 6 requirements
  requiredLevelId?: number | null;
  requiredLanguage?: string | null;
  tzWindowStart?: number | null;
  tzWindowEnd?: number | null;
  startDate?: string | null;
  requiredSkills?: string[];
}

/** One factor of the match-score breakdown (points out of weight + the why). */
export interface MatchFactor {
  key: string;
  label: string;
  weight: number;
  points: number;
  applicable: boolean;
  detail: string;
}

/** A rep ranked against an offer's requirements by GET /offers/{id}/suggested. */
export interface SuggestedRep {
  repId: number;
  repName: string;
  email: string | null;
  verticalName: string | null;
  experienceLevelName: string | null;
  statusName: string | null;
  benchDays: number | null;
  hoursPerWeek: number | null;
  timezone: string | null;
  score: number;
  factors: MatchFactor[];
}

export interface RepPhoto {
  photoUrl: string;
  contentType: string;
  sizeBytes: number;
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
  skillId?: number;
  language?: string;
  available?: boolean;
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
  // Multipart uploads must let the browser set the boundary itself.
  const isFormData = options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
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
  if (filters.skillId != null) params.set('skillId', String(filters.skillId));
  if (filters.language) params.set('language', filters.language);
  if (filters.available != null) params.set('available', String(filters.available));
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

/**
 * CSV export honoring the same filters as the list endpoint. The column set
 * matches the CSV import, so an export can be edited and re-imported.
 * Returns the raw CSV text (the caller turns it into a download).
 */
export async function exportRepsCsv(filters: RepFilters = {}): Promise<string> {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.verticalId != null) params.set('verticalId', String(filters.verticalId));
  if (filters.statusId != null) params.set('statusId', String(filters.statusId));
  if (filters.experienceId != null) params.set('experienceId', String(filters.experienceId));
  if (filters.placed != null) params.set('placed', String(filters.placed));
  if (filters.skillId != null) params.set('skillId', String(filters.skillId));
  if (filters.language) params.set('language', filters.language);
  if (filters.available != null) params.set('available', String(filters.available));
  const qs = params.toString();
  const headers: Record<string, string> = {};
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  if (activeWorkspaceId != null) {
    headers['X-Workspace'] = String(activeWorkspaceId);
  }
  const response = await fetch(`/api/reps/export${qs ? `?${qs}` : ''}`, { headers });
  if (!response.ok) {
    throw new ApiError(response.status, 'UNKNOWN',
      `Export failed with status ${response.status}`);
  }
  return response.text();
}

/** Trigger a browser download for generated CSV text. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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

// ------------------------------------------------------------- pipeline (P8)

export interface PipelineStage {
  id: number;
  name: string;
  position: number;
}

/** One column of GET /api/pipeline/board: the stage plus its offers. */
export interface StageBoard {
  stage: PipelineStage;
  offers: Offer[];
}

/** Stage reads are open to every member; writes need admin (server-enforced). */
export function listStages() {
  return request<PipelineStage[]>('/api/pipeline/stages');
}

export function createStage(name: string) {
  return request<PipelineStage>('/api/pipeline/stages', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function renameStage(id: number, name: string) {
  return request<PipelineStage>(`/api/pipeline/stages/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });
}

/** Swaps a column with its neighbour; answers with the full new order. */
export function moveStageColumn(id: number, direction: 'UP' | 'DOWN') {
  return request<PipelineStage[]>(`/api/pipeline/stages/${id}/move`, {
    method: 'POST',
    body: JSON.stringify({ direction }),
  });
}

export function deleteStage(id: number) {
  return request<void>(`/api/pipeline/stages/${id}`, { method: 'DELETE' });
}

/** The kanban board: columns in stage order, offers grouped underneath. */
export function fetchBoard() {
  return request<StageBoard[]>('/api/pipeline/board');
}

/** Moves an offer to another column — the board's drop target or its
 *  keyboard-accessible move select both land here. */
export function moveOfferStage(offerId: number, stageId: number) {
  return request<Offer>(`/api/offers/${offerId}/stage`, {
    method: 'POST',
    body: JSON.stringify({ stageId }),
  });
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

// ---------------------------------------------------- skills & languages (P6)

export interface SkillTag {
  id: number;
  name: string;
}

export function listSkills() {
  return request<SkillTag[]>('/api/skills');
}

export function listLanguages() {
  return request<string[]>('/api/languages');
}

// ---------------------------------------------- suggested reps (match, P6)

export function fetchSuggested(offerId: number, limit = 10) {
  return request<SuggestedRep[]>(`/api/offers/${offerId}/suggested?limit=${limit}`);
}

// ------------------------------------------------------------ profile photo

/**
 * Uploads (replaces) a rep's profile photo. Uses FormData directly so the
 * browser sets the multipart boundary (a JSON content-type would break it).
 */
export function uploadRepPhoto(id: number, file: File): Promise<RepPhoto> {
  const form = new FormData();
  form.append('file', file);
  const headers: Record<string, string> = {};
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  if (activeWorkspaceId != null) {
    headers['X-Workspace'] = String(activeWorkspaceId);
  }
  return request<RepPhoto>(`/api/reps/${id}/photo`, {
    method: 'POST',
    body: form,
  });
}

/**
 * Fetches the stored photo with the session headers (img tags cannot send a
 * Bearer token) and returns an object URL for rendering. Callers should
 * revoke it when done.
 */
export async function fetchRepPhoto(id: number): Promise<string> {
  const headers: Record<string, string> = {};
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  if (activeWorkspaceId != null) {
    headers['X-Workspace'] = String(activeWorkspaceId);
  }
  const response = await fetch(`/api/reps/${id}/photo`, { headers });
  if (!response.ok) {
    throw new ApiError(response.status, 'UNKNOWN', `Photo fetch failed (${response.status})`);
  }
  return URL.createObjectURL(await response.blob());
}

// ------------------------------------------- performance (Phase 7, [PRO])

export interface MetricType {
  id: number;
  name: string;
  unit: 'count' | 'currency';
}

export interface LogPlacement {
  placementId: number;
  offerId: number;
  offerTitle: string;
  repId: number;
  repName: string | null;
}

export interface ActivityEntry {
  id: number;
  placementId: number;
  repId: number;
  repName: string | null;
  offerId: number | null;
  offerTitle: string | null;
  metricTypeId: number;
  metricName: string | null;
  metricUnit: string | null;
  occurredOn: string;
  valueMinor: number;
  notes: string | null;
  loggedBy: number | null;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
}

export interface ActivityPage {
  page: number;
  size: number;
  total: number;
  items: ActivityEntry[];
}

export interface ActivityInput {
  placementId: number;
  metricTypeId: number;
  occurredOn: string;
  valueMinor: number;
  notes?: string | null;
}

export interface CommissionRule {
  id: number;
  offerId: number | null;
  offerTitle: string | null;
  repId: number | null;
  repName: string | null;
  kind: 'percent' | 'flat' | 'tiered';
  rateBp: number | null;
  flatMinor: number | null;
  currency: string | null;
  tiers: { upToMinor: number | null; rateBp: number }[];
}

export interface CommissionRuleInput {
  offerId?: number | null;
  repId?: number | null;
  kind: 'percent' | 'flat' | 'tiered';
  rateBp?: number | null;
  flatMinor?: number | null;
  currency?: string | null;
  tiers?: { upToMinor: number | null; rateBp: number }[];
}

export interface EarningsEntry {
  id: number;
  repId: number;
  repName: string | null;
  placementId: number;
  offerId: number | null;
  offerTitle: string | null;
  activityEntryId: number;
  commissionRuleId: number | null;
  payoutId: number | null;
  reversesEntryId: number | null;
  status: 'accrued' | 'approved' | 'paid';
  amountMinor: number;
  currency: string;
  enteredOn: string;
  createdAt: string;
  reversal: boolean;
}

export interface Earnings {
  total: number;
  netMinor: number;
  currency: string | null;
  items: EarningsEntry[];
}

export interface Payout {
  id: number;
  repId: number;
  repName: string | null;
  amountMinor: number;
  currency: string;
  entryCount: number;
  paidOn: string;
  referenceNote: string | null;
  createdBy: number | null;
  createdAt: string;
}

export interface LeaderRow {
  rank: number;
  repId: number | null;
  repName: string | null;
  value: number;
  self: boolean;
}

export interface Leaderboard {
  period: string;
  metricTypeId: number;
  metricName: string;
  metricUnit: 'count' | 'currency';
  from: string;
  to: string;
  showNames: boolean;
  selfRank: number | null;
  items: LeaderRow[];
}

export interface WorkspaceSettings {
  leaderboardShowNames: boolean;
}

/** True when the backend answered 402 PRO_FEATURE_REQUIRED ([PRO] gate). */
export function isProFeatureError(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'PRO_FEATURE_REQUIRED';
}

export function listMetricTypes() {
  return request<MetricType[]>('/api/metric-types');
}

export function createMetricType(name: string, unit: MetricType['unit']) {
  return request<MetricType>('/api/metric-types', {
    method: 'POST',
    body: JSON.stringify({ name, unit }),
  });
}

export function deleteMetricType(id: number) {
  return request<void>(`/api/metric-types/${id}`, { method: 'DELETE' });
}

export function activityMeta() {
  return request<LogPlacement[]>('/api/activity/meta');
}

export interface ActivityFilters {
  placementId?: number;
  repId?: number;
  metricTypeId?: number;
  from?: string;
  to?: string;
  page?: number;
  size?: number;
}

export function listActivity(filters: ActivityFilters = {}) {
  const params = new URLSearchParams();
  if (filters.placementId != null) params.set('placementId', String(filters.placementId));
  if (filters.repId != null) params.set('repId', String(filters.repId));
  if (filters.metricTypeId != null) params.set('metricTypeId', String(filters.metricTypeId));
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.page != null) params.set('page', String(filters.page));
  if (filters.size != null) params.set('size', String(filters.size));
  const qs = params.toString();
  return request<ActivityPage>(`/api/activity${qs ? `?${qs}` : ''}`);
}

export function createActivity(input: ActivityInput) {
  return request<ActivityEntry>('/api/activity', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateActivity(id: number, patch: Partial<ActivityInput> & { notes?: string | null }) {
  return request<ActivityEntry>(`/api/activity/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export function deleteActivity(id: number) {
  return request<void>(`/api/activity/${id}`, { method: 'DELETE' });
}

export function listCommissionRules() {
  return request<CommissionRule[]>('/api/commission-rules');
}

export function saveCommissionRule(rule: CommissionRuleInput) {
  return request<CommissionRule>('/api/commission-rules', {
    method: 'POST',
    body: JSON.stringify(rule),
  });
}

export function deleteCommissionRule(id: number) {
  return request<void>(`/api/commission-rules/${id}`, { method: 'DELETE' });
}

export interface EarningsFilters {
  repId?: number;
  status?: string;
  from?: string;
  to?: string;
}

export function listEarnings(filters: EarningsFilters = {}) {
  const params = new URLSearchParams();
  if (filters.repId != null) params.set('repId', String(filters.repId));
  if (filters.status) params.set('status', filters.status);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  const qs = params.toString();
  return request<Earnings>(`/api/earnings${qs ? `?${qs}` : ''}`);
}

export function approveEarning(id: number) {
  return request<EarningsEntry>(`/api/earnings/${id}/approve`, { method: 'POST' });
}

export function listPayouts() {
  return request<Payout[]>('/api/payouts');
}

export function createPayout(input: {
  entryIds: number[];
  paidOn: string;
  referenceNote?: string | null;
}) {
  return request<Payout>('/api/payouts', { method: 'POST', body: JSON.stringify(input) });
}

/** Payout export CSV (same header/xworkspace handling as the roster export). */
export async function exportPayoutsCsv(): Promise<string> {
  const headers: Record<string, string> = {};
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  if (activeWorkspaceId != null) {
    headers['X-Workspace'] = String(activeWorkspaceId);
  }
  const response = await fetch('/api/payouts/export', { headers });
  if (!response.ok) {
    throw new ApiError(response.status, 'UNKNOWN',
      `Payout export failed with status ${response.status}`);
  }
  return response.text();
}

export function fetchLeaderboard(params: {
  period?: string;
  from?: string;
  to?: string;
  metricTypeId: number;
}) {
  const qs = new URLSearchParams();
  if (params.period) qs.set('period', params.period);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  qs.set('metricTypeId', String(params.metricTypeId));
  return request<Leaderboard>(`/api/leaderboard?${qs.toString()}`);
}

export function fetchWorkspaceSettings() {
  return request<WorkspaceSettings>('/api/workspaces/settings');
}

export function saveWorkspaceSettings(input: WorkspaceSettings) {
  return request<WorkspaceSettings>('/api/workspaces/settings', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
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

// -------------------------------------------------------------------- audit

export interface AuditEntry {
  id: number;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'PLACE' | 'UNPLACE' | string;
  entityType: string;
  entityId: number;
  actorUserId: number | null;
  actorName: string | null;
  details: string | null;
  createdAt: string;
}

export interface AuditPage {
  page: number;
  size: number;
  total: number;
  items: AuditEntry[];
}

export function fetchAuditFeed(page = 0, size = 25) {
  return request<AuditPage>(`/api/audit?page=${page}&size=${size}`);
}

// ------------------------------------------- office hours (paid sessions)

export interface OfficeHourSlot {
  id: number;
  expertUserId: number;
  expertName: string | null;
  startsAt: string;
  durationMinutes: number;
  priceMinor: number;
  currency: string;
  status: 'OPEN' | 'BOOKED' | 'CANCELLED';
}

export interface OfficeHourBooking {
  id: number;
  slotId: number;
  expertUserId: number;
  memberUserId: number;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'REFUND_PENDING' | 'REFUNDED';
  priceMinor: number;
  expertAmountMinor: number;
  platformAmountMinor: number;
  currency: string;
  meetingLink: string | null;
  providerOrderId: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  startsAt: string | null;
  durationMinutes: number | null;
  expertName: string | null;
  createdAt: string;
}

export interface OfficeHourPayout {
  id: number;
  bookingId: number;
  expertUserId: number;
  status: 'PENDING' | 'PAID' | 'REVERSED';
  amountMinor: number;
  platformAmountMinor: number;
  currency: string;
  reversal: boolean;
  createdAt: string;
}

/** POST /slots/{id}/book — the PENDING booking plus its provider order. */
export interface BookingAttempt {
  bookingId: number;
  provider: string;
  orderId: string | null;
  amountMinor: number;
  currency: string;
  status: string;
}

export interface ExpertInfo {
  userId: number;
  displayName: string | null;
  expert: boolean;
}

export function listOpenSlots() {
  return request<OfficeHourSlot[]>('/api/office-hours/slots');
}

export function listMySlots() {
  return request<OfficeHourSlot[]>('/api/office-hours/slots/mine');
}

export function createSlot(input: {
  startsAt: string;
  durationMinutes: number;
  priceMinor: number;
  currency?: string;
}) {
  return request<OfficeHourSlot>('/api/office-hours/slots', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function cancelSlot(id: number) {
  return request<OfficeHourSlot>(`/api/office-hours/slots/${id}/cancel`, {
    method: 'POST',
  });
}

export function bookSlot(id: number) {
  return request<BookingAttempt>(`/api/office-hours/slots/${id}/book`, {
    method: 'POST',
  });
}

export function listMyBookings() {
  return request<{
    asMember: OfficeHourBooking[];
    asExpert: OfficeHourBooking[];
  }>('/api/office-hours/bookings');
}

export function cancelBooking(id: number) {
  return request<OfficeHourBooking>(`/api/office-hours/bookings/${id}/cancel`, {
    method: 'POST',
  });
}

export function setMeetingLink(id: number, meetingLink: string) {
  return request<OfficeHourBooking>(`/api/office-hours/bookings/${id}/meeting-link`, {
    method: 'PUT',
    body: JSON.stringify({ meetingLink }),
  });
}

export function listOfficeHourPayouts() {
  return request<OfficeHourPayout[]>('/api/office-hours/payouts');
}

export function markPayoutPaid(id: number) {
  return request<OfficeHourPayout>(`/api/office-hours/payouts/${id}/paid`, {
    method: 'POST',
  });
}

export function fetchCommissionBp() {
  return request<{ commissionBp: number }>('/api/office-hours/commission');
}

export function saveCommissionBp(commissionBp: number) {
  return request<{ commissionBp: number }>('/api/office-hours/commission', {
    method: 'PUT',
    body: JSON.stringify({ commissionBp }),
  });
}

export function listExperts() {
  return request<ExpertInfo[]>('/api/office-hours/experts');
}

export function setExpert(userId: number, expert: boolean) {
  return request<{ userId: number; expert: boolean }>(
    `/api/office-hours/members/${userId}/expert`,
    { method: 'PUT', body: JSON.stringify({ expert }) },
  );
}

// ------------------------------------------------------------ smart intros

export interface IntroProfile {
  userId: number;
  displayName: string | null;
  offeringTags: string[];
  lookingForTags: string[];
  industry: string | null;
  /** Growth band (pod grouping), e.g. "Seed" / "Series B". */
  revenueStage?: string | null;
}

export interface IntroSuggestion {
  userId: number;
  displayName: string | null;
  reason: string;
  percent: number;
  pendingWithYou: boolean;
}

export interface IntroRequestView {
  id: number;
  fromUserId: number;
  fromName: string | null;
  toUserId: number;
  toName: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED';
  reason: string | null;
  /** Filled only after the other side accepts (and only for the pair). */
  contactEmail: string | null;
  createdAt: string;
}

export function fetchIntroProfile() {
  return request<IntroProfile>('/api/intros/profile');
}

export function saveIntroProfile(input: {
  offeringTags: string[];
  lookingForTags: string[];
  industry: string | null;
  revenueStage?: string | null;
}) {
  return request<IntroProfile>('/api/intros/profile', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function listIntroSuggestions() {
  return request<IntroSuggestion[]>('/api/intros/suggestions');
}

export function requestIntro(userId: number, reason?: string) {
  return request<IntroRequestView>('/api/intros/requests', {
    method: 'POST',
    body: JSON.stringify(reason ? { targetUserId: userId, reason } : { targetUserId: userId }),
  });
}

export function listIncomingIntroRequests() {
  return request<IntroRequestView[]>('/api/intros/requests/incoming');
}

export function listOutgoingIntroRequests() {
  return request<IntroRequestView[]>('/api/intros/requests/outgoing');
}

export function acceptIntroRequest(id: number) {
  return request<IntroRequestView>(`/api/intros/requests/${id}/accept`, {
    method: 'POST',
  });
}

export function declineIntroRequest(id: number) {
  return request<IntroRequestView>(`/api/intros/requests/${id}/decline`, {
    method: 'POST',
  });
}

// ----------------------------------------------------------- mastermind pods

export interface PodMemberLine {
  userId: number;
  displayName: string | null;
  streak: number | null;
  /** Revenue stage from the member's intro profile (undefined on older payloads). */
  revenueStage?: string | null;
}

export interface PodView {
  id: number;
  name: string;
  industry: string | null;
  members: PodMemberLine[];
}

export interface PodDraftView {
  industry: string | null;
  userIds: number[];
  names: (string | null)[];
  /** Per-member revenue stage, parallel to userIds (undefined on older payloads). */
  revenueStages?: (string | null)[];
}

export interface PodDraftInput {
  industry?: string | null;
  userIds: number[];
}

export interface PodCheckinView {
  id: number;
  podId: number;
  userId: number;
  displayName: string | null;
  weekStart: string;
  wins: string;
  blockers: string;
  ask: string | null;
}

export function generatePodPreview() {
  return request<PodDraftView[]>('/api/pods/generate', { method: 'POST' });
}

export function publishPods(input: {
  namePrefix?: string;
  drafts?: PodDraftInput[];
}) {
  return request<PodView[]>('/api/pods/publish', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listMyPods() {
  return request<PodView[]>('/api/pods');
}

export function fetchPod(id: number) {
  return request<PodView>(`/api/pods/${id}`);
}

/** One post in a pod's private thread. */
export interface PodMessageView {
  id: number;
  podId: number;
  userId: number;
  displayName: string | null;
  body: string;
  createdAt: string;
}

export function listPodMessages(podId: number) {
  return request<PodMessageView[]>(`/api/pods/${podId}/messages`);
}

export function postPodMessage(podId: number, body: string) {
  return request<PodMessageView>(`/api/pods/${podId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

export function submitPodCheckin(
  podId: number,
  input: { weekStart?: string; wins: string; blockers: string; ask?: string | null },
) {
  return request<PodCheckinView>(`/api/pods/${podId}/checkins`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listPodCheckins(podId: number) {
  return request<PodCheckinView[]>(`/api/pods/${podId}/checkins`);
}

// ------------------------------------------------------- engagement health

export interface EngagementSnapshotView {
  userId: number;
  displayName: string | null;
  snapshotDate: string;
  score: number;
  auditActions: number;
  podCheckins: number;
  podMessages: number;
  introActivity: number;
  bookings: number;
  daysInactive: number;
}

export interface EngagementRiskMember {
  userId: number;
  displayName: string | null;
  score: number;
  previousScore: number | null;
  daysInactive: number;
  reasons: string[];
}

export interface EngagementDashboard {
  snapshotDate: string | null;
  membersConsidered: number;
  atRisk: EngagementRiskMember[];
}

export interface EngagementNudge {
  userId: number;
  displayName: string | null;
  reason: string;
}

export function getEngagementDashboard() {
  return request<EngagementDashboard>('/api/engagement/dashboard');
}

export function refreshEngagement() {
  return request<EngagementSnapshotView[]>('/api/engagement/refresh', { method: 'POST' });
}

export function nudgeEngagementMember(userId: number) {
  return request<EngagementNudge>(`/api/engagement/members/${userId}/nudge`, {
    method: 'POST',
  });
}

// ------------------------------------------------------------- weekly digest

export interface Digest {
  id: number;
  /** ISO Monday of the week the digest covers. */
  weekStart: string;
  /** Plain, pre-wrapped text rendered by the Summarizer. */
  body: string;
  generatedAt: string;
}

/** The workspace's most recent stored digest (404 before the first build). */
export function getDigest() {
  return request<Digest>('/api/digest');
}
