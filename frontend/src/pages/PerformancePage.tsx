import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  ActivityEntry,
  CommissionRule,
  CommissionRuleInput,
  EarningsEntry,
  Leaderboard,
  LogPlacement,
  MetricType,
  Payout,
  WorkspaceSummary,
  activityMeta,
  approveEarning,
  createActivity,
  createPayout,
  deleteActivity,
  deleteCommissionRule,
  downloadCsv,
  exportPayoutsCsv,
  fetchLeaderboard,
  isProFeatureError,
  listActivity,
  listCommissionRules,
  listEarnings,
  listMetricTypes,
  listOffers,
  listPayouts,
  listReps,
  listWorkspaces,
  saveCommissionRule,
  updateActivity,
} from '../api';
import { selectedWorkspaceId } from '../session';
import Modal from '../components/Modal';

/**
 * Phase 7 [PRO]: log activity per placement, watch earnings accrue, and
 * (manager+) approve, pay and configure commissions.
 *
 * Tabs: reps see Log + Earnings; manager+ additionally get Payouts and
 * Commission rules. Every gate is enforced server-side — a 402 PRO_FEATURE_REQUIRED
 * anywhere swaps the page for an upgrade notice, a 403 surfaces inline.
 */

type Tab = 'log' | 'earnings' | 'payouts' | 'rules';
type Period = 'week' | 'month' | 'quarter' | 'custom';

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}

function fmtMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency: currency || 'USD',
  }).format(minor / 100);
}

/** Counts stay integers; currency metrics render major units from minors. */
function fmtValue(minor: number, unit: string | null | undefined): string {
  if (unit === 'currency') {
    return (minor / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return minor.toLocaleString();
}

function dayLabel(iso: string): string {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function todayInput(): string {
  const d = new Date();
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfThisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-01`;
}

const OFFICER_ROLES = new Set(['OWNER', 'ADMIN', 'MANAGER']);

function ProNotice() {
  return (
    <div className="empty-state" role="status">
      <div className="empty-title">Performance is a Pro feature</div>
      <p className="muted">
        Activity logging, earnings, payouts and the leaderboard unlock on the
        Pro plan. <a href="/pricing">Upgrade your plan</a> to start tracking
        performance.
      </p>
    </div>
  );
}

export default function PerformancePage() {
  const queryClient = useQueryClient();

  const activeId = selectedWorkspaceId();
  const { data: workspaces } = useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
  });
  const active: WorkspaceSummary | undefined = workspaces?.find(
    (w) => w.id === activeId,
  );
  const isOfficer = ACTIVE_ROLE_SET(active?.role);

  // ------------------------------------------------------------- phase 7 data
  const metricTypes = useQuery({
    queryKey: ['metric-types'],
    queryFn: listMetricTypes,
    retry: false,
  });
  const proLocked = metricTypes.isError && isProFeatureError(metricTypes.error);
  const metricError =
    metricTypes.isError && !proLocked ? errorMessage(metricTypes.error) : null;

  const meta = useQuery({
    queryKey: ['activity-meta'],
    queryFn: activityMeta,
    enabled: !proLocked,
    retry: false,
  });

  const [tab, setTab] = useState<Tab>('log');
  const [from, setFrom] = useState(startOfThisMonth);
  const [to, setTo] = useState(todayInput);
  const [metricTypeId, setMetricTypeId] = useState<number | ''>('');
  const [placementId, setPlacementId] = useState<number | ''>('');
  const [repId, setRepId] = useState<number | ''>('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const repOptions = useQuery({
    queryKey: ['rep-filter-options'],
    queryFn: () => listReps({ size: 200 }),
    enabled: isOfficer && !proLocked,
    retry: false,
  });

  const activity = useQuery({
    queryKey: ['activity', from, to, metricTypeId, placementId, repId],
    queryFn: () =>
      listActivity({
        from,
        to,
        metricTypeId: metricTypeId === '' ? undefined : metricTypeId,
        placementId: placementId === '' ? undefined : placementId,
        repId: repId === '' ? undefined : repId,
        size: 200,
      }),
    enabled: !proLocked,
    retry: false,
  });
  const entries = activity.data?.items ?? [];

  const earnings = useQuery({
    queryKey: ['earnings', from, to, repId],
    queryFn: () =>
      listEarnings({
        from,
        to,
        repId: repId === '' ? undefined : repId,
      }),
    enabled: !proLocked && (tab === 'earnings' || tab === 'payouts'),
    retry: false,
  });

  const payouts = useQuery({
    queryKey: ['payouts'],
    queryFn: listPayouts,
    enabled: !proLocked && isOfficer && tab === 'payouts',
    retry: false,
  });

  const rules = useQuery({
    queryKey: ['commission-rules'],
    queryFn: listCommissionRules,
    enabled: !proLocked && isOfficer && tab === 'rules',
    retry: false,
  });

  const offerOptions = useQuery({
    queryKey: ['offer-options'],
    queryFn: () => listOffers(),
    enabled: !proLocked && isOfficer && tab === 'rules',
    retry: false,
  });

  // -------------------------------------------------------------- derived data
  const metricById = useMemo(() => {
    const map = new Map<number, MetricType>();
    for (const m of metricTypes.data ?? []) map.set(m.id, m);
    return map;
  }, [metricTypes.data]);

  /** Daily totals for the currently selected (or first) metric — the trend chart. */
  const trend = useMemo(() => {
    const metricId =
      metricTypeId === ''
        ? (metricTypes.data?.[0]?.id ?? null)
        : metricTypeId;
    const buckets = new Map<string, number>();
    for (const entry of entries) {
      if (metricId != null && entry.metricTypeId !== metricId) continue;
      const key = entry.occurredOn;
      buckets.set(key, (buckets.get(key) ?? 0) + entry.valueMinor);
    }
    return [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [entries, metricTypeId, metricTypes.data]);

  const trendMetric =
    metricById.get(
      metricTypeId === ''
        ? (metricTypes.data?.[0]?.id ?? -1)
        : metricTypeId,
    ) ?? null;
  const trendMax = Math.max(1, ...trend.map(([, value]) => value));

  /** Total value per metric across the loaded rows. */
  const totalsByMetric = useMemo(() => {
    const map = new Map<number, number>();
    for (const entry of entries) {
      map.set(entry.metricTypeId, (map.get(entry.metricTypeId) ?? 0) + entry.valueMinor);
    }
    return [...map.entries()]
      .map(([id, total]) => ({ metric: metricById.get(id), total }))
      .filter((row) => row.metric != null)
      .slice(0, 4);
  }, [entries, metricById]);

  // ------------------------------------------------------------- mutations
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['activity'] });
    queryClient.invalidateQueries({ queryKey: ['earnings'] });
    queryClient.invalidateQueries({ queryKey: ['payouts'] });
    queryClient.invalidateQueries({ queryKey: ['commission-rules'] });
    queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
  };

  const addMutation = useMutation({
    mutationFn: createActivity,
    onSuccess: () => {
      setAddOpen(false);
      setNotice('Activity logged.');
      setError(null);
      invalidate();
    },
    onError: (err) => {
      if (isProFeatureError(err)) setProModal(true);
      else setError(errorMessage(err));
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Parameters<typeof updateActivity>[1] }) =>
      updateActivity(id, patch),
    onSuccess: () => {
      setEditEntry(null);
      setNotice('Entry updated.');
      setError(null);
      invalidate();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteActivity,
    onSuccess: () => {
      setPendingDelete(null);
      setNotice('Entry deleted.');
      setError(null);
      invalidate();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const approveMutation = useMutation({
    mutationFn: approveEarning,
    onSuccess: () => {
      setNotice('Earning approved.');
      setError(null);
      invalidate();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const [paidOn, setPaidOn] = useState(todayInput);
  const [referenceNote, setReferenceNote] = useState('');
  const [selectedEntries, setSelectedEntries] = useState<Set<number>>(new Set());

  const payoutMutation = useMutation({
    mutationFn: async () => {
      // One payout per rep/currency — the API rejects mixed batches.
      const chosen = (earnings.data?.items ?? []).filter((e) =>
        selectedEntries.has(e.id) && e.status === 'approved',
      );
      const groups = new Map<string, number[]>();
      for (const entry of chosen) {
        const key = `${entry.repId}:${entry.currency}`;
        groups.set(key, [...(groups.get(key) ?? []), entry.id]);
      }
      const results: Payout[] = [];
      for (const entryIds of groups.values()) {
        results.push(
          await createPayout({
            entryIds,
            paidOn,
            referenceNote: referenceNote.trim() || null,
          }),
        );
      }
      return results;
    },
    onSuccess: (created) => {
      setSelectedEntries(new Set());
      setReferenceNote('');
      setNotice(
        created.length === 1
          ? `Payout recorded for ${created[0].entryCount} entr(ies).`
          : `${created.length} payouts recorded (one per rep).`,
      );
      setError(null);
      invalidate();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const deleteRuleMutation = useMutation({
    mutationFn: deleteCommissionRule,
    onSuccess: () => {
      setNotice('Rule deleted.');
      setError(null);
      invalidate();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const [proModal, setProModal] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addPlacement, setAddPlacement] = useState<number | ''>('');
  const [addMetric, setAddMetric] = useState<number | ''>('');
  const [addDate, setAddDate] = useState(todayInput);
  const [addValue, setAddValue] = useState('');
  const [addValueMajor, setAddValueMajor] = useState('');
  const [addNotes, setAddNotes] = useState('');
  const [editEntry, setEditEntry] = useState<ActivityEntry | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const addMetricObj = addMetric === '' ? null : metricById.get(addMetric) ?? null;
  const addUnit = addMetricObj?.unit ?? 'count';

  function openAdd() {
    const firstPlacement = meta.data?.[0]?.placementId ?? '';
    const firstMetric = metricTypes.data?.[0]?.id ?? '';
    setAddPlacement(
      placementId === '' ? (firstPlacement as number | '') : placementId,
    );
    setAddMetric(metricTypeId === '' ? (firstMetric as number | '') : metricTypeId);
    setAddDate(todayInput());
    setAddValue('');
    setAddValueMajor('');
    setAddNotes('');
    setAddOpen(true);
  }

  function submitAdd(event: React.FormEvent) {
    event.preventDefault();
    if (addPlacement === '' || addMetric === '') return;
    const value =
      addUnit === 'currency'
        ? Math.round(Number(addValueMajor.replace(/[^0-9.]/g, '')) * 100)
        : Number(addValue.replace(/[^0-9]/g, ''));
    if (!Number.isFinite(value) || value < 0 || Number.isNaN(value)) {
      setError('Enter a valid value (0 or more).');
      return;
    }
    addMutation.mutate({
      placementId: addPlacement,
      metricTypeId: addMetric,
      occurredOn: addDate,
      valueMinor: value,
      notes: addNotes.trim() || null,
    });
  }

  function openEdit(entry: ActivityEntry) {
    setEditEntry(entry);
    const unit = metricById.get(entry.metricTypeId)?.unit ?? 'count';
    setEditValue(
      unit === 'currency' ? (entry.valueMinor / 100).toFixed(2) : String(entry.valueMinor),
    );
    setEditDate(entry.occurredOn);
    setEditNotes(entry.notes ?? '');
  }

  function submitEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editEntry) return;
    const unit = metricById.get(editEntry.metricTypeId)?.unit ?? 'count';
    const numeric = Number(
      unit === 'currency' ? editValue.replace(/[^0-9.]/g, '') : editValue.replace(/[^0-9]/g, ''),
    );
    if (!Number.isFinite(numeric) || numeric < 0) {
      setError('Enter a valid value (0 or more).');
      return;
    }
    editMutation.mutate({
      id: editEntry.id,
      patch: {
        occurredOn: editDate,
        valueMinor: unit === 'currency' ? Math.round(numeric * 100) : numeric,
        notes: editNotes.trim() || null,
      },
    });
  }

  // ------------------------------------------------------------- leaderboard
  const defaultMetricId = metricTypes.data?.[0]?.id ?? null;
  const [leaderboardMetricId, setLeaderboardMetricId] = useState<number | ''>('');
  const [period, setPeriod] = useState<Period>('month');
  const [customFrom, setCustomFrom] = useState(startOfThisMonth);
  const [customTo, setCustomTo] = useState(todayInput);
  const lbMetric = leaderboardMetricId === '' ? defaultMetricId : leaderboardMetricId;

  const leaderboard = useQuery<Leaderboard>({
    queryKey: ['leaderboard', period, customFrom, customTo, lbMetric],
    queryFn: () =>
      fetchLeaderboard(
        period === 'custom'
          ? { from: customFrom, to: customTo, metricTypeId: lbMetric as number }
          : { period, metricTypeId: lbMetric as number },
      ),
    enabled: !proLocked && lbMetric != null,
    retry: false,
  });
  const lbPro = leaderboard.isError && isProFeatureError(leaderboard.error);

  const tabs: Tab[] = isOfficer
    ? ['log', 'earnings', 'payouts', 'rules']
    : ['log', 'earnings'];

  const approvedForPayout = (earnings.data?.items ?? []).filter(
    (e) => e.status === 'approved',
  );

  function toggleSelected(id: number) {
    setSelectedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Performance</h1>
          <p className="page-sub">
            Log activity per placement, watch earnings accrue, approve and pay
            out commissions.
          </p>
        </div>
        {!proLocked && (
          <div className="header-actions">
            <button className="btn btn-primary" onClick={openAdd}>
              + Log activity
            </button>
          </div>
        )}
      </div>

      {proLocked && <ProNotice />}
      {proModal && <ProNotice />}
      {metricError && <p className="error-text">{metricError}</p>}
      {notice && <p className="muted">{notice}</p>}
      {error && <p className="error-text">{error}</p>}

      {!proLocked && (
        <>
          {/* ------------------------------------------------------ filters */}
          <section className="settings-section card">
            <div className="field-row">
              <div className="field">
                <label htmlFor="perf-from">From</label>
                <input
                  id="perf-from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="perf-to">To</label>
                <input
                  id="perf-to"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="perf-metric">Metric</label>
                <select
                  id="perf-metric"
                  value={metricTypeId}
                  onChange={(e) =>
                    setMetricTypeId(e.target.value === '' ? '' : Number(e.target.value))
                  }
                >
                  <option value="">All metrics</option>
                  {(metricTypes.data ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="perf-placement">Placement</label>
                <select
                  id="perf-placement"
                  value={placementId}
                  onChange={(e) =>
                    setPlacementId(e.target.value === '' ? '' : Number(e.target.value))
                  }
                >
                  <option value="">All placements</option>
                  {(meta.data ?? []).map((p: LogPlacement) => (
                    <option key={p.placementId} value={p.placementId}>
                      {p.offerTitle} — {p.repName}
                    </option>
                  ))}
                </select>
              </div>
              {isOfficer && (
                <div className="field">
                  <label htmlFor="perf-rep">Rep</label>
                  <select
                    id="perf-rep"
                    value={repId}
                    onChange={(e) =>
                      setRepId(e.target.value === '' ? '' : Number(e.target.value))
                    }
                  >
                    <option value="">Everyone</option>
                    {(repOptions.data?.items ?? []).map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </section>

          {/* ---------------------------------------------------------- tabs */}
          <div className="header-actions" role="tablist" aria-label="Performance views">
            {tabs.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={`chip${tab === t ? ' selected' : ''}`}
                onClick={() => setTab(t)}
              >
                {t === 'log' ? 'Log' : t === 'earnings' ? 'Earnings' : t === 'payouts' ? 'Payouts' : 'Commission rules'}
              </button>
            ))}
          </div>

          {/* ----------------------------------------------------------- log */}
          {tab === 'log' && (
            <>
              {totalsByMetric.length > 0 && (
                <div className="stats-row">
                  {totalsByMetric.map(({ metric, total }) => (
                    <div className="stat card" key={metric!.id}>
                      <span className="stat-value">{fmtValue(total, metric!.unit)}</span>
                      <span className="stat-label">{metric!.name}</span>
                    </div>
                  ))}
                </div>
              )}

              <section className="settings-section card">
                <h2>Trend{trendMetric ? ` — ${trendMetric.name}` : ''}</h2>
                {activity.isLoading && <p className="muted">Loading…</p>}
                {activity.isError && !isProFeatureError(activity.error) && (
                  <p className="error-text">{errorMessage(activity.error)}</p>
                )}
                {trend.length === 0 ? (
                  <p className="muted">
                    {activity.isLoading
                      ? 'Loading…'
                      : 'No activity in this range. Log calls, meetings or deals to build the trend.'}
                  </p>
                ) : (
                  <>
                    <div
                      className="trend-chart"
                      role="img"
                      aria-label={`${trendMetric?.name ?? 'Activity'} per day`}
                    >
                      {trend.map(([day, value]) => (
                        <div className="trend-col" key={day}>
                          <div
                            className="trend-bar"
                            style={{
                              height: `${Math.max(4, Math.round((value / trendMax) * 100))}%`,
                            }}
                            title={`${day} — ${fmtValue(value, trendMetric?.unit)}`}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="trend-axis">
                      <span>{dayLabel(trend[0][0])}</span>
                      <span>{dayLabel(trend[trend.length - 1][0])}</span>
                    </div>
                  </>
                )}
              </section>

              <section className="settings-section card">
                <h2>Activity log</h2>
                {activity.isLoading && <p className="muted">Loading…</p>}
                {activity.data && entries.length === 0 && (
                  <div className="empty-state">
                    <div className="empty-title">No activity yet</div>
                    <p className="muted">
                      Entries you and your team log against placements show up
                      here.
                    </p>
                  </div>
                )}
                {entries.map((entry) => (
                  <div className="lookup-row" key={entry.id}>
                    <span className="name">
                      {metricById.get(entry.metricTypeId)?.name ?? `Metric #${entry.metricTypeId}`}
                      <span className="muted"> — {entry.offerTitle ?? 'Placement'}</span>
                    </span>
                    <span>{fmtValue(entry.valueMinor, entry.metricUnit)}</span>
                    <span className="muted">{dayLabel(entry.occurredOn)}</span>
                    {isOfficer && (
                      <span className="muted">{entry.repName ?? `Rep #${entry.repId}`}</span>
                    )}
                    {entry.notes && <span className="muted">{entry.notes}</span>}
                    <span className="header-actions">
                      {entry.canEdit && (
                        <button
                          className="btn btn-sm"
                          onClick={() => openEdit(entry)}
                        >
                          Edit
                        </button>
                      )}
                      {isOfficer && (
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => {
                            setPendingDelete(entry.id);
                            setConfirmClose(true);
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </span>
                  </div>
                ))}
                {activity.data && entries.length > 0 && (
                  <p className="muted">
                    Showing {entries.length} of {activity.data.total} entr
                    {activity.data.total === 1 ? 'y' : 'ies'}.
                  </p>
                )}
              </section>
            </>
          )}

          {/* ------------------------------------------------------ earnings */}
          {tab === 'earnings' && (
            <section className="settings-section card">
              <h2>Earnings</h2>
              <p className="muted">
                Append-only commission ledger. Corrections are recorded as
                reversing entries, never by editing a row.
              </p>
              {earnings.isLoading && <p className="muted">Loading…</p>}
              {earnings.isError && !isProFeatureError(earnings.error) && (
                <p className="error-text">{errorMessage(earnings.error)}</p>
              )}
              {earnings.data && (
                <div className="stats-row">
                  <div className="stat card">
                    <span className="stat-value">
                      {earnings.data.currency
                        ? fmtMoney(earnings.data.netMinor, earnings.data.currency)
                        : fmtValue(earnings.data.netMinor, 'count')}
                    </span>
                    <span className="stat-label">Net earnings</span>
                  </div>
                  <div className="stat card">
                    <span className="stat-value">{earnings.data.total}</span>
                    <span className="stat-label">Ledger entries</span>
                  </div>
                </div>
              )}
              {earnings.data && earnings.data.items.length === 0 && (
                <div className="empty-state">
                  <div className="empty-title">No earnings in range</div>
                  <p className="muted">
                    Commission accrues once logged revenue has a rule to price
                    it.
                  </p>
                </div>
              )}
              {(earnings.data?.items ?? []).map((entry: EarningsEntry) => (
                <div className="lookup-row" key={entry.id}>
                  <span className="name">
                    {entry.offerTitle ?? `Placement #${entry.placementId}`}
                    <span className="muted"> — {entry.repName ?? `Rep #${entry.repId}`}</span>
                    {entry.reversal && <span className="pill pill-danger">reversal</span>}
                  </span>
                  <span>
                    {entry.status === 'accrued' ? '' : ''}
                    {fmtMoney(entry.amountMinor, entry.currency)}
                  </span>
                  <span
                    className={`pill ${
                      entry.status === 'paid'
                        ? 'pill-open'
                        : entry.status === 'approved'
                          ? 'pill-gold'
                          : 'pill-muted'
                    }`}
                  >
                    {entry.status}
                  </span>
                  <span className="muted">{dayLabel(entry.enteredOn)}</span>
                  {isOfficer && entry.status === 'accrued' && (
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => approveMutation.mutate(entry.id)}
                      disabled={approveMutation.isPending}
                    >
                      Approve
                    </button>
                  )}
                </div>
              ))}
            </section>
          )}

          {/* ------------------------------------------------------- payouts */}
          {tab === 'payouts' && isOfficer && (
            <>
              <section className="settings-section card">
                <h2>Record a payout</h2>
                <p className="muted">
                  Batch this rep's <strong>approved</strong> entries into one
                  payout per rep, with a paid date and reference note. No real
                  money moves — this is a record and a CSV run sheet.
                </p>
                {earnings.isLoading && <p className="muted">Loading…</p>}
                {earnings.data && approvedForPayout.length === 0 && (
                  <div className="empty-state">
                    <div className="empty-title">Nothing to pay yet</div>
                    <p className="muted">
                      Approve accrued entries on the Earnings tab first.
                    </p>
                  </div>
                )}
                {approvedForPayout.length > 0 && (
                  <>
                    {approvedForPayout.map((entry) => (
                      <label className="lookup-row" key={entry.id}>
                        <span className="name">
                          <input
                            type="checkbox"
                            checked={selectedEntries.has(entry.id)}
                            onChange={() => toggleSelected(entry.id)}
                            aria-label={`Select entry ${entry.id}`}
                          />{' '}
                          {entry.offerTitle ?? `Placement #${entry.placementId}`}
                          <span className="muted"> — {entry.repName ?? `Rep #${entry.repId}`}</span>
                        </span>
                        <span>{fmtMoney(entry.amountMinor, entry.currency)}</span>
                      </label>
                    ))}
                    <div className="field-row">
                      <div className="field">
                        <label htmlFor="payout-date">Paid on</label>
                        <input
                          id="payout-date"
                          type="date"
                          value={paidOn}
                          onChange={(e) => setPaidOn(e.target.value)}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="payout-note">Reference note</label>
                        <input
                          id="payout-note"
                          value={referenceNote}
                          placeholder="e.g. bank transfer ref, PayPal batch"
                          onChange={(e) => setReferenceNote(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="header-actions">
                      <button
                        className="btn btn-primary"
                        disabled={selectedEntries.size === 0 || payoutMutation.isPending}
                        onClick={() => payoutMutation.mutate()}
                      >
                        {payoutMutation.isPending
                          ? 'Recording…'
                          : `Pay ${selectedEntries.size} entr${selectedEntries.size === 1 ? 'y' : 'ies'}`}
                      </button>
                      <button
                        className="btn"
                        onClick={async () => {
                          try {
                            const csv = await exportPayoutsCsv();
                            downloadCsv('payouts.csv', csv);
                          } catch (err) {
                            setError(errorMessage(err));
                          }
                        }}
                      >
                        Export CSV
                      </button>
                    </div>
                  </>
                )}
              </section>

              <section className="settings-section card">
                <h2>Payout history</h2>
                {payouts.isLoading && <p className="muted">Loading…</p>}
                {payouts.isError && !isProFeatureError(payouts.error) && (
                  <p className="error-text">{errorMessage(payouts.error)}</p>
                )}
                {payouts.data && payouts.data.length === 0 && (
                  <div className="empty-state">
                    <div className="empty-title">No payouts yet</div>
                    <p className="muted">Recorded payouts appear here.</p>
                  </div>
                )}
                {(payouts.data ?? []).map((payout: Payout) => (
                  <div className="lookup-row" key={payout.id}>
                    <span className="name">
                      {payout.repName ?? `Rep #${payout.repId}`}
                      <span className="muted"> — {payout.entryCount} entries</span>
                    </span>
                    <span>{fmtMoney(payout.amountMinor, payout.currency)}</span>
                    <span className="muted">paid {dayLabel(payout.paidOn)}</span>
                    {payout.referenceNote && (
                      <span className="muted">{payout.referenceNote}</span>
                    )}
                  </div>
                ))}
              </section>
            </>
          )}

          {/* --------------------------------------------------- commission rules */}
          {tab === 'rules' && isOfficer && (
            <section className="settings-section card">
              <h2>Commission rules</h2>
              <p className="muted">
                Percent of revenue (basis points), flat per deal, or tiered.
                Setup order wins: rep override → per-offer rule → workspace
                default.
              </p>
              <RuleForm
                offers={(offerOptions.data ?? []).map((o) => ({ id: o.id, title: o.title }))}
                reps={(repOptions.data?.items ?? []).map((r) => ({ id: r.id, name: r.name }))}
                onSaved={() => {
                  setNotice('Rule saved.');
                  setError(null);
                  invalidate();
                }}
                onError={(err) => setError(errorMessage(err))}
              />
              {rules.isLoading && <p className="muted">Loading…</p>}
              {rules.isError && !isProFeatureError(rules.error) && (
                <p className="error-text">{errorMessage(rules.error)}</p>
              )}
              {rules.data && rules.data.length === 0 && (
                <div className="empty-state">
                  <div className="empty-title">No rules yet</div>
                  <p className="muted">
                    Without a rule nothing accrues — add a workspace default.
                  </p>
                </div>
              )}
              {(rules.data ?? []).map((rule: CommissionRule) => (
                <div className="lookup-row" key={rule.id}>
                  <span className="name">
                    {rule.offerTitle ?? 'Workspace default'}
                    {rule.repName && <span className="muted"> — {rule.repName}</span>}
                  </span>
                  <span className="pill pill-gold">
                    {rule.kind === 'percent' && ` ${(rule.rateBp ?? 0) / 100}%`}
                    {rule.kind === 'flat' &&
                      ` ${fmtMoney(rule.flatMinor ?? 0, rule.currency ?? 'USD')} per deal`}
                    {rule.kind === 'tiered' &&
                      ` ${rule.tiers
                        .map((t) => `${t.rateBp / 100}% to ${t.upToMinor == null ? '∞' : fmtMoney(t.upToMinor, rule.currency ?? 'USD')}`)
                        .join(' · ')}`}
                  </span>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => deleteRuleMutation.mutate(rule.id)}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </section>
          )}

          {/* ------------------------------------------------------ leaderboard */}
          <section className="settings-section card">
            <h2>Leaderboard</h2>
            <div className="header-actions" aria-label="Leaderboard period">
              {(['week', 'month', 'quarter', 'custom'] as Period[]).map((p) => (
                <button
                  key={p}
                  className={`chip${period === p ? ' selected' : ''}`}
                  onClick={() => setPeriod(p)}
                >
                  {p}
                </button>
              ))}
              <select
                aria-label="Leaderboard metric"
                value={leaderboardMetricId}
                style={{ width: 'auto' }}
                onChange={(e) =>
                  setLeaderboardMetricId(e.target.value === '' ? '' : Number(e.target.value))
                }
              >
                <option value="">Default metric</option>
                {(metricTypes.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            {period === 'custom' && (
              <div className="field-row">
                <div className="field">
                  <label htmlFor="lb-from">From</label>
                  <input
                    id="lb-from"
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="lb-to">To</label>
                  <input
                    id="lb-to"
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                  />
                </div>
              </div>
            )}
            {leaderboardMetricId === '' && defaultMetricId == null && (
              <p className="muted">Add a metric type in Settings first.</p>
            )}
            {leaderboard.isLoading && <p className="muted">Loading…</p>}
            {lbPro && (
              <p className="muted">The leaderboard is available on the Pro plan.</p>
            )}
            {leaderboard.isError && !lbPro && (
              <p className="error-text">{errorMessage(leaderboard.error)}</p>
            )}
            {leaderboard.data && leaderboard.data.items.length === 0 && (
              <div className="empty-state">
                <div className="empty-title">No entries for this period</div>
                <p className="muted">Log activity to populate the leaderboard.</p>
              </div>
            )}
            {leaderboard.data && (
              <>
                {leaderboard.data.selfRank != null && (
                  <p className="muted">Your rank: #{leaderboard.data.selfRank}</p>
                )}
                {leaderboard.data.items.map((row) => (
                  <div
                    className="lookup-row"
                    key={`${row.rank}-${row.repId ?? row.repName ?? row.rank}`}
                  >
                    <span className="name">
                      #{row.rank}{' '}
                      {leaderboard.data!.showNames
                        ? (row.repName ?? (row.self ? 'You' : 'Rep'))
                        : row.self
                          ? 'You'
                          : `Rep #${row.repId ?? '?'}`}
                    </span>
                    <span>
                      {leaderboard.data!.metricUnit === 'currency'
                        ? fmtValue(row.value, 'currency')
                        : fmtValue(row.value, 'count')}{' '}
                      <span className="muted">{leaderboard.data!.metricName}</span>
                    </span>
                    {row.self && <span className="pill pill-gold">you</span>}
                  </div>
                ))}
              </>
            )}
          </section>
        </>
      )}

      {/* ------------------------------------------------------------ add modal */}
      {addOpen && (
        <Modal title="Log activity" onClose={() => setAddOpen(false)}>
          <form onSubmit={submitAdd}>
            {(meta.isLoading || metricTypes.isLoading) && (
              <p className="muted">Loading…</p>
            )}
            <div className="field">
              <label htmlFor="add-placement">Placement</label>
              <select
                id="add-placement"
                value={addPlacement}
                onChange={(e) =>
                  setAddPlacement(e.target.value === '' ? '' : Number(e.target.value))
                }
                required
              >
                <option value="">Choose a placement…</option>
                {(meta.data ?? []).map((p: LogPlacement) => (
                  <option key={p.placementId} value={p.placementId}>
                    {p.offerTitle} — {p.repName}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="add-metric">Metric</label>
              <select
                id="add-metric"
                value={addMetric}
                onChange={(e) =>
                  setAddMetric(e.target.value === '' ? '' : Number(e.target.value))
                }
                required
              >
                <option value="">Choose a metric…</option>
                {(metricTypes.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} {m.unit === 'currency' ? '(money)' : '(count)'}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="add-value">
                  {addUnit === 'currency' ? 'Value' : 'Value (count)'}
                </label>
                <input
                  id="add-value"
                  type="number"
                  min={0}
                  step={addUnit === 'currency' ? '0.01' : '1'}
                  value={addUnit === 'currency' ? addValueMajor : addValue}
                  onChange={(e) =>
                    addUnit === 'currency'
                      ? setAddValueMajor(e.target.value)
                      : setAddValue(e.target.value)
                  }
                  required
                />
                {addUnit === 'currency' && (
                  <span className="muted">Stored as minor units, never floats.</span>
                )}
              </div>
              <div className="field">
                <label htmlFor="add-date">Date</label>
                <input
                  id="add-date"
                  type="date"
                  value={addDate}
                  onChange={(e) => setAddDate(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="add-notes">Notes (optional)</label>
              <input
                id="add-notes"
                value={addNotes}
                onChange={(e) => setAddNotes(e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setAddOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={addMutation.isPending}
              >
                {addMutation.isPending ? 'Saving…' : 'Log entry'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ----------------------------------------------------------- edit modal */}
      {editEntry && (
        <Modal title="Edit entry" onClose={() => setEditEntry(null)}>
          <form onSubmit={submitEdit}>
            <div className="field">
              <label htmlFor="edit-value">Value</label>
              <input
                id="edit-value"
                type="number"
                min={0}
                step={
                  (metricById.get(editEntry.metricTypeId)?.unit ?? 'count') === 'currency'
                    ? '0.01'
                    : '1'
                }
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="edit-date">Date</label>
              <input
                id="edit-date"
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="edit-notes">Notes</label>
              <input
                id="edit-notes"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setEditEntry(null)}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={editMutation.isPending}
              >
                {editMutation.isPending ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* -------------------------------------------------------- delete confirm */}
      {confirmClose && (
        <Modal title="Delete this entry?" onClose={() => setConfirmClose(false)}>
          <p className="muted">
            Deletion is only allowed before earnings accrue — afterwards edit the
            entry instead, which records a reversing ledger row. Linked earnings
            block deletion server-side.
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setConfirmClose(false)}>
              Keep it
            </button>
            <button
              className="btn btn-danger"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (pendingDelete != null) deleteMutation.mutate(pendingDelete);
              }}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- rule form

function RuleForm({
  offers,
  reps,
  onSaved,
  onError,
}: {
  offers: { id: number; title: string }[];
  reps: { id: number; name: string }[];
  onSaved: () => void;
  onError: (err: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState('default');
  const [kind, setKind] = useState<'percent' | 'flat' | 'tiered'>('percent');
  const [percent, setPercent] = useState('10');
  const [flatMajor, setFlatMajor] = useState('50');
  const [currency, setCurrency] = useState('USD');
  const [tiersJson, setTiersJson] = useState(
    '[{"upToMinor":null,"rateBp":1000}]',
  );
  const [localError, setLocalError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const input: CommissionRuleInput = {
        offerId: null,
        repId: null,
        kind,
      };
      if (scope.startsWith('offer:')) input.offerId = Number(scope.slice(6));
      if (scope.startsWith('rep:')) input.repId = Number(scope.slice(4));
      if (kind === 'percent') {
        const value = Number(percent.replace(/[^0-9.]/g, ''));
        if (!Number.isFinite(value) || value < 0 || value > 100) {
          throw new Error('Percent must be between 0 and 100.');
        }
        input.rateBp = Math.round(value * 100);
      } else if (kind === 'flat') {
        const value = Number(flatMajor.replace(/[^0-9.]/g, ''));
        if (!Number.isFinite(value) || value < 0) {
          throw new Error('Flat amount must be 0 or more.');
        }
        input.flatMinor = Math.round(value * 100);
        input.currency = currency.toUpperCase().slice(0, 3) || 'USD';
      } else {
        let parsed: unknown;
        try {
          parsed = JSON.parse(tiersJson);
        } catch {
          throw new Error('Tiers must be valid JSON, e.g. [{"upToMinor":500000,"rateBp":1000}].');
        }
        if (!Array.isArray(parsed) || parsed.length === 0) {
          throw new Error('Tiers must be a non-empty array.');
        }
        input.tiers = parsed as CommissionRuleInput['tiers'];
      }
      return saveCommissionRule(input);
    },
    onSuccess: () => {
      setOpen(false);
      setLocalError(null);
      onSaved();
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Saving the rule failed';
      setLocalError(message);
      onError(err);
    },
  });

  if (!open) {
    return (
      <div className="header-actions">
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          + Add rule
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setLocalError(null);
        mutation.mutate();
      }}
    >
      <div className="field-row">
        <div className="field">
          <label htmlFor="rule-scope">Applies to</label>
          <select
            id="rule-scope"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="default">Workspace default</option>
            <optgroup label="Offer">
              {offers.map((offer) => (
                <option key={offer.id} value={`offer:${offer.id}`}>
                  {offer.title}
                </option>
              ))}
            </optgroup>
            <optgroup label="Rep override">
              {reps.map((rep) => (
                <option key={rep.id} value={`rep:${rep.id}`}>
                  {rep.name}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <div className="field">
          <label htmlFor="rule-kind">Rule type</label>
          <select
            id="rule-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="percent">Percent of revenue</option>
            <option value="flat">Flat per deal</option>
            <option value="tiered">Tiered</option>
          </select>
        </div>
        {kind === 'percent' && (
          <div className="field">
            <label htmlFor="rule-percent">Percent</label>
            <input
              id="rule-percent"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
            />
          </div>
        )}
        {kind === 'flat' && (
          <div className="field">
            <label htmlFor="rule-flat">Amount per deal</label>
            <input
              id="rule-flat"
              type="number"
              min={0}
              step="0.01"
              value={flatMajor}
              onChange={(e) => setFlatMajor(e.target.value)}
            />
            <input
              aria-label="Currency"
              maxLength={3}
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </div>
        )}
        {kind === 'tiered' && (
          <div className="field">
            <label htmlFor="rule-tiers">Tiers (JSON, up to threshold in minor units + basis points)</label>
            <input
              id="rule-tiers"
              value={tiersJson}
              onChange={(e) => setTiersJson(e.target.value)}
            />
          </div>
        )}
      </div>
      {localError && <p className="error-text">{localError}</p>}
      <div className="header-actions">
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Save rule'}
        </button>
      </div>
    </form>
  );
}

/** Small helper so the role check reads clearly at the call site. */
function ACTIVE_ROLE_SET(role: string | undefined): boolean {
  return role != null && OFFICER_ROLES.has(role);
}