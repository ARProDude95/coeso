import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  EngagementRiskMember,
  getEngagementDashboard,
  nudgeEngagementMember,
  refreshEngagement,
} from '../api';

/**
 * Engagement health dashboard (owner-only): members flagged from the nightly
 * engagement snapshots — a sharp score drop against their previous snapshot
 * (DROP) or 14+ days without tracked activity (INACTIVE) — each with a
 * templated nudge through the Discord notifier. Refresh recomputes today's
 * window on demand.
 */
export default function EngagementPage() {
  const queryClient = useQueryClient();
  const [nudged, setNudged] = useState<Record<number, string>>({});

  const dashboard = useQuery({
    queryKey: ['engagement', 'dashboard'],
    queryFn: getEngagementDashboard,
  });

  const refresh = useMutation({
    mutationFn: refreshEngagement,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['engagement'] }),
  });

  const nudge = useMutation({
    mutationFn: (userId: number) => nudgeEngagementMember(userId),
    onSuccess: (result) =>
      setNudged((prev) => ({ ...prev, [result.userId]: result.reason })),
  });

  const error =
    dashboard.error instanceof ApiError
      ? dashboard.error.message
      : dashboard.error
        ? 'Could not load the engagement dashboard.'
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
        <button
          className="btn"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
        >
          {refresh.isPending ? 'Computing…' : 'Refresh snapshots'}
        </button>
      </div>

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
            {dashboard.data.atRisk.length === 0 && dashboard.data.snapshotDate && (
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
