import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  EngagementRiskMember,
  getEngagementDashboard,
  isProFeatureError,
  nudgeEngagementMember,
  refreshEngagement,
} from '../api';

/** Shown instead of the dashboard when the workspace's plan is below Pro. */
function ProNotice() {
  return (
    <div className="empty-state" role="status">
      <div className="empty-title">Engagement health is a Pro feature</div>
      <p className="muted">
        Churn signals from the nightly snapshots, the owner dashboard and the
        weekly digest unlock on the Pro plan.{' '}
        <a href="/pricing">Upgrade your plan</a> to start watching engagement.
      </p>
    </div>
  );
}

/**
 * Engagement health dashboard (owner-only, [PRO]): members flagged from the
 * nightly engagement snapshots — a sharp score drop against their previous
 * snapshot (DROP) or 14+ days without tracked activity (INACTIVE) — each with
 * a templated nudge through the Discord notifier. Refresh recomputes today's
 * window on demand.
 *
 * The gate is enforced server-side: a 402 PRO_FEATURE_REQUIRED swaps the
 * dashboard for an upgrade notice, exactly like the Phase 7 pages. It also
 * covers the weekly digest, which has no screen of its own (Discord delivery).
 */
export default function EngagementPage() {
  const queryClient = useQueryClient();
  const [nudged, setNudged] = useState<Record<number, string>>({});

  const dashboard = useQuery({
    queryKey: ['engagement', 'dashboard'],
    queryFn: getEngagementDashboard,
    retry: false,
  });

  const proLocked = isProFeatureError(dashboard.error);

  /** A plan downgraded mid-session surfaces as a 402 here, not on load. */
  function recheckPlan(err: unknown) {
    if (isProFeatureError(err)) {
      queryClient.invalidateQueries({ queryKey: ['engagement'] });
    }
  }

  const refresh = useMutation({
    mutationFn: refreshEngagement,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['engagement'] }),
    onError: recheckPlan,
  });

  const nudge = useMutation({
    mutationFn: (userId: number) => nudgeEngagementMember(userId),
    onSuccess: (result) =>
      setNudged((prev) => ({ ...prev, [result.userId]: result.reason })),
    onError: recheckPlan,
  });

  const error =
    dashboard.error && !proLocked
      ? dashboard.error instanceof ApiError
        ? dashboard.error.message
        : 'Could not load the engagement dashboard.'
      : null;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Engagement health</h1>
          <p className="page-sub">
            Churn signals from the nightly snapshots — a sharp score drop or two
            weeks of silence.
          </p>
        </div>
        {!proLocked && (
          <button
            className="btn"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
          >
            {refresh.isPending ? 'Computing…' : 'Refresh snapshots'}
          </button>
        )}
      </div>

      {proLocked && <ProNotice />}

      {!proLocked && (
        <section className="settings-section card">
          <h2>At risk</h2>
          {error && <p className="error-text">{error}</p>}
          {dashboard.isLoading && !error && <p className="muted">Loading…</p>}
          {dashboard.data && (
            <>
              <p className="muted">
                {dashboard.data.snapshotDate
                  ? `Snapshots for ${dashboard.data.snapshotDate} · ${
                      dashboard.data.membersConsidered
                    } members`
                  : 'No snapshots yet — run a refresh or wait for the nightly job.'}
              </p>
              {dashboard.data.atRisk.length === 0 &&
                dashboard.data.snapshotDate && (
                  <p className="muted">No members look at risk right now.</p>
                )}
              {dashboard.data.atRisk.map((member) => (
                <RiskRow
                  key={member.userId}
                  member={member}
                  nudgedReason={nudged[member.userId] ?? null}
                  onNudge={() => nudge.mutate(member.userId)}
                  nudgePending={nudge.isPending}
                />
              ))}
            </>
          )}
        </section>
      )}
    </div>
  );
}

function RiskRow({
  member,
  nudgedReason,
  onNudge,
  nudgePending,
}: {
  member: EngagementRiskMember;
  nudgedReason: string | null;
  onNudge: () => void;
  nudgePending: boolean;
}) {
  return (
    <div className="lookup-row">
      <span className="name">
        {member.displayName ?? `Member ${member.userId}`}
        <span className="muted">
          {' '}
          — score {member.score}
          {member.previousScore != null ? ` (was ${member.previousScore})` : ''},{' '}
          {member.daysInactive}d inactive
        </span>
        {member.reasons.includes('DROP') && (
          <span className="pill"> DROP </span>
        )}
        {member.reasons.includes('INACTIVE') && (
          <span className="pill pill-inactive"> INACTIVE </span>
        )}
      </span>
      <span>
        {nudgedReason ? (
          <span className="muted">nudge sent — {nudgedReason}</span>
        ) : (
          <button
            className="btn btn-sm"
            onClick={onNudge}
            disabled={nudgePending}
          >
            {nudgePending ? 'Sending…' : 'Nudge'}
          </button>
        )}
      </span>
    </div>
  );
}
