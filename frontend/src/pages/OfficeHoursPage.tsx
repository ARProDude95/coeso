import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  OfficeHourBooking,
  bookSlot,
  cancelBooking,
  cancelSlot,
  createSlot,
  fetchCommissionBp,
  listMyBookings,
  listMySlots,
  listOpenSlots,
  listWorkspaces,
  saveCommissionBp,
  setMeetingLink,
} from '../api';
import { selectedWorkspaceId } from '../session';

/**
 * Paid office hours: experts publish timed slots with an INR price, members
 * book them through Razorpay (the booking confirms only after the verified
 * payment webhook), both sides see upcoming sessions with a pasteable
 * meeting link, and owners set the per-space platform commission.
 */
export default function OfficeHoursPage() {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Office hours</h1>
          <p className="page-sub">
            Book time with experts in your workspace — paid per session.
          </p>
        </div>
      </div>

      <BookingsSection />
      <OpenSlotsSection />
      <MySlotsSection />
      <CommissionSection />
    </div>
  );
}

// ------------------------------------------------------------- formatting

function formatMoney(minor: number, currency: string): string {
  const major = minor / 100;
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return `${symbol}${major.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

const BOOKING_PILL: Record<OfficeHourBooking['status'], string> = {
  PENDING: 'pill pill-open',
  CONFIRMED: 'pill pill-placed',
  CANCELLED: 'pill pill-bench',
  REFUND_PENDING: 'pill pill-training',
  REFUNDED: 'pill pill-danger',
};

// --------------------------------------------------------------- bookings

function BookingsSection() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['oh', 'bookings'],
    queryFn: listMyBookings,
  });

  const cancel = useMutation({
    mutationFn: (id: number) => cancelBooking(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oh'] });
    },
  });

  const [linkDrafts, setLinkDrafts] = useState<Record<number, string>>({});
  const saveLink = useMutation({
    mutationFn: ({ id, link }: { id: number; link: string }) => setMeetingLink(id, link),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['oh'] }),
  });

  function bookingRow(b: OfficeHourBooking, side: 'member' | 'expert') {
    const other = side === 'member' ? (b.expertName ?? 'Expert') : 'Member';
    return (
      <div className="lookup-row" key={`${side}-${b.id}`}>
        <span className="name">
          {other}
          <span className="muted">
            {' '}
            — {formatWhen(b.startsAt)}
            {b.durationMinutes ? ` · ${b.durationMinutes}m` : ''}
          </span>
        </span>
        <span className={BOOKING_PILL[b.status]}>{b.status.toLowerCase().replace('_', ' ')}</span>
        <span>{formatMoney(b.priceMinor, b.currency)}</span>
        {b.status === 'CONFIRMED' && b.meetingLink && (
          <a className="muted" href={b.meetingLink} target="_blank" rel="noreferrer">
            Join link
          </a>
        )}
        {b.status === 'CONFIRMED' && !b.meetingLink && side === 'expert' && (
          <>
            <input
              placeholder="Paste meeting link…"
              value={linkDrafts[b.id] ?? ''}
              onChange={(e) => setLinkDrafts({ ...linkDrafts, [b.id]: e.target.value })}
            />
            <button
              className="btn btn-sm"
              disabled={saveLink.isPending || !(linkDrafts[b.id] ?? '').trim()}
              onClick={() =>
                saveLink.mutate({ id: b.id, link: (linkDrafts[b.id] ?? '').trim() })
              }
            >
              Save link
            </button>
          </>
        )}
        {(b.status === 'CONFIRMED' || b.status === 'PENDING') && (
          <button
            className="btn btn-sm btn-ghost"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate(b.id)}
          >
            Cancel
          </button>
        )}
      </div>
    );
  }

  const none =
    data && data.asMember.length === 0 && data.asExpert.length === 0;

  return (
    <section className="settings-section card">
      <h2>Your bookings</h2>
      {isLoading && <p className="muted">Loading…</p>}
      {none && <p className="muted">No bookings yet.</p>}
      {data && data.asMember.length > 0 && (
        <>
          <h3>As member</h3>
          {data.asMember.map((b) => bookingRow(b, 'member'))}
        </>
      )}
      {data && data.asExpert.length > 0 && (
        <>
          <h3>As expert</h3>
          {data.asExpert.map((b) => bookingRow(b, 'expert'))}
        </>
      )}
      {cancel.isError && (
        <p className="error-text">
          {cancel.error instanceof ApiError ? cancel.error.message : 'Cancel failed.'}
        </p>
      )}
    </section>
  );
}

// ------------------------------------------------------------- open slots

function OpenSlotsSection() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['oh', 'slots', 'open'],
    queryFn: listOpenSlots,
  });

  const book = useMutation({
    mutationFn: (id: number) => bookSlot(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['oh'] }),
  });

  return (
    <section className="settings-section card">
      <h2>Open slots</h2>
      {isLoading && <p className="muted">Loading…</p>}
      {data && data.length === 0 && <p className="muted">No open slots right now.</p>}
      {data?.map((s) => (
        <div className="lookup-row" key={s.id}>
          <span className="name">
            {s.expertName ?? `Expert #${s.expertUserId}`}
            <span className="muted">
              {' '}
              — {formatWhen(s.startsAt)} · {s.durationMinutes}m
            </span>
          </span>
          <span>{formatMoney(s.priceMinor, s.currency)}</span>
          <button
            className="btn btn-sm btn-primary"
            disabled={book.isPending}
            onClick={() => book.mutate(s.id)}
          >
            Book &amp; pay
          </button>
        </div>
      ))}
      {book.isSuccess && book.data && (
        <p className="muted">
          Booking {book.data.status.toLowerCase()} — order {book.data.orderId ?? 'created'} for{' '}
          {formatMoney(book.data.amountMinor, book.data.currency)}. It confirms once the payment
          webhook verifies.
        </p>
      )}
      {book.isError && (
        <p className="error-text">
          {book.error instanceof ApiError ? book.error.message : 'Booking failed.'}
        </p>
      )}
    </section>
  );
}

// --------------------------------------------------------------- my slots

function MySlotsSection() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['oh', 'slots', 'mine'],
    queryFn: listMySlots,
  });

  const [startsAt, setStartsAt] = useState('');
  const [duration, setDuration] = useState('30');
  const [priceRupees, setPriceRupees] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      createSlot({
        startsAt: new Date(startsAt).toISOString(),
        durationMinutes: Number(duration),
        priceMinor: Math.round(Number(priceRupees) * 100),
        currency: 'INR',
      }),
    onSuccess: () => {
      setError(null);
      setStartsAt('');
      setPriceRupees('');
      queryClient.invalidateQueries({ queryKey: ['oh'] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not create the slot.');
    },
  });

  const cancel = useMutation({
    mutationFn: (id: number) => cancelSlot(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['oh'] }),
  });

  const canCreate = startsAt !== '' && priceRupees !== '' && Number(priceRupees) > 0;

  return (
    <section className="settings-section card">
      <h2>My slots</h2>
      <p className="muted">Experts only — publish a time and price to be bookable.</p>
      {error && <p className="error-text">{error}</p>}
      <div className="field-row">
        <label className="field">
          <span>Starts at</span>
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Minutes</span>
          <input
            type="number"
            min={5}
            step={5}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Price (₹)</span>
          <input
            type="number"
            min={1}
            placeholder="2500"
            value={priceRupees}
            onChange={(e) => setPriceRupees(e.target.value)}
          />
        </label>
      </div>
      <button
        className="btn btn-primary"
        disabled={!canCreate || create.isPending}
        onClick={() => create.mutate()}
      >
        {create.isPending ? 'Publishing…' : 'Publish slot'}
      </button>

      {isLoading && <p className="muted">Loading…</p>}
      {data?.map((s) => (
        <div className="lookup-row" key={s.id}>
          <span className="name">
            {formatWhen(s.startsAt)}
            <span className="muted"> · {s.durationMinutes}m</span>
          </span>
          <span>{formatMoney(s.priceMinor, s.currency)}</span>
          <span className={`pill ${s.status === 'OPEN' ? 'pill-open' : 'pill-bench'}`}>
            {s.status.toLowerCase()}
          </span>
          {s.status === 'OPEN' && (
            <button
              className="btn btn-sm btn-ghost"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate(s.id)}
            >
              Cancel slot
            </button>
          )}
        </div>
      ))}
    </section>
  );
}

// ------------------------------------------------------------- commission

function CommissionSection() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['oh', 'commission'],
    queryFn: fetchCommissionBp,
  });

  // The setter is owner-only server-side; only owners see the editor.
  const { data: workspaces } = useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
  });
  const isOwner =
    workspaces?.find((w) => w.id === selectedWorkspaceId())?.role === 'OWNER';

  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (bp: number) => saveCommissionBp(bp),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['oh', 'commission'] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not save the commission.');
    },
  });

  if (!data) return null;

  const currentBp = data.commissionBp;
  const draftBp = draft == null ? currentBp : Number(draft);
  const valid = Number.isFinite(draftBp) && draftBp >= 0 && draftBp <= 5000;

  return (
    <section className="settings-section card">
      <h2>Platform commission</h2>
      <p className="muted">
        Current: {(currentBp / 100).toFixed(2)}% per booking
        {isOwner ? ' (owner-only setting, default 10%).' : '.'}
      </p>
      {!isOwner && <p className="muted">Only the workspace owner can change it.</p>}
      {error && <p className="error-text">{error}</p>}
      {isOwner && (
        <>
          <div className="field-row">
            <label className="field">
              <span>Commission (%)</span>
              <input
                type="number"
                min={0}
                max={50}
                step={0.5}
                value={draft == null ? currentBp / 100 : draftBp / 100}
                onChange={(e) => setDraft(String(Math.round(Number(e.target.value) * 100)))}
              />
            </label>
          </div>
          <button
            className="btn btn-primary"
            disabled={!valid || save.isPending || draft == null}
            onClick={() => save.mutate(draftBp)}
          >
            {save.isPending ? 'Saving…' : 'Save commission'}
          </button>
        </>
      )}
    </section>
  );
}
