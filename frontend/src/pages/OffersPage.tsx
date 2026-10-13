import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  Offer,
  OfferFilters,
  closeOffer,
  createOffer,
  endPlacement,
  listClients,
  listOffers,
  listPlacements,
  listReps,
  listVerticals,
  placeRep,
  updateOffer,
} from '../api';
import Modal from '../components/Modal';

/** Offers: filter sidebar, cards with seat progress and rep chips, place rep. */
export default function OffersPage() {
  const queryClient = useQueryClient();

  const [q, setQ] = useState('');
  const [verticalId, setVerticalId] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const filters: OfferFilters = useMemo(() => ({
    q: q || undefined,
    verticalId: verticalId ?? undefined,
    effectiveStatus: status ?? undefined,
  }), [q, verticalId, status]);

  const hasFilters = q !== '' || verticalId != null || status != null;

  const { data: verticals } = useQuery({ queryKey: ['verticals'], queryFn: listVerticals });
  const { data: offers, isLoading } = useQuery({
    queryKey: ['offers', filters],
    queryFn: () => listOffers(filters),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['offers'] });
    queryClient.invalidateQueries({ queryKey: ['reps'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Offers</h1>
        <NewOfferButton onCreated={invalidate} />
      </div>

      <div className="with-sidebar">
        <aside className="filter-sidebar">
          <div className="filter-group">
            <h4>Search</h4>
            <input
              placeholder="Title…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="filter-group">
            <h4>Vertical</h4>
            {verticals?.map((v) => (
              <span
                key={v.id}
                className={`chip${verticalId === v.id ? ' selected' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => setVerticalId(verticalId === v.id ? null : v.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setVerticalId(verticalId === v.id ? null : v.id);
                  }
                }}
              >
                {v.name}
              </span>
            ))}
          </div>
          <div className="filter-group">
            <h4>Status</h4>
            {['OPEN', 'FILLED', 'CLOSED'].map((s) => (
              <span
                key={s}
                className={`chip${status === s ? ' selected' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => setStatus(status === s ? null : s)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setStatus(status === s ? null : s);
                  }
                }}
              >
                {s}
              </span>
            ))}
          </div>
          {hasFilters && (
            <button
              className="btn btn-sm"
              onClick={() => {
                setQ('');
                setVerticalId(null);
                setStatus(null);
              }}
            >
              Clear filters
            </button>
          )}
        </aside>

        <section>
          {isLoading && <p className="muted">Loading offers…</p>}
          {offers?.length === 0 && (
            <div className="empty-state">No offers match the current filters.</div>
          )}
          <div className="rep-grid">
            {offers?.map((offer) => (
              <OfferCard key={offer.id} offer={offer} onChanged={invalidate} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function statusPillClass(effective: string): string {
  switch (effective) {
    case 'OPEN':
      return 'pill pill-open';
    case 'FILLED':
      return 'pill pill-filled';
    default:
      return 'pill pill-closed';
  }
}

function OfferCard({ offer, onChanged }: { offer: Offer; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closeMutation = useMutation({
    mutationFn: () => closeOffer(offer.id),
    onSuccess: onChanged,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Close failed'),
  });

  // Removing a rep from the offer ends their active placement. The card needs
  // the placement id, resolved from the offer's placements.
  const removeMutation = useMutation({
    mutationFn: async (repId: number) => {
      const placements = await listPlacements({ offerId: offer.id });
      const active = placements.find((p) => p.repId === repId && p.status === 'ACTIVE');
      if (!active) {
        throw new ApiError(404, 'NOT_FOUND', 'Placement not found');
      }
      return endPlacement(active.id, 'Removed from offer');
    },
    onSuccess: onChanged,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Remove failed'),
  });

  const pct = offer.seats > 0 ? Math.min(100, (offer.filledSeats / offer.seats) * 100) : 0;
  const full = offer.filledSeats >= offer.seats;

  return (
    <article className="card rep-card offer-card">
      <div className="offer-head">
        <div>
          <h3 style={{ margin: 0 }}>{offer.title}</h3>
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            {offer.clientName}
            {offer.verticalName ? ` · ${offer.verticalName}` : ''}
          </div>
        </div>
        <span className={statusPillClass(offer.effectiveStatus)}>{offer.effectiveStatus}</span>
      </div>

      <div>
        <div className="progress-track">
          <div
            className={`progress-fill${full ? ' full' : ''}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="seat-label">
          {offer.filledSeats}/{offer.seats} seats filled
        </div>
      </div>

      {offer.reps.length > 0 && (
        <div className="rep-chips">
          {offer.reps.map((rep) => (
            <span key={rep.repId} className="rep-chip">
              {rep.repName}
              <button
                aria-label={`Remove ${rep.repName}`}
                title="Remove from offer"
                onClick={() => removeMutation.mutate(rep.repId)}
                disabled={removeMutation.isPending}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {offer.notes && <div className="rep-notes">{offer.notes}</div>}
      {error && <p className="error-text">{error}</p>}

      <div className="rep-actions">
        <button className="btn btn-sm" onClick={() => setEditing(true)}>
          Edit
        </button>
        {offer.status === 'OPEN' && (
          <button
            className="btn btn-sm btn-primary"
            onClick={() => setPlacing(true)}
            disabled={full}
            title={full ? 'No free seats' : undefined}
          >
            + Place rep
          </button>
        )}
        {confirmClose ? (
          <button
            className="btn btn-sm btn-danger"
            onClick={() => closeMutation.mutate()}
            disabled={closeMutation.isPending}
          >
            Confirm close
          </button>
        ) : (
          offer.status === 'OPEN' && (
            <button className="btn btn-sm btn-danger" onClick={() => setConfirmClose(true)}>
              Close
            </button>
          )
        )}
      </div>

      {editing && (
        <OfferFormModal
          offer={offer}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
        />
      )}
      {placing && (
        <PlaceRepModal
          offer={offer}
          onClose={() => setPlacing(false)}
          onPlaced={() => {
            setPlacing(false);
            onChanged();
          }}
        />
      )}
    </article>
  );
}

// -------------------------------------------------------------- offer form

function OfferFormModal({
  offer,
  onClose,
  onSaved,
}: {
  offer?: Offer;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: clients } = useQuery({ queryKey: ['clients'], queryFn: listClients });
  const { data: verticals } = useQuery({ queryKey: ['verticals'], queryFn: listVerticals });

  const [clientId, setClientId] = useState<number | ''>(offer?.clientId ?? '');
  const [vertical, setVertical] = useState<number | ''>(offer?.verticalId ?? '');
  const [title, setTitle] = useState(offer?.title ?? '');
  const [seats, setSeats] = useState(String(offer?.seats ?? 1));
  const [notes, setNotes] = useState(offer?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      if (clientId === '') {
        throw new ApiError(400, 'BAD_REQUEST', 'Client is required');
      }
      const input = {
        clientId,
        verticalId: vertical === '' ? null : vertical,
        title: title.trim(),
        seats: Math.max(1, Number(seats) || 1),
        notes: notes.trim() || null,
      };
      return offer ? updateOffer(offer.id, input) : createOffer(input);
    },
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Save failed'),
  });

  return (
    <Modal title={offer ? 'Edit offer' : 'New offer'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="field">
          <label htmlFor="offer-title">Title</label>
          <input
            id="offer-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="offer-client">Client</label>
          <select
            id="offer-client"
            value={clientId}
            onChange={(e) => setClientId(e.target.value === '' ? '' : Number(e.target.value))}
            required
          >
            <option value="">— select —</option>
            {clients?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="offer-vertical">Vertical</label>
          <select
            id="offer-vertical"
            value={vertical}
            onChange={(e) => setVertical(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">— none —</option>
            {verticals?.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="offer-seats">Seats</label>
          <input
            id="offer-seats"
            type="number"
            min={1}
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="offer-notes">Notes</label>
          <textarea
            id="offer-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------ place rep picker

function PlaceRepModal({
  offer,
  onClose,
  onPlaced,
}: {
  offer: Offer;
  onClose: () => void;
  onPlaced: () => void;
}) {
  // Only reps without an active placement can be placed.
  const { data: repsPage } = useQuery({
    queryKey: ['reps', 'unplaced'],
    queryFn: () => listReps({ placed: false, size: 100 }),
  });

  const place = useMutation({
    mutationFn: (repId: number) => placeRep(offer.id, repId),
    onSuccess: onPlaced,
  });

  return (
    <Modal title={`Place a rep on "${offer.title}"`} onClose={onClose}>
      {place.error && (
        <p className="error-text">
          {place.error instanceof ApiError ? place.error.message : 'Place failed'}
        </p>
      )}
      {repsPage?.items.length === 0 && <p className="muted">Every rep is already placed.</p>}
      <div className="workspace-list">
        {repsPage?.items.map((rep) => (
          <div
            key={rep.id}
            className="workspace-row"
            role="button"
            tabIndex={0}
            onClick={() => place.mutate(rep.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                place.mutate(rep.id);
              }
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>{rep.name}</div>
              <div className="slug">
                {rep.verticalName ?? 'No vertical'} · {rep.statusName ?? 'No status'}
              </div>
            </div>
            <span className="pill pill-bench-now">Unplaced</span>
          </div>
        ))}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function NewOfferButton({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        + New offer
      </button>
      {open && (
        <OfferFormModal
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            onCreated();
          }}
        />
      )}
    </>
  );
}
