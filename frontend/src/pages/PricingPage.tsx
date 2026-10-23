import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { listPlans, Plan } from '../api';

/**
 * Pricing: the four plans with their limits, the current one flagged. Any
 * member can look; upgrading is done from Settings (owner only), so this page
 * links there instead of acting itself.
 *
 * The API publishes limits only (no prices), so the cards lead with the
 * numbers rather than a price column.
 */
export default function PricingPage() {
  const { data: plans, isLoading, error } = useQuery({
    queryKey: ['plans'],
    queryFn: listPlans,
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Pricing</h1>
          <p className="page-sub">Per-workspace plans that scale with your roster.</p>
        </div>
      </div>
      <p className="muted pricing-note">
        Plans are per workspace. Upgrades and downgrades are managed by the
        workspace owner in <Link to="/settings">Settings</Link>.
      </p>
      {isLoading && <p className="muted">Loading plans…</p>}
      {error && <p className="error-text">Could not load plans.</p>}
      <div className="plan-grid">
        {plans?.map((plan) => (
          <PlanCard key={plan.code} plan={plan} />
        ))}
      </div>
    </div>
  );
}

/** One line per plan, tied to what the plan actually changes: its limits. */
const BLURBS: Record<string, string> = {
  free: 'Start with a small roster and the core workflow.',
  starter: 'Room for a growing bench and a wider manager team.',
  pro: 'The full desk: larger rosters, more managers, no tight caps.',
  unlimited: 'No caps on reps or members.',
};

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <section className={`card plan-card${plan.current ? ' plan-current' : ''}`}>
      <div className="plan-head">
        <h2>{plan.name}</h2>
        {plan.current && <span className="pill pill-gold">Current plan</span>}
      </div>
      <p className="plan-blurb">{BLURBS[plan.code] ?? 'Workspace plan.'}</p>
      <ul className="plan-limits">
        <li>
          <strong>{plan.maxReps ?? '∞'}</strong> reps
        </li>
        <li>
          <strong>{plan.maxMembers ?? '∞'}</strong> members
        </li>
      </ul>
      <div className="plan-actions">
        {plan.current ? (
          <span className="plan-current-note">Your plan today</span>
        ) : (
          <Link className="btn btn-sm" to="/settings">
            Manage in Settings
          </Link>
        )}
      </div>
    </section>
  );
}
