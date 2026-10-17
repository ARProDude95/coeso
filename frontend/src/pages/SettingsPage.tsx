import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  RepStatus,
  changePlan,
  createExperienceLevel,
  createMetricType,
  createStatus,
  createVertical,
  deleteExperienceLevel,
  deleteMetricType,
  deleteStatus,
  deleteVertical,
  fetchBranding,
  fetchDiscordSettings,
  fetchSubscription,
  fetchWorkspaceSettings,
  isProFeatureError,
  listExperienceLevels,
  listMetricTypes,
  listPlans,
  listStatuses,
  listVerticals,
  listWorkspaces,
  saveBranding,
  saveDiscordSettings,
  saveWorkspaceSettings,
  startCheckout,
  updateExperienceLevel,
  updateStatus,
  updateVertical,
} from '../api';
import { selectedWorkspaceId } from '../session';

/**
 * Settings: billing (owner only), plus per-workspace lookups (verticals,
 * statuses, experience levels). Lookup editing requires admin/owner; lower
 * roles see a read-only view (the API enforces this — 403s surface as inline
 * errors). Billing is gated in the UI by the caller's role, and the API
 * re-checks it (owner only).
 */
export default function SettingsPage() {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="page-sub">Billing, branding, Discord and your workspace lookups.</p>
        </div>
      </div>
      <p className="muted" style={{ marginTop: '-0.75rem', marginBottom: '1.5rem' }}>
        Customise the lookups your workspace uses. Editing requires an admin or
        owner role.
      </p>
      <BillingSection />
      <BrandingSection />
      <DiscordSection />
      <LookupSection
        title="Verticals"
        useData={() => useQuery({ queryKey: ['verticals'], queryFn: listVerticals })}
        create={(name) => createVertical(name)}
        rename={(id, name) => updateVertical(id, name)}
        remove={(id) => deleteVertical(id)}
        nameLabel="Vertical"
      />
      <StatusSection />
      <LookupSection
        title="Experience levels"
        useData={() => useQuery({ queryKey: ['levels'], queryFn: listExperienceLevels })}
        create={(name) => createExperienceLevel(name)}
        rename={(id, name) => updateExperienceLevel(id, name)}
        remove={(id) => deleteExperienceLevel(id)}
        nameLabel="Experience level"
      />
      <PerformanceSection />
      <LeaderboardVisibilitySection />
    </div>
  );
}

interface LookupItem {
  id: number;
  name: string;
}

function LookupSection({
  title,
  useData,
  create,
  rename,
  remove,
  nameLabel,
}: {
  title: string;
  useData: () => { data: LookupItem[] | undefined; isLoading: boolean };
  create: (name: string) => Promise<unknown>;
  rename: (id: number, name: string) => Promise<unknown>;
  remove: (id: number) => Promise<unknown>;
  nameLabel: string;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useData();
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [error, setError] = useState<string | null>(null);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['verticals'] });
    queryClient.invalidateQueries({ queryKey: ['statuses'] });
    queryClient.invalidateQueries({ queryKey: ['levels'] });
  }

  function report(err: unknown) {
    setError(err instanceof ApiError ? err.message : 'Operation failed');
  }

  const addMutation = useMutation({
    mutationFn: () => create(newName.trim()),
    onSuccess: () => {
      setNewName('');
      setError(null);
      invalidate();
    },
    onError: report,
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => rename(id, name),
    onSuccess: () => {
      setEditingId(null);
      setError(null);
      invalidate();
    },
    onError: report,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => remove(id),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: report,
  });

  return (
    <section className="settings-section card">
      <h2>{title}</h2>
      {isLoading && <p className="muted">Loading…</p>}
      {error && <p className="error-text">{error}</p>}

      <form
        className="table-bar"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (newName.trim()) {
            addMutation.mutate();
          }
        }}
      >
        <input
          placeholder={`New ${nameLabel.toLowerCase()}…`}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button className="btn btn-primary" type="submit" disabled={addMutation.isPending}>
          Add
        </button>
      </form>

      <div>
        {data?.map((item) => (
          <div key={item.id} className="lookup-row">
            {editingId === item.id ? (
              <>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  aria-label={`Rename ${item.name}`}
                />
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => renameMutation.mutate({ id: item.id, name: editName.trim() })}
                  disabled={renameMutation.isPending}
                >
                  Save
                </button>
                <button className="btn btn-sm" onClick={() => setEditingId(null)}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span className="name">{item.name}</span>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    setEditingId(item.id);
                    setEditName(item.name);
                  }}
                >
                  Rename
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => deleteMutation.mutate(item.id)}
                  disabled={deleteMutation.isPending}
                >
                  Delete
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Billing: current plan and upgrade/downgrade actions. Owner only — the API
 * enforces it too, but the section is hidden for lower roles so they are not
 * shown buttons that would 403.
 *
 * Two paths from here:
 *  - "Upgrade" starts hosted checkout (Stripe) and follows its redirect; the
 *    subscription only becomes ACTIVE when the verified webhook confirms it.
 *  - "Switch" changes the plan directly (free plan, or a downgrade that is
 *    still within limits). Over-limit downgrades come back as 409 with a
 *    message naming the offending resource.
 */
function BillingSection() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data: workspaces } = useQuery({ queryKey: ['workspaces'], queryFn: listWorkspaces });
  const activeId = selectedWorkspaceId();
  const activeRole = workspaces?.find((w) => w.id === activeId)?.role;
  const isOwner = activeRole === 'OWNER';

  const { data: subscription } = useQuery({
    queryKey: ['subscription'],
    queryFn: fetchSubscription,
    enabled: activeId != null,
  });
  const { data: plans } = useQuery({ queryKey: ['plans'], queryFn: listPlans });

  const switchMutation = useMutation({
    mutationFn: (planCode: string) => changePlan(planCode),
    onSuccess: () => {
      setError(null);
      setNotice('Plan updated.');
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      queryClient.invalidateQueries({ queryKey: ['plans'] });
    },
    onError: (err) => {
      setNotice(null);
      setError(err instanceof ApiError ? err.message : 'Plan change failed');
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: (planCode: string) => startCheckout(planCode),
    onSuccess: (session) => {
      // Hand the browser to the provider's hosted checkout page.
      window.location.assign(session.url);
    },
    onError: (err) => {
      setError(
        err instanceof ApiError && err.code === 'BILLING_NOT_CONFIGURED'
          ? 'Payment provider is not configured on this server yet.'
          : err instanceof ApiError
            ? err.message
            : 'Checkout failed',
      );
    },
  });

  return (
    <section className="settings-section card">
      <h2>Billing</h2>
      {subscription && (
        <dl className="billing-status">
          <div>
            <dt>Plan</dt>
            <dd>{subscription.planName}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <span className="pill pill-gold">{subscription.status}</span>
            </dd>
          </div>
          {subscription.trialEndsAt && (
            <div>
              <dt>Trial ends</dt>
              <dd>{new Date(subscription.trialEndsAt).toLocaleDateString()}</dd>
            </div>
          )}
        </dl>
      )}
      {error && <p className="error-text">{error}</p>}
      {notice && <p className="muted">{notice}</p>}

      {!isOwner ? (
        <p className="muted">Only the workspace owner can change plans.</p>
      ) : (
        <div className="plan-grid">
          {plans?.map((plan) => (
            <section key={plan.code} className={`card plan-card${plan.current ? ' plan-current' : ''}`}>
              <h2>{plan.name}</h2>
              <ul className="plan-limits">
                <li>
                  <strong>{plan.maxReps ?? '∞'}</strong> reps
                </li>
                <li>
                  <strong>{plan.maxMembers ?? '∞'}</strong> members
                </li>
              </ul>
              {!plan.current && (
                <div className="plan-actions">
                  {plan.code === 'free' ? (
                    <button
                      className="btn btn-sm"
                      onClick={() => switchMutation.mutate(plan.code)}
                      disabled={switchMutation.isPending}
                    >
                      Switch
                    </button>
                  ) : (
                    <>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => checkoutMutation.mutate(plan.code)}
                        disabled={checkoutMutation.isPending}
                      >
                        Upgrade
                      </button>
                      <button
                        className="btn btn-sm"
                        onClick={() => switchMutation.mutate(plan.code)}
                        disabled={switchMutation.isPending}
                        title="Switch without payment (downgrades beyond your current usage are blocked)"
                      >
                        Switch
                      </button>
                    </>
                  )}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * White-label branding: logo URL, accent color and custom domain. The accent
 * color becomes the --accent CSS variable everywhere (applied in the Layout).
 * Admin/owner only — the API re-checks; lower roles see the saved values.
 */
function BrandingSection() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['branding'], queryFn: fetchBranding });
  const [logoUrl, setLogoUrl] = useState('');
  const [accentColor, setAccentColor] = useState('');
  const [customDomain, setCustomDomain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      setLogoUrl(data.logoUrl ?? '');
      setAccentColor(data.accentColor ?? '');
      setCustomDomain(data.customDomain ?? '');
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      saveBranding({
        logoUrl: logoUrl.trim() || null,
        accentColor: accentColor.trim() || null,
        customDomain: customDomain.trim() || null,
      }),
    onSuccess: () => {
      setError(null);
      setNotice('Branding saved.');
      queryClient.invalidateQueries({ queryKey: ['branding'] });
    },
    onError: (err) => {
      setNotice(null);
      setError(err instanceof ApiError ? err.message : 'Saving branding failed');
    },
  });

  return (
    <section className="settings-section card">
      <h2>Branding</h2>
      <p className="muted">Applied as a CSS variable across the app. Editing requires admin or owner.</p>
      {error && <p className="error-text">{error}</p>}
      {notice && <p className="muted">{notice}</p>}
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          saveMutation.mutate();
        }}
      >
        <div className="field">
          <label htmlFor="logo-url">Logo URL</label>
          <input
            id="logo-url"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://cdn.example.com/logo.png"
          />
        </div>
        <div className="field">
          <label htmlFor="accent-color">Accent color (hex)</label>
          <input
            id="accent-color"
            value={accentColor}
            onChange={(e) => setAccentColor(e.target.value)}
            placeholder="#cda35a"
          />
        </div>
        <div className="field">
          <label htmlFor="custom-domain">Custom domain (optional)</label>
          <input
            id="custom-domain"
            value={customDomain}
            onChange={(e) => setCustomDomain(e.target.value)}
            placeholder="roster.example.com"
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving…' : 'Save branding'}
        </button>
      </form>
    </section>
  );
}

/** Discord server connection + role map (admin/owner only, API-enforced). */
function DiscordSection() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['discord-settings'], queryFn: fetchDiscordSettings });
  const [guildId, setGuildId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [rows, setRows] = useState<{ roleId: string; role: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      setGuildId(data.guildId ?? '');
      setChannelId(data.notificationChannelId ?? '');
      setRows(
        Object.entries(data.roleMap ?? {}).map(([roleId, role]) => ({ roleId, role })),
      );
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const roleMap: Record<string, string> = {};
      for (const row of rows) {
        if (row.roleId.trim() && row.role) {
          roleMap[row.roleId.trim()] = row.role;
        }
      }
      return saveDiscordSettings({
        guildId: guildId.trim(),
        notificationChannelId: channelId.trim() || null,
        roleMap,
      });
    },
    onSuccess: () => {
      setError(null);
      setNotice('Discord connection saved. Roles sync when members sign in with Discord.');
      queryClient.invalidateQueries({ queryKey: ['discord-settings'] });
    },
    onError: (err) => {
      setNotice(null);
      setError(err instanceof ApiError ? err.message : 'Saving Discord settings failed');
    },
  });

  return (
    <section className="settings-section card">
      <h2>Discord</h2>
      <p className="muted">
        Connect a server for notifications and role sync. Roles sync when members
        sign in with Discord; the owner role can never be granted this way.
        Editing requires admin or owner.
      </p>
      {error && <p className="error-text">{error}</p>}
      {notice && <p className="muted">{notice}</p>}
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          saveMutation.mutate();
        }}
      >
        <div className="field">
          <label htmlFor="guild-id">Guild (server) ID</label>
          <input
            id="guild-id"
            value={guildId}
            onChange={(e) => setGuildId(e.target.value)}
            placeholder="123456789012345678"
          />
        </div>
        <div className="field">
          <label htmlFor="channel-id">Notification channel ID</label>
          <input
            id="channel-id"
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            placeholder="123456789012345678"
          />
        </div>
        <label>Role map (Discord role ID → workspace role)</label>
        {rows.map((row, index) => (
          <div className="table-bar" key={index}>
            <input
              value={row.roleId}
              placeholder="Discord role ID"
              aria-label="Discord role ID"
              onChange={(e) =>
                setRows(rows.map((r, i) => (i === index ? { ...r, roleId: e.target.value } : r)))
              }
            />
            <select
              style={{ width: 'auto' }}
              value={row.role}
              aria-label="Workspace role"
              onChange={(e) =>
                setRows(rows.map((r, i) => (i === index ? { ...r, role: e.target.value } : r)))
              }
            >
              <option value="MANAGER">Manager</option>
              <option value="ADMIN">Admin</option>
              <option value="REP">Rep</option>
            </select>
            <button
              className="btn btn-sm btn-danger"
              type="button"
              onClick={() => setRows(rows.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </div>
        ))}
        <div className="table-bar">
          <button
            className="btn btn-sm"
            type="button"
            onClick={() => setRows([...rows, { roleId: '', role: 'MANAGER' }])}
          >
            + Add mapping
          </button>
        </div>
        <button className="btn btn-primary" type="submit" disabled={saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving…' : 'Save Discord settings'}
        </button>
      </form>
    </section>
  );
}

/** Statuses additionally carry a fixed kind (BENCH / TRAINING / INACTIVE). */
function StatusSection() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['statuses'], queryFn: listStatuses });
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<RepStatus['kind']>('BENCH');
  const [error, setError] = useState<string | null>(null);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['statuses'] });
  }

  function report(err: unknown) {
    setError(err instanceof ApiError ? err.message : 'Operation failed');
  }

  const addMutation = useMutation({
    mutationFn: () => createStatus(newName.trim(), newKind),
    onSuccess: () => {
      setNewName('');
      setError(null);
      invalidate();
    },
    onError: report,
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name, kind }: { id: number; name: string; kind: RepStatus['kind'] }) =>
      updateStatus(id, name, kind),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: report,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteStatus(id),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: report,
  });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editKind, setEditKind] = useState<RepStatus['kind']>('BENCH');

  return (
    <section className="settings-section card">
      <h2>Rep statuses</h2>
      {isLoading && <p className="muted">Loading…</p>}
      {error && <p className="error-text">{error}</p>}

      <form
        className="table-bar"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (newName.trim()) {
            addMutation.mutate();
          }
        }}
      >
        <input
          placeholder="New status…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <select
          value={newKind}
          onChange={(e) => setNewKind(e.target.value as RepStatus['kind'])}
          style={{ width: 'auto' }}
          aria-label="Status kind"
        >
          <option value="BENCH">Bench</option>
          <option value="TRAINING">Training</option>
          <option value="INACTIVE">Inactive</option>
        </select>
        <button className="btn btn-primary" type="submit" disabled={addMutation.isPending}>
          Add
        </button>
      </form>

      <div>
        {data?.map((status) => (
          <div key={status.id} className="lookup-row">
            {editingId === status.id ? (
              <>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  aria-label={`Rename ${status.name}`}
                />
                <select
                  value={editKind}
                  onChange={(e) => setEditKind(e.target.value as RepStatus['kind'])}
                  style={{ width: 'auto' }}
                  aria-label="Status kind"
                >
                  <option value="BENCH">Bench</option>
                  <option value="TRAINING">Training</option>
                  <option value="INACTIVE">Inactive</option>
                </select>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() =>
                    renameMutation.mutate({ id: status.id, name: editName.trim(), kind: editKind })
                  }
                  disabled={renameMutation.isPending}
                >
                  Save
                </button>
                <button className="btn btn-sm" onClick={() => setEditingId(null)}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span className="name">
                  {status.name} <span className="pill">{status.kind}</span>
                </span>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    setEditingId(status.id);
                    setEditName(status.name);
                    setEditKind(status.kind);
                  }}
                >
                  Rename
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => deleteMutation.mutate(status.id)}
                  disabled={deleteMutation.isPending}
                >
                  Delete
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Performance metric types [PRO] — the per-workspace vocabulary activity is
 * logged in (calls, meetings, revenue, custom). Counts and money (minor
 * units); a metric that is still in use cannot be deleted. Writing requires
 * admin/owner (API-enforced) and the Pro plan.
 */
function PerformanceSection() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['metric-types'],
    queryFn: listMetricTypes,
    retry: false,
  });
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<'count' | 'currency'>('count');
  const [notice, setNotice] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['metric-types'] });
  }

  function report(err: unknown) {
    setNotice(null);
    setErrMsg(err instanceof ApiError ? err.message : 'Operation failed');
  }

  const addMutation = useMutation({
    mutationFn: () => createMetricType(name.trim(), unit),
    onSuccess: () => {
      setName('');
      setErrMsg(null);
      invalidate();
    },
    onError: report,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteMetricType(id),
    onSuccess: () => {
      setErrMsg(null);
      setNotice('Metric removed.');
      invalidate();
    },
    onError: report,
  });

  const proLocked = isError && isProFeatureError(error);

  return (
    <section className="settings-section card">
      <h2>Performance metrics</h2>
      <p className="muted">
        The metric types activity is logged against — counts and money (stored
        as minor units). Deleting a metric that entries use is blocked.
        Writing requires admin or owner.
      </p>
      {proLocked && (
        <p className="muted">
          Performance metrics are available on the Pro plan.{' '}
          <a href="/pricing">Upgrade your plan</a>.
        </p>
      )}
      {isError && !proLocked && (
        <p className="error-text">
          {error instanceof ApiError ? error.message : 'Could not load metrics.'}
        </p>
      )}
      {notice && <p className="muted">{notice}</p>}
      {errMsg && <p className="error-text">{errMsg}</p>}
      {!proLocked && (
        <form
          className="table-bar"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (name.trim()) addMutation.mutate();
          }}
        >
          <input
            placeholder="e.g. Demos booked"
            value={name}
            aria-label="Metric name"
            onChange={(e) => setName(e.target.value)}
          />
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value as 'count' | 'currency')}
            style={{ width: 'auto' }}
            aria-label="Metric unit"
          >
            <option value="count">Count</option>
            <option value="currency">Money</option>
          </select>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={addMutation.isPending || !name.trim()}
          >
            {addMutation.isPending ? 'Adding…' : 'Add metric'}
          </button>
        </form>
      )}
      {!proLocked && isLoading && <p className="muted">Loading…</p>}
      {!proLocked &&
        (data ?? []).map((metric) => (
          <div className="lookup-row" key={metric.id}>
            <span className="name">
              {metric.name} <span className="pill">{metric.unit}</span>
            </span>
            <button
              className="btn btn-sm btn-danger"
              onClick={() => deleteMutation.mutate(metric.id)}
              disabled={deleteMutation.isPending}
            >
              Delete
            </button>
          </div>
        ))}
    </section>
  );
}

/**
 * Whether reps see other reps' names on the leaderboard (workspace setting,
 * Phase 7). Off by default: reps then only see their own rank.
 */
function LeaderboardVisibilitySection() {
  const queryClient = useQueryClient();
  const { data, isError, error } = useQuery({
    queryKey: ['workspace-settings'],
    queryFn: fetchWorkspaceSettings,
    retry: false,
  });
  const [showNames, setShowNames] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    if (data) setShowNames(data.leaderboardShowNames);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      saveWorkspaceSettings({ leaderboardShowNames: showNames ?? false }),
    onSuccess: () => {
      setErrMsg(null);
      setNotice(
        (showNames ?? false)
          ? 'Saved — reps now see each other on the leaderboard.'
          : 'Saved — reps only see their own rank.',
      );
      queryClient.invalidateQueries({ queryKey: ['workspace-settings'] });
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
    },
    onError: (err) => {
      setNotice(null);
      setErrMsg(err instanceof ApiError ? err.message : 'Saving failed');
    },
  });

  return (
    <section className="settings-section card">
      <h2>Leaderboard visibility</h2>
      <p className="muted">
        When off, reps only see their own rank; other names are masked by the
        server. Owners and admins always see everyone.
      </p>
      {isError && (
        <p className="error-text">
          {error instanceof ApiError ? error.message : 'Could not load settings.'}
        </p>
      )}
      {notice && <p className="muted">{notice}</p>}
      {errMsg && <p className="error-text">{errMsg}</p>}
      {showNames !== null && (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            saveMutation.mutate();
          }}
        >
          <label className="lookup-row" style={{ cursor: 'pointer' }}>
            <span className="name">Show rep names on the leaderboard</span>
            <input
              type="checkbox"
              checked={showNames}
              onChange={(e) => setShowNames(e.target.checked)}
            />
          </label>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? 'Saving…' : 'Save setting'}
          </button>
        </form>
      )}
    </section>
  );
}
