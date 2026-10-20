import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  PodDraftView,
  fetchPod,
  generatePodPreview,
  listMyPods,
  listPodCheckins,
  listWorkspaces,
  publishPods,
  submitPodCheckin,
} from '../api';
import { selectedWorkspaceId } from '../session';

/**
 * Mastermind pods: members see their own pod with attendance streaks and
 * file this week's check-in (wins / blockers / ask). Admins additionally
 * generate a deterministic preview grouping, can adjust it, and publish —
 * publishing archives the previous generation.
 */
export default function PodsPage() {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Mastermind pods</h1>
          <p className="page-sub">
            Small groups that meet weekly — wins, blockers, and asks.
          </p>
        </div>
      </div>

      <AdminPanel />
      <MyPodsSection />
    </div>
  );
}

// ------------------------------------------------------------- admin panel

function AdminPanel() {
  const { data: workspaces } = useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
  });
  const role = workspaces?.find((w) => w.id === selectedWorkspaceId())?.role;
  if (role !== 'OWNER' && role !== 'ADMIN') return null;
  return <AdminPanelInner />;
}

function AdminPanelInner() {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<PodDraftView[] | null>(null);
  const [prefix, setPrefix] = useState('Pod');
  const [error, setError] = useState<string | null>(null);

  const generate = useMutation({
    mutationFn: () => generatePodPreview(),
    onSuccess: (drafts) => {
      setError(null);
      setPreview(drafts);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not generate pods.');
    },
  });

  const publish = useMutation({
    mutationFn: () =>
      publishPods({
        namePrefix: prefix.trim() || 'Pod',
        drafts: (preview ?? []).map((d) => ({ industry: d.industry, userIds: d.userIds })),
      }),
    onSuccess: () => {
      setError(null);
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: ['pods'] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not publish pods.');
    },
  });

  return (
    <section className="settings-section card">
      <h2>Generate pods</h2>
      <p className="muted">
        Groups active members into pods by industry. Preview first, adjust, then publish —
        the previous generation is archived.
      </p>
      {error && <p className="error-text">{error}</p>}
      <div className="field-row">
        <label className="field">
          <span>Name prefix</span>
          <input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="Pod" />
        </label>
      </div>
      <button className="btn" onClick={() => generate.mutate()} disabled={generate.isPending}>
        {generate.isPending ? 'Grouping…' : preview ? 'Regenerate' : 'Generate preview'}
      </button>

      {preview && (
        <>
          {preview.map((d, i) => (
            <div className="lookup-row" key={`${d.industry ?? 'general'}-${i}`}>
              <span className="name">
                {d.industry ?? 'General'}
                <span className="muted"> — {d.userIds.length} members</span>
              </span>
              <span className="muted">{d.names.filter(Boolean).join(', ')}</span>
            </div>
          ))}
          <button
            className="btn btn-primary"
            disabled={publish.isPending || preview.length === 0}
            onClick={() => publish.mutate()}
          >
            {publish.isPending ? 'Publishing…' : `Publish ${preview.length} pods`}
          </button>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- my pods

function MyPodsSection() {
  const { data, isLoading } = useQuery({
    queryKey: ['pods', 'mine'],
    queryFn: listMyPods,
  });

  return (
    <>
      <section className="settings-section card">
        <h2>My pods</h2>
        {isLoading && <p className="muted">Loading…</p>}
        {data && data.length === 0 && (
          <p className="muted">You're not in any active pod yet.</p>
        )}
        {data?.map((pod) => (
          <PodCard key={pod.id} podId={pod.id} name={pod.name} industry={pod.industry} />
        ))}
      </section>
    </>
  );
}

function PodCard({
  podId,
  name,
  industry,
}: {
  podId: number;
  name: string;
  industry: string | null;
}) {
  const queryClient = useQueryClient();
  const [showCheckin, setShowCheckin] = useState(false);
  const [wins, setWins] = useState('');
  const [blockers, setBlockers] = useState('');
  const [ask, setAsk] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: pod } = useQuery({
    queryKey: ['pods', 'detail', podId],
    queryFn: () => fetchPod(podId),
  });
  const { data: checkins } = useQuery({
    queryKey: ['pods', 'checkins', podId],
    queryFn: () => listPodCheckins(podId),
  });

  const submit = useMutation({
    mutationFn: () =>
      submitPodCheckin(podId, {
        wins: wins.trim(),
        blockers: blockers.trim(),
        ask: ask.trim() || null,
      }),
    onSuccess: () => {
      setError(null);
      setWins('');
      setBlockers('');
      setAsk('');
      setShowCheckin(false);
      queryClient.invalidateQueries({ queryKey: ['pods'] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not save the check-in.');
    },
  });

  return (
    <div className="board-card">
      <div className="board-card-top">
        <span className="board-client">
          {name}
          {industry && <span className="muted"> — {industry}</span>}
        </span>
        <button className="btn btn-sm" onClick={() => setShowCheckin(!showCheckin)}>
          {showCheckin ? 'Close' : 'Check in this week'}
        </button>
      </div>

      <div className="board-list">
        {(pod?.members ?? []).map((m) => (
          <div className="lookup-row" key={m.userId}>
            <span className="name">{m.displayName ?? `Member #${m.userId}`}</span>
            {(m.streak ?? 0) > 0 && (
              <span className="pill pill-gold">{m.streak}-week streak</span>
            )}
          </div>
        ))}
      </div>

      {showCheckin && (
        <div className="field-row">
          <label className="field">
            <span>Wins *</span>
            <textarea
              rows={2}
              value={wins}
              onChange={(e) => setWins(e.target.value)}
              placeholder="What went well this week?"
            />
          </label>
          <label className="field">
            <span>Blockers *</span>
            <textarea
              rows={2}
              value={blockers}
              onChange={(e) => setBlockers(e.target.value)}
              placeholder="What's in the way?"
            />
          </label>
          <label className="field">
            <span>Ask</span>
            <input
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              placeholder="What do you need from the pod?"
            />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button
            className="btn btn-primary"
            disabled={submit.isPending || !wins.trim() || !blockers.trim()}
            onClick={() => submit.mutate()}
          >
            {submit.isPending ? 'Saving…' : 'Submit check-in'}
          </button>
        </div>
      )}

      {checkins && checkins.length > 0 && (
        <>
          <h4>Recent check-ins</h4>
          {checkins.map((c) => (
            <div className="lookup-row" key={c.id}>
              <span className="name">
                {c.displayName ?? `Member #${c.userId}`}
                <span className="muted"> — week of {c.weekStart}</span>
              </span>
              <span className="muted">
                wins: {c.wins} · blockers: {c.blockers}
                {c.ask && ` · ask: ${c.ask}`}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
