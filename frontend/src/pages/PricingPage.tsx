import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { listPlans, Plan } from '../api';

/**
 * Pricing: the four plans with their limits, the current one flagged. Any
 * member can look; upgrading is done from Settings (owner only), so this page
 * links there instead of acting itself.
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
      <p className="muted" style={{ marginTop: '-0.75rem', marginBottom: '1.5rem' }}>
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

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <section className={`card plan-card${plan.current ? ' plan-current' : ''}`}>
      <h2>{plan.name}</h2>
      {plan.current && <span className="pill pill-gold">Current plan</span>}
      <ul className="plan-limits">
        <li>
          <strong>{plan.maxReps ?? '∞'}</strong> reps
        </li>
        <li>
          <strong>{plan.maxMembers ?? '∞'}</strong> members
        </li>
      </ul>
    </section>
  );
}
