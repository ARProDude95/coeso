import { useQuery } from '@tanstack/react-query';
import { fetchReports } from '../api';

/**
 * Workspace reports: placement rate, average bench time, placements per offer
 * and a per-vertical breakdown — all computed server-side from placements and
 * the audit trail (manager role and above; the API enforces it).
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
        <h1>Reports</h1>
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
    </div>
  );
}
