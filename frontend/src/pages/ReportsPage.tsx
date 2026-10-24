import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ApiError,
  AuditEntry,
  fetchAuditFeed,
  fetchLeaderboard,
  fetchReports,
  getDigest,
  isProFeatureError,
  listMetricTypes,
} from '../api';

/**
 * Workspace reports: placement rate, average bench time, placements per offer
 * and a per-vertical breakdown — all computed server-side from placements and
 * the audit trail (manager role and above; the API enforces it), plus the
 * latest weekly digest (admin+, [PRO]) and the recent-activity feed read back
 * from that same audit trail.
 */
export default function ReportsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['reports'],
    queryFn: fetchReports,
  });

  const ratePercent =
    data == null ? null : `${Math.round(data.placementRate.rate * 1000) / 10}%`;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Reports</h1>
          <p className="page-sub">How well the roster is converting, and where the gaps are.</p>
        </div>
      </div>

      {isLoading && <p className="muted">Loading…</p>}
      {error && <p className="error-text">Could not load reports.</p>}

      {data && (
        <>
          <div className="stats-row">
            <div className="stat card">
              <span className="stat-value">{ratePercent}</span>
              <span className="stat-label">Placement rate</span>
            </div>
            <div className="stat card">
              <span className="stat-value">
                {data.placementRate.placedReps}/{data.placementRate.totalReps}
              </span>
              <span className="stat-label">Reps placed</span>
            </div>
            <div className="stat card">
              <span className="stat-value">
                {data.averageBenchDays == null ? '—' : `${data.averageBenchDays}d`}
              </span>
              <span className="stat-label">Avg bench time</span>
            </div>
            <div className="stat card">
              <span className="stat-value">{data.benchSamples}</span>
              <span className="stat-label">Bench samples</span>
            </div>
          </div>

          <section className="settings-section card">
            <h2>Placements per offer</h2>
            {data.placementsPerOffer.length === 0 ? (
              <p className="muted">No placements yet.</p>
            ) : (
              data.placementsPerOffer.map((offer) => (
                <div key={offer.offerId} className="lookup-row">
                  <span className="name">
                    {offer.title}
                    {offer.clientName && (
                      <span className="muted"> — {offer.clientName}</span>
                    )}
                  </span>
                  <span className="pill pill-filled">
                    {offer.activePlacements}/{offer.totalPlacements} placed
                  </span>
                </div>
              ))
            )}
          </section>

          <section className="settings-section card">
            <h2>Per-vertical breakdown</h2>
            {data.verticals.length === 0 ? (
              <p className="muted">No reps yet.</p>
            ) : (
              <>
                <div className="lookup-row">
                  <span className="name muted">Vertical</span>
                  <span className="muted">Reps</span>
                  <span className="muted">Placed</span>
                </div>
                {data.verticals.map((vertical) => (
                  <div key={vertical.verticalId ?? 'none'} className="lookup-row">
                    <span className="name">{vertical.name}</span>
                    <span>{vertical.reps}</span>
                    <span>{vertical.placedReps}</span>
                  </div>
                ))}
              </>
            )}
          </section>
        </>
      )}

      <WeeklyDigestCard />

      <LeaderboardWidget />

      <ActivityFeed />
    </div>
  );
}

// ----------------------------------------------------------- weekly digest

/**
 * The latest stored weekly digest (feature 5), readable without curl.
 *
 * Server rules decide what the card can be: admin+ roles get the body, a
 * manager's 403 hides the card entirely (they never see the link), a below-Pro
 * plan shows the upgrade line, and 404 means the Monday job has not run for
 * this workspace yet. The body is pre-formatted plain text, so it is rendered
 * with `white-space: pre-wrap` rather than parsed as Markdown.
 */
function WeeklyDigestCard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['digest'],
    queryFn: getDigest,
    retry: false,
  });

  if (error instanceof ApiError && error.status === 403) {
    return null;
  }

  const proLocked = isProFeatureError(error);
  const noDigestYet = error instanceof ApiError && error.status === 404;

  return (
    <section className="settings-section card">
      <h2>Weekly digest</h2>
      {isLoading && <p className="muted">Loading…</p>}
      {proLocked && (
        <p className="muted">
          The weekly digest is available on the Pro plan.{' '}
          <a href="/pricing">Upgrade</a>.
        </p>
      )}
      {noDigestYet && (
        <p className="muted">
          No digest yet — the Monday job builds one for every active workspace.
        </p>
      )}
      {error && !proLocked && !noDigestYet && (
        <p className="error-text">Could not load the digest.</p>
      )}
      {data && (
        <>
          <p className="muted">
            Week of {data.weekStart} · generated{' '}
            {new Date(data.generatedAt).toLocaleString()}
          </p>
          <div className="digest-body">{data.body}</div>
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------- leaderboard widget

/**
 * Dashboard leaderboard widget (Phase 7, [PRO]): top 5 reps this month on the
 * default metric, with the caller's own rank. Rep names follow the workspace
 * visibility setting (the server masks them when it is off).
 */
function LeaderboardWidget() {
  const metricTypes = useQuery({
    queryKey: ['metric-types'],
    queryFn: listMetricTypes,
    retry: false,
  });
  const metricId = metricTypes.data?.[0]?.id ?? null;

  const leaderboard = useQuery({
    queryKey: ['leaderboard', 'month', metricId],
    queryFn: () => fetchLeaderboard({ period: 'month', metricTypeId: metricId as number }),
    enabled: metricId != null,
    retry: false,
  });

  const proLocked =
    (metricTypes.isError && isProFeatureError(metricTypes.error)) ||
    (leaderboard.isError && isProFeatureError(leaderboard.error));

  if (proLocked) {
    return (
      <section className="settings-section card">
        <h2>Leaderboard</h2>
        <p className="muted">
          Top reps this month — available on the Pro plan.{' '}
          <a href="/pricing">Upgrade</a>.
        </p>
      </section>
    );
  }

  return (
    <section className="settings-section card">
      <h2>Leaderboard — top reps this month</h2>
      {leaderboard.isLoading && <p className="muted">Loading…</p>}
      {leaderboard.isError && <p className="error-text">Could not load the leaderboard.</p>}
      {leaderboard.data && leaderboard.data.items.length === 0 && (
        <p className="muted">No activity logged this month yet.</p>
      )}
      {leaderboard.data?.selfRank != null && (
        <p className="muted">Your rank: #{leaderboard.data.selfRank}</p>
      )}
      {(leaderboard.data?.items ?? []).slice(0, 5).map((row) => (
        <div className="lookup-row" key={`${row.rank}-${row.repId ?? row.rank}`}>
          <span className="name">
            #{row.rank}{' '}
            {leaderboard.data?.showNames
              ? (row.repName ?? (row.self ? 'You' : 'Rep'))
              : row.self
                ? 'You'
                : `Rep #${row.repId ?? '?'}`}
          </span>
          <span>
            {leaderboard.data?.metricUnit === 'currency'
              ? (row.value / 100).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })
              : row.value.toLocaleString()}{' '}
            <span className="muted">{leaderboard.data?.metricName}</span>
          </span>
          {row.self && <span className="pill pill-gold">you</span>}
        </div>
      ))}
    </section>
  );
}

// ------------------------------------------------------------- activity feed

const ACTION_PILL: Record<string, string> = {
  CREATE: 'pill pill-open',
  UPDATE: 'pill pill-training',
  DELETE: 'pill pill-danger',
  PLACE: 'pill pill-placed',
  UNPLACE: 'pill pill-bench',
};

function formatWhen(iso: string): string {
  const then = new Date(iso);
  const diffMs = Date.now() - then.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString();
}

/** One line of the feed: ACTION pill, what, who, when. */
function ActivityRow({ entry }: { entry: AuditEntry }) {
  // details is server-produced JSON; a name summary is nice-to-have only.
  let summary: string | null = null;
  try {
    const parsed = entry.details ? (JSON.parse(entry.details) as Record<string, unknown>) : null;
    const name = parsed?.name ?? parsed?.repName ?? parsed?.offerTitle ?? parsed?.reason;
    if (typeof name === 'string' && name.trim() !== '') {
      summary = name;
    }
  } catch {
    summary = null;
  }
  return (
    <div className="lookup-row activity-row">
      <span className={ACTION_PILL[entry.action] ?? 'pill'}>{entry.action}</span>
      <span className="name">
        {entry.entityType} #{entry.entityId}
        {summary && <span className="muted"> — {summary}</span>}
      </span>
      <span className="muted activity-actor">{entry.actorName ?? 'System'}</span>
      <span className="muted activity-when" title={new Date(entry.createdAt).toLocaleString()}>
        {formatWhen(entry.createdAt)}
      </span>
    </div>
  );
}

function ActivityFeed() {
  const [page, setPage] = useState(0);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['audit', page],
    queryFn: () => fetchAuditFeed(page),
  });

  // Page 0 replaces (initial load / refetch); later pages append older rows.
  useEffect(() => {
    if (!data) return;
    setTotal(data.total);
    setEntries((previous) =>
      page === 0 ? data.items : [...previous, ...data.items]);
  }, [data, page]);

  const loadedAll = total != null && entries.length >= total;

  return (
    <section className="settings-section card">
      <h2>Recent activity</h2>
      {isLoading && page === 0 && <p className="muted">Loading…</p>}
      {total === 0 && <p className="muted">No activity yet.</p>}
      {entries.map((entry) => (
        <ActivityRow key={entry.id} entry={entry} />
      ))}
      {total != null && !loadedAll && (
        <button
          className="btn btn-sm"
          onClick={() => setPage(page + 1)}
          disabled={isLoading}
        >
          {isLoading ? 'Loading…' : 'Load older'}
        </button>
      )}
    </section>
  );
}
