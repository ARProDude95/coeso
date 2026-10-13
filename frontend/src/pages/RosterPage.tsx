import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  Rep,
  RepFilters,
  createRep,
  deleteRep,
  endPlacement,
  fetchStats,
  listOffers,
  listPlacements,
  listReps,
  listStatuses,
  listVerticals,
  listExperienceLevels,
  placeRep,
  updateRep,
} from '../api';
import Modal from '../components/Modal';

/** Roster: stats header, filter sidebar with chips, rep cards, place/unplace. */
export default function RosterPage() {
  const queryClient = useQueryClient();

  // Filters. `placed` stays null (no filter) until picked.
  const [q, setQ] = useState('');
  const [verticalId, setVerticalId] = useState<number | null>(null);
  const [statusId, setStatusId] = useState<number | null>(null);
  const [experienceId, setExperienceId] = useState<number | null>(null);
  const [placed, setPlaced] = useState<boolean | null>(null);

  const filters: RepFilters = useMemo(() => ({
    q: q || undefined,
    verticalId: verticalId ?? undefined,
    statusId: statusId ?? undefined,
    experienceId: experienceId ?? undefined,
    placed: placed ?? undefined,
  }), [q, verticalId, statusId, experienceId, placed]);

  const hasFilters = q !== '' || verticalId != null || statusId != null
    || experienceId != null || placed != null;

  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: fetchStats });
  const { data: verticals } = useQuery({ queryKey: ['verticals'], queryFn: listVerticals });
  const { data: statuses } = useQuery({ queryKey: ['statuses'], queryFn: listStatuses });
  const { data: levels } = useQuery({ queryKey: ['levels'], queryFn: listExperienceLevels });
  const { data: repsPage, isLoading } = useQuery({
    queryKey: ['reps', filters],
    queryFn: () => listReps(filters),
  });

  function clearFilters() {
    setQ('');
    setVerticalId(null);
    setStatusId(null);
    setExperienceId(null);
    setPlaced(null);
  }

  function invalidateReps() {
    queryClient.invalidateQueries({ queryKey: ['reps'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
    queryClient.invalidateQueries({ queryKey: ['offers'] });
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Roster</h1>
        <NewRepButton onCreated={invalidateReps} />
      </div>

      {stats && (
        <div className="stats-row">
          <div className="stat">
            <div className="stat-value">{stats.totalReps}</div>
            <div className="stat-label">Total reps</div>
          </div>
          <div className="stat">
            <div className="stat-value">{stats.benchCount}</div>
            <div className="stat-label">On bench</div>
          </div>
          <div className="stat">
            <div className="stat-value">{stats.placedCount}</div>
            <div className="stat-label">Placed</div>
          </div>
          <div className="stat">
            <div className="stat-value">{stats.openOffers}</div>
            <div className="stat-label">Open offers</div>
          </div>
        </div>
      )}

      <div className="with-sidebar">
        <aside className="filter-sidebar">
          <div className="filter-group">
            <h4>Search</h4>
            <input
              placeholder="Name or email…"
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
            {statuses?.map((s) => (
              <span
                key={s.id}
                className={`chip${statusId === s.id ? ' selected' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => setStatusId(statusId === s.id ? null : s.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setStatusId(statusId === s.id ? null : s.id);
                  }
                }}
              >
                {s.name}
              </span>
            ))}
          </div>

          <div className="filter-group">
            <h4>Experience</h4>
            {levels?.map((l) => (
              <span
                key={l.id}
                className={`chip${experienceId === l.id ? ' selected' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => setExperienceId(experienceId === l.id ? null : l.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setExperienceId(experienceId === l.id ? null : l.id);
                  }
                }}
              >
                {l.name}
              </span>
            ))}
          </div>

          <div className="filter-group">
            <h4>Placement</h4>
            <span
              className={`chip${placed === true ? ' selected' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => setPlaced(placed === true ? null : true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setPlaced(placed === true ? null : true);
                }
              }}
            >
              Placed
            </span>
            <span
              className={`chip${placed === false ? ' selected' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => setPlaced(placed === false ? null : false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setPlaced(placed === false ? null : false);
                }
              }}
            >
              Unplaced
            </span>
          </div>

          {hasFilters && (
            <button className="btn btn-sm" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </aside>

        <section>
          {isLoading && <p className="muted">Loading reps…</p>}
          {repsPage && repsPage.items.length === 0 && (
            <div className="empty-state">No reps match the current filters.</div>
          )}
          <div className="rep-grid">
            {repsPage?.items.map((rep) => (
              <RepCard key={rep.id} rep={rep} onChanged={invalidateReps} />
            ))}
          </div>
          {repsPage && repsPage.total > repsPage.items.length && (
            <p className="muted" style={{ marginTop: '1rem' }}>
              Showing {repsPage.items.length} of {repsPage.total}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- rep card

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

function statusPillClass(kind: string | null): string {
  switch (kind) {
    case 'BENCH':
      return 'pill pill-bench';
    case 'TRAINING':
      return 'pill pill-training';
    case 'INACTIVE':
      return 'pill pill-inactive';
    default:
      return 'pill';
  }
}

function RepCard({ rep, onChanged }: { rep: Rep; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: () => deleteRep(rep.id),
    onSuccess: onChanged,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Delete failed'),
  });

  const unplaceMutation = useMutation({
    mutationFn: async () => {
      // The card only knows the rep; resolve the active placement first.
      const placements = await listPlacements({ repId: rep.id });
      const active = placements.find((p) => p.status === 'ACTIVE');
      if (!active) {
        throw new ApiError(404, 'NOT_FOUND', 'No active placement');
      }
      return endPlacement(active.id, 'Removed from roster view');
    },
    onSuccess: onChanged,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Unplace failed'),
  });

  return (
    <article className="card rep-card">
      <div className="rep-head">
        <div className="avatar" aria-hidden="true">
          {initials(rep.name)}
        </div>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0 }}>{rep.name}</h3>
          <div className="muted" style={{ fontSize: '0.82rem' }}>{rep.email}</div>
        </div>
      </div>

      <div className="rep-meta">
        {rep.verticalName && <span>{rep.verticalName}</span>}
        {rep.experienceLevelName && <span>· {rep.experienceLevelName}</span>}
        {rep.statusName && (
          <span className={statusPillClass(rep.statusKind)}>{rep.statusName}</span>
        )}
        {rep.placed ? (
          <span className="pill pill-placed">Placed</span>
        ) : (
          <span className="pill pill-bench-now">Bench</span>
        )}
      </div>

      {rep.placed && rep.offerTitle && (
        <div className="rep-placement">
          → {rep.offerTitle}{rep.clientName ? ` @ ${rep.clientName}` : ''}
        </div>
      )}

      {rep.notes && <div className="rep-notes">{rep.notes}</div>}

      {error && <p className="error-text">{error}</p>}

      <div className="rep-actions">
        <button className="btn btn-sm" onClick={() => setEditing(true)}>
          Edit
        </button>
        {rep.placed ? (
          <button
            className="btn btn-sm"
            onClick={() => unplaceMutation.mutate()}
            disabled={unplaceMutation.isPending}
          >
            Unplace
          </button>
        ) : (
          <button className="btn btn-sm btn-primary" onClick={() => setPlacing(true)}>
            Place on offer
          </button>
        )}
        {confirmDelete ? (
          <button
            className="btn btn-sm btn-danger"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
          >
            Confirm delete
          </button>
        ) : (
          <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        )}
      </div>

      {editing && (
        <RepFormModal
          rep={rep}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
        />
      )}
      {placing && (
        <PlaceOnOfferModal
          rep={rep}
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

// ----------------------------------------------------------------- rep form

function RepFormModal({
  rep,
  onClose,
  onSaved,
}: {
  rep?: Rep;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: verticals } = useQuery({ queryKey: ['verticals'], queryFn: listVerticals });
  const { data: statuses } = useQuery({ queryKey: ['statuses'], queryFn: listStatuses });
  const { data: levels } = useQuery({ queryKey: ['levels'], queryFn: listExperienceLevels });

  const [name, setName] = useState(rep?.name ?? '');
  const [email, setEmail] = useState(rep?.email ?? '');
  const [vertical, setVertical] = useState<number | ''>(rep?.verticalId ?? '');
  const [status, setStatus] = useState<number | ''>(rep?.statusId ?? '');
  const [level, setLevel] = useState<number | ''>(rep?.experienceLevelId ?? '');
  const [notes, setNotes] = useState(rep?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const input = {
        name: name.trim(),
        email: email.trim() || null,
        verticalId: vertical === '' ? null : vertical,
        statusId: status === '' ? null : status,
        experienceLevelId: level === '' ? null : level,
        notes: notes.trim() || null,
      };
      return rep ? updateRep(rep.id, input) : createRep(input);
    },
    onSuccess: onSaved,
    onError: (err) =>
      setError(err instanceof ApiError ? describeApiError(err) : 'Save failed'),
  });

  return (
    <Modal title={rep ? 'Edit rep' : 'Add rep'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="field">
          <label htmlFor="rep-name">Name</label>
          <input id="rep-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="rep-email">Email</label>
          <input
            id="rep-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="rep-vertical">Vertical</label>
          <select
            id="rep-vertical"
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
          <label htmlFor="rep-status">Status</label>
          <select
            id="rep-status"
            value={status}
            onChange={(e) => setStatus(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">— none —</option>
            {statuses?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rep-level">Experience</label>
          <select
            id="rep-level"
            value={level}
            onChange={(e) => setLevel(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">— none —</option>
            {levels?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rep-notes">Notes</label>
          <textarea
            id="rep-notes"
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

// ------------------------------------------------------- place on offer picker

function PlaceOnOfferModal({
  rep,
  onClose,
  onPlaced,
}: {
  rep: Rep;
  onClose: () => void;
  onPlaced: () => void;
}) {
  // Only offers that can actually take someone: stored OPEN and not filled.
  const { data: offers } = useQuery({
    queryKey: ['offers', 'open'],
    queryFn: () => listOffers({ effectiveStatus: 'OPEN' }),
  });

  const place = useMutation({
    mutationFn: (offerId: number) => placeRep(offerId, rep.id),
    onSuccess: onPlaced,
  });

  return (
    <Modal title={`Place ${rep.name} on an offer`} onClose={onClose}>
      {place.error && (
        <p className="error-text">
          {place.error instanceof ApiError ? place.error.message : 'Place failed'}
        </p>
      )}
      {offers?.length === 0 && <p className="muted">No open offers right now.</p>}
      <div className="workspace-list">
        {offers?.map((offer) => (
          <div
            key={offer.id}
            className="workspace-row"
            role="button"
            tabIndex={0}
            onClick={() => place.mutate(offer.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                place.mutate(offer.id);
              }
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>{offer.title}</div>
              <div className="slug">
                {offer.clientName} — {offer.filledSeats}/{offer.seats} seats filled
              </div>
            </div>
            <span className="pill pill-open">{offer.effectiveStatus}</span>
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

function NewRepButton({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        + Add rep
      </button>
      {open && (
        <RepFormModal
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

/** 402 plan-limit errors carry {resource, current, limit} in details. */
function describeApiError(err: ApiError): string {
  if (err.code === 'PLAN_LIMIT_EXCEEDED' && err.details) {
    const d = err.details as { resource?: string; current?: number; limit?: number };
    return `Plan limit reached: ${d.current}/${d.limit} ${d.resource}. Upgrade the plan to add more.`;
  }
  return err.message;
}
