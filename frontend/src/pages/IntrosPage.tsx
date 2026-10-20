import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  acceptIntroRequest,
  declineIntroRequest,
  fetchIntroProfile,
  listIncomingIntroRequests,
  listIntroSuggestions,
  listOutgoingIntroRequests,
  requestIntro,
  saveIntroProfile,
} from '../api';

/**
 * Smart intros: the member maintains offering / looking-for tags (plus an
 * industry) on their profile, sees up to 5 ranked suggestions with a
 * one-line reason, and requests an intro. Contact details stay hidden until
 * the other side accepts; the server enforces max 3 pending requests.
 */
export default function IntrosPage() {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Intros</h1>
          <p className="page-sub">
            What you offer, what you need, and who in the workspace matches.
          </p>
        </div>
      </div>

      <ProfileCard />
      <SuggestionsCard />
      <RequestsSection />
    </div>
  );
}

// ------------------------------------------------------------- tag editor

/** Comma-separated tag input → string[] (trimmed, no empties). */
function parseTags(text: string): string[] {
  return text
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '');
}

function ProfileCard() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['intros', 'profile'],
    queryFn: fetchIntroProfile,
  });

  const [offering, setOffering] = useState<string | null>(null);
  const [looking, setLooking] = useState<string | null>(null);
  const [industry, setIndustry] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      saveIntroProfile({
        offeringTags: parseTags(offering ?? data?.offeringTags.join(', ') ?? ''),
        lookingForTags: parseTags(looking ?? data?.lookingForTags.join(', ') ?? ''),
        industry: (industry ?? data?.industry ?? '').trim() || null,
      }),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['intros'] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not save the profile.');
    },
  });

  if (isLoading) return <p className="muted">Loading…</p>;

  return (
    <section className="settings-section card">
      <h2>Your tags</h2>
      <p className="muted">
        Suggestions match your “looking for” against other members' “offering”.
      </p>
      {error && <p className="error-text">{error}</p>}
      <div className="field-row">
        <label className="field">
          <span>Offering (comma-separated)</span>
          <input
            placeholder="e.g. fundraising, hiring, ops"
            value={offering ?? data?.offeringTags.join(', ') ?? ''}
            onChange={(e) => setOffering(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Looking for</span>
          <input
            placeholder="e.g. clients, legal, manufacturing"
            value={looking ?? data?.lookingForTags.join(', ') ?? ''}
            onChange={(e) => setLooking(e.target.value)}
          />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span>Industry</span>
          <input
            placeholder="e.g. Fintech"
            value={industry ?? data?.industry ?? ''}
            onChange={(e) => setIndustry(e.target.value)}
          />
        </label>
      </div>
      <button className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? 'Saving…' : 'Save profile'}
      </button>
    </section>
  );
}

// ------------------------------------------------------------ suggestions

function SuggestionsCard() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['intros', 'suggestions'],
    queryFn: listIntroSuggestions,
  });

  const request = useMutation({
    mutationFn: (userId: number) => requestIntro(userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['intros'] }),
  });

  function requestError(err: unknown): string {
    if (err instanceof ApiError) return err.message;
    return 'Could not send the request.';
  }

  return (
    <section className="settings-section card">
      <h2>Suggested matches</h2>
      {isLoading && <p className="muted">Scanning the roster…</p>}
      {isError && <p className="error-text">Could not load suggestions.</p>}
      {data && data.length === 0 && (
        <p className="muted">
          No matches yet — add more tags to your profile to appear in others' results too.
        </p>
      )}
      {data?.map((s) => (
        <div className="lookup-row" key={s.userId}>
          <span className="name">
            {s.displayName ?? `Member #${s.userId}`}
            <span className="muted"> — {s.reason}</span>
          </span>
          <span className="pill pill-filled">{s.percent}%</span>
          {s.pendingWithYou ? (
            <span className="pill pill-open">requested</span>
          ) : (
            <button
              className="btn btn-sm"
              onClick={() => request.mutate(s.userId)}
              disabled={request.isPending}
            >
              Request intro
            </button>
          )}
          {request.isError && request.variables === s.userId && (
            <span className="error-text">{requestError(request.error)}</span>
          )}
        </div>
      ))}
    </section>
  );
}

// -------------------------------------------------------------- requests

function RequestsSection() {
  return (
    <>
      <IncomingCard />
      <OutgoingCard />
    </>
  );
}

function IncomingCard() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['intros', 'incoming'],
    queryFn: listIncomingIntroRequests,
  });

  const respond = useMutation({
    mutationFn: ({ id, accept }: { id: number; accept: boolean }) =>
      accept ? acceptIntroRequest(id) : declineIntroRequest(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['intros'] }),
  });

  return (
    <section className="settings-section card">
      <h2>Incoming requests</h2>
      {isLoading && <p className="muted">Loading…</p>}
      {data && data.length === 0 && <p className="muted">Nobody has requested an intro yet.</p>}
      {data?.map((r) => (
        <div className="lookup-row" key={r.id}>
          <span className="name">
            {r.fromName ?? `Member #${r.fromUserId}`}
            {r.reason && <span className="muted"> — {r.reason}</span>}
          </span>
          {r.status === 'PENDING' ? (
            <>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => respond.mutate({ id: r.id, accept: true })}
                disabled={respond.isPending}
              >
                Accept
              </button>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => respond.mutate({ id: r.id, accept: false })}
                disabled={respond.isPending}
              >
                Decline
              </button>
            </>
          ) : (
            <span className={`pill ${r.status === 'ACCEPTED' ? 'pill-placed' : 'pill-bench'}`}>
              {r.status.toLowerCase()}
            </span>
          )}
          {r.status === 'ACCEPTED' && r.contactEmail && (
            <span className="muted">{r.contactEmail}</span>
          )}
        </div>
      ))}
    </section>
  );
}

function OutgoingCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['intros', 'outgoing'],
    queryFn: listOutgoingIntroRequests,
  });

  return (
    <section className="settings-section card">
      <h2>Your requests</h2>
      {isLoading && <p className="muted">Loading…</p>}
      {data && data.length === 0 && <p className="muted">You haven't requested any intros.</p>}
      {data?.map((r) => (
        <div className="lookup-row" key={r.id}>
          <span className="name">
            {r.toName ?? `Member #${r.toUserId}`}
            {r.reason && <span className="muted"> — {r.reason}</span>}
          </span>
          <span
            className={`pill ${
              r.status === 'ACCEPTED'
                ? 'pill-placed'
                : r.status === 'DECLINED'
                  ? 'pill-bench'
                  : 'pill-open'
            }`}
          >
            {r.status.toLowerCase()}
          </span>
          {r.status === 'ACCEPTED' && r.contactEmail && (
            <span className="muted">{r.contactEmail}</span>
          )}
        </div>
      ))}
    </section>
  );
}
