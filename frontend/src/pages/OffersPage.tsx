import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  Offer,
  OfferFilters,
  closeOffer,
  createOffer,
  endPlacement,
  fetchSuggested,
  listClients,
  listExperienceLevels,
  listLanguages,
  listOffers,
  listPlacements,
  listReps,
  listSkills,
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
        <div>
          <h1>Offers</h1>
          <p className="page-sub">Open roles from your clients, and who is filling them.</p>
        </div>
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
  const [showSuggested, setShowSuggested] = useState(false);
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
    <article className="card card-hover rep-card offer-card">
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

      {(offer.requiredSkills?.length || offer.requiredLevelName
        || offer.requiredLanguage || offer.startDate
        || (offer.tzWindowStart != null && offer.tzWindowEnd != null)) && (
        <div className="rep-tags req-chips" title="Requirements for matching">
          {offer.requiredSkills?.length ? (
            <span className="pill pill-gold">Needs: {offer.requiredSkills.join(', ')}</span>
          ) : null}
          {offer.requiredLevelName && (
            <span className="pill">{offer.requiredLevelName}+</span>
          )}
          {offer.requiredLanguage && (
            <span className="pill">Speaks {offer.requiredLanguage}</span>
          )}
          {offer.tzWindowStart != null && offer.tzWindowEnd != null && (
            <span className="pill" title="Working window in UTC">
              UTC {minutesToTime(offer.tzWindowStart)}–{minutesToTime(offer.tzWindowEnd)}
            </span>
          )}
          {offer.startDate && (
            <span className="pill pill-open">Starts {offer.startDate}</span>
          )}
        </div>
      )}

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
        <button
          className="btn btn-sm"
          onClick={() => setShowSuggested((open) => !open)}
          aria-expanded={showSuggested}
        >
          {showSuggested ? 'Hide matches' : 'Suggested reps'}
        </button>
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

      {showSuggested && (
        <SuggestedPanel offer={offer} onChanged={() => {
          onChanged();
        }} />
      )}

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
  const { data: levels } = useQuery({ queryKey: ['levels'], queryFn: listExperienceLevels });
  const { data: skillTags } = useQuery({ queryKey: ['skills'], queryFn: listSkills });
  const { data: languageOptions } = useQuery({ queryKey: ['languages'], queryFn: listLanguages });

  const [clientId, setClientId] = useState<number | ''>(offer?.clientId ?? '');
  const [vertical, setVertical] = useState<number | ''>(offer?.verticalId ?? '');
  const [title, setTitle] = useState(offer?.title ?? '');
  const [seats, setSeats] = useState(String(offer?.seats ?? 1));
  const [notes, setNotes] = useState(offer?.notes ?? '');
  // Phase 6 requirements
  const [requiredLevel, setRequiredLevel] = useState<number | ''>(
    offer?.requiredLevelId ?? '');
  const [requiredLanguage, setRequiredLanguage] = useState(offer?.requiredLanguage ?? '');
  const [requiredSkills, setRequiredSkills] = useState(
    (offer?.requiredSkills ?? []).join(', '));
  const [tzStart, setTzStart] = useState(minutesToTime(offer?.tzWindowStart));
  const [tzEnd, setTzEnd] = useState(minutesToTime(offer?.tzWindowEnd));
  const [startDate, setStartDate] = useState(offer?.startDate ?? '');
  const [error, setError] = useState<string | null>(null);

  function splitList(value: string): string[] {
    return value.split(',').map((part) => part.trim()).filter(Boolean);
  }

  const save = useMutation({
    mutationFn: () => {
      if (clientId === '') {
        throw new ApiError(400, 'BAD_REQUEST', 'Client is required');
      }
      if ((tzStart === '') !== (tzEnd === '')) {
        throw new ApiError(400, 'BAD_REQUEST',
          'Set both timezone window times or neither');
      }
      const input = {
        clientId,
        verticalId: vertical === '' ? null : vertical,
        title: title.trim(),
        seats: Math.max(1, Number(seats) || 1),
        notes: notes.trim() || null,
        // Phase 6 requirements
        requiredLevelId: requiredLevel === '' ? null : requiredLevel,
        requiredLanguage: requiredLanguage.trim() || null,
        tzWindowStart: tzStart === '' ? null : timeToMinutes(tzStart),
        tzWindowEnd: tzEnd === '' ? null : timeToMinutes(tzEnd),
        startDate: startDate || null,
        requiredSkills: splitList(requiredSkills),
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
          <label htmlFor="offer-skills">Required skills</label>
          <input
            id="offer-skills"
            list="offer-skill-list"
            placeholder="Comma-separated: Java, Outbound…"
            value={requiredSkills}
            onChange={(e) => setRequiredSkills(e.target.value)}
          />
          <datalist id="offer-skill-list">
            {skillTags?.map((t) => (
              <option key={t.id} value={t.name} />
            ))}
          </datalist>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="offer-level">Required experience</label>
            <select
              id="offer-level"
              value={requiredLevel}
              onChange={(e) =>
                setRequiredLevel(e.target.value === '' ? '' : Number(e.target.value))}
            >
              <option value="">— any —</option>
              {levels?.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="offer-language">Required language</label>
            <input
              id="offer-language"
              list="offer-language-list"
              placeholder="e.g. English"
              value={requiredLanguage}
              onChange={(e) => setRequiredLanguage(e.target.value)}
            />
            <datalist id="offer-language-list">
              {languageOptions?.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="offer-tz-start">Window start (UTC)</label>
            <input
              id="offer-tz-start"
              type="time"
              value={tzStart}
              onChange={(e) => setTzStart(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="offer-tz-end">Window end (UTC)</label>
            <input
              id="offer-tz-end"
              type="time"
              value={tzEnd}
              onChange={(e) => setTzEnd(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="offer-start">Start date</label>
            <input
              id="offer-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
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
              <div className="ws-name">{rep.name}</div>
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

// ------------------------------------------------------- suggested reps (P6)

/** Minutes-from-UTC → "HH:MM" for the requirement time inputs. */
function minutesToTime(value: number | null | undefined): string {
  if (value == null) {
    return '';
  }
  const normalized = ((value % 1440) + 1440) % 1440;
  const hours = String(Math.floor(normalized / 60)).padStart(2, '0');
  const minutes = String(normalized % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** "HH:MM" → minutes-from-UTC, or null when unparseable. */
function timeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

/**
 * "Suggested reps" panel: this offer's requirement scorecard, ranked, with the
 * per-factor breakdown and a one-click place. Placing calls the normal
 * placements endpoint, so seat limits, lock and 1-rep-1-placement still hold.
 */
function SuggestedPanel({ offer, onChanged }: { offer: Offer; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['suggestions', offer.id],
    queryFn: () => fetchSuggested(offer.id),
  });

  const place = useMutation({
    mutationFn: (repId: number) => placeRep(offer.id, repId),
    onSuccess: () => {
      onChanged();
      queryClient.invalidateQueries({ queryKey: ['suggestions', offer.id] });
    },
  });

  if (isLoading) {
    return <div className="suggested-panel muted">Scoring candidates…</div>;
  }
  if (error) {
    return (
      <div className="suggested-panel">
        <p className="error-text">
          {error instanceof ApiError ? error.message : 'Could not load suggestions'}
        </p>
      </div>
    );
  }
  if (!data?.length) {
    return (
      <div className="suggested-panel muted">
        No available reps match right now — every rep is placed or the roster is
        empty.
      </div>
    );
  }
  const full = offer.filledSeats >= offer.seats;

  return (
    <div className="suggested-panel" aria-label="Suggested reps">
      {place.error && (
        <p className="error-text">
          {place.error instanceof ApiError ? place.error.message : 'Place failed'}
        </p>
      )}
      {data.map((suggestion) => (
        <div className="sugg-row" key={suggestion.repId}>
          <div className="sugg-head">
            <span
              className={`sugg-score${
                suggestion.score >= 75
                  ? ' high'
                  : suggestion.score >= 45
                    ? ' mid'
                    : ' low'
              }`}
              title="Match score 0–100"
            >
              {suggestion.score}
            </span>
            <div className="sugg-who">
              <strong>{suggestion.repName}</strong>
              <span className="muted">
                {[suggestion.verticalName, suggestion.experienceLevelName,
                  suggestion.statusName].filter(Boolean).join(' · ') || '—'}
              </span>
            </div>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => place.mutate(suggestion.repId)}
              disabled={place.isPending || full || offer.status !== 'OPEN'}
              title={full ? 'No free seats' : `Place ${suggestion.repName}`}
            >
              Place
            </button>
          </div>
          <ul className="factor-list">
            {suggestion.factors.map((factor) => {
              const pct = factor.weight > 0
                ? Math.round((factor.points / factor.weight) * 100)
                : 0;
              return (
                <li
                  className={`factor-row${factor.applicable ? '' : ' inactive'}`}
                  key={factor.key}
                >
                  <span className="factor-label">{factor.label}</span>
                  <span className="factor-bar" aria-hidden="true">
                    <span
                      className={`factor-fill${pct === 0 ? ' zero' : ''}`}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className="factor-points">
                    {factor.applicable ? `${factor.points}/${factor.weight}` : '—'}
                  </span>
                  <span className="factor-detail" title={factor.detail}>
                    {factor.detail}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
