import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  Offer,
  StageBoard,
  createStage,
  deleteStage,
  fetchBoard,
  getActiveWorkspaceId,
  listWorkspaces,
  moveOfferStage,
  moveStageColumn,
  renameStage,
} from '../api';

/**
 * Pipeline board (Phase 8): the offers of every configured stage, side by side.
 *
 * Accessibility contract: each column is a labelled <section> containing a
 * real list, and every card carries its own labelled move <select> — so the
 * whole board (including moving cards between columns) is operable with the
 * keyboard alone. Drag-and-drop is an optional pointer affordance layered on
 * top of the same move action, and every completed or failed move is
 * announced through a polite live region. Stage configuration (admin+) lives
 * in a toolbar panel with explicit up/down/rename/delete buttons — no
 * drag gestures required there either.
 */
export default function BoardPage() {
  const queryClient = useQueryClient();

  const [announcement, setAnnouncement] = useState('');
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [managing, setManaging] = useState(false);
  const [newStageName, setNewStageName] = useState('');
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renamingName, setRenamingName] = useState('');
  const [manageError, setManageError] = useState<string | null>(null);

  const { data: board, isLoading, error } = useQuery({
    queryKey: ['pipeline-board'],
    queryFn: fetchBoard,
  });
  const { data: workspaces } = useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
  });
  const role = workspaces?.find((w) => w.id === getActiveWorkspaceId())?.role;
  const canManage = role === 'OWNER' || role === 'ADMIN';

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['pipeline-board'] });
    queryClient.invalidateQueries({ queryKey: ['offers'] });
  }

  function errorText(err: unknown): string {
    return err instanceof ApiError ? err.message : 'Something went wrong';
  }

  // ------------------------------------------------------------- move an offer

  const moveMutation = useMutation({
    mutationFn: ({ offerId, stageId }: { offerId: number; stageId: number }) =>
      moveOfferStage(offerId, stageId),
    onSuccess: (offer) => {
      setAnnouncement(
        `Moved ${offer.title} to ${offer.stageName ?? 'the selected stage'}.`,
      );
      invalidate();
    },
    onError: (err) => setAnnouncement(errorText(err)),
  });

  // -------------------------------------------------- configure the columns

  const addMutation = useMutation({
    mutationFn: (name: string) => createStage(name),
    onSuccess: (stage) => {
      setManageError(null);
      setNewStageName('');
      setAnnouncement(`Added the stage ${stage.name}.`);
      invalidate();
    },
    onError: (err) => setManageError(errorText(err)),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => renameStage(id, name),
    onSuccess: (stage) => {
      setManageError(null);
      setRenamingId(null);
      setAnnouncement(`Renamed the stage to ${stage.name}.`);
      invalidate();
    },
    onError: (err) => setManageError(errorText(err)),
  });

  const reorderMutation = useMutation({
    mutationFn: ({ id, direction }: { id: number; direction: 'UP' | 'DOWN' }) =>
      moveStageColumn(id, direction),
    onSuccess: () => {
      setManageError(null);
      invalidate();
    },
    onError: (err) => setManageError(errorText(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteStage(id),
    onSuccess: () => {
      setManageError(null);
      setAnnouncement('Stage deleted.');
      invalidate();
    },
    onError: (err) => setManageError(errorText(err)),
  });

  // ------------------------------------------------------------------ render

  const header = (
    <div className="page-header">
      <div>
        <h1>Pipeline board</h1>
        <p className="page-sub">
          Every offer in its stage — drag a card or use its move menu.
        </p>
      </div>
      {canManage && (
        <button
          type="button"
          className="btn btn-sm"
          aria-expanded={managing}
          aria-controls="stage-manager"
          onClick={() => setManaging((open) => !open)}
        >
          {managing ? 'Done' : 'Manage stages'}
        </button>
      )}
    </div>
  );

  // Announcements for moves and stage management (polite live region).
  const liveRegion = (
    <p className="sr-only" role="status" aria-live="polite">
      {announcement}
    </p>
  );

  if (error) {
    const message =
      error instanceof ApiError && error.status === 403
        ? 'Manager access is required to view the pipeline board.'
        : errorText(error);
    return (
      <div className="page">
        {header}
        {liveRegion}
        <div className="empty-state">
          <div className="empty-title">Board unavailable</div>
          <p>{message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {header}
      {liveRegion}

      {managing && canManage && board && (
        <div id="stage-manager" className="stage-manager">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = newStageName.trim();
              if (name) addMutation.mutate(name);
            }}
          >
            <label className="sr-only" htmlFor="new-stage-name">
              New stage name
            </label>
            <input
              id="new-stage-name"
              placeholder="New stage name…"
              value={newStageName}
              onChange={(e) => setNewStageName(e.target.value)}
            />
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={addMutation.isPending || newStageName.trim() === ''}
            >
              Add stage
            </button>
          </form>

          <ul className="stage-manager-list">
            {board.map((column, index) =>
              renamingId === column.stage.id ? (
                <li key={column.stage.id}>
                  <label className="sr-only" htmlFor={`rename-${column.stage.id}`}>
                    Rename {column.stage.name}
                  </label>
                  <input
                    id={`rename-${column.stage.id}`}
                    value={renamingName}
                    onChange={(e) => setRenamingName(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={renameMutation.isPending || renamingName.trim() === ''}
                    onClick={() =>
                      renameMutation.mutate({
                        id: column.stage.id,
                        name: renamingName.trim(),
                      })
                    }
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setRenamingId(null)}
                  >
                    Cancel
                  </button>
                </li>
              ) : (
                <li key={column.stage.id}>
                  <span className="stage-name">{column.stage.name}</span>
                  <span className="muted stage-manager-count">
                    {column.offers.length}{' '}
                    {column.offers.length === 1 ? 'offer' : 'offers'}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    aria-label={`Move ${column.stage.name} up`}
                    title="Move column up"
                    disabled={
                      index === 0 || reorderMutation.isPending || renameMutation.isPending
                    }
                    onClick={() =>
                      reorderMutation.mutate({
                        id: column.stage.id,
                        direction: 'UP',
                      })
                    }
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    aria-label={`Move ${column.stage.name} down`}
                    title="Move column down"
                    disabled={
                      index === board.length - 1 ||
                      reorderMutation.isPending ||
                      renameMutation.isPending
                    }
                    onClick={() =>
                      reorderMutation.mutate({
                        id: column.stage.id,
                        direction: 'DOWN',
                      })
                    }
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    aria-label={`Rename ${column.stage.name}`}
                    onClick={() => {
                      setRenamingId(column.stage.id);
                      setRenamingName(column.stage.name);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    aria-label={`Delete ${column.stage.name}`}
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(column.stage.id)}
                  >
                    Delete
                  </button>
                </li>
              ),
            )}
          </ul>

          {manageError && <p className="error-text">{manageError}</p>}
        </div>
      )}

      {isLoading && <p className="muted">Loading board…</p>}

      {board && (
        <div className="board-grid">
          {board.map((column) => (
            <section
              key={column.stage.id}
              className={`board-col${dragOver === column.stage.id ? ' drag-over' : ''}`}
              aria-labelledby={`stage-${column.stage.id}-heading`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(column.stage.id);
              }}
              onDragLeave={() =>
                setDragOver((current) =>
                  current === column.stage.id ? null : current,
                )
              }
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const offerId = Number(e.dataTransfer.getData('text/plain'));
                if (offerId) {
                  moveMutation.mutate({
                    offerId,
                    stageId: column.stage.id,
                  });
                }
              }}
            >
              <header className="board-col-head">
                <h2 id={`stage-${column.stage.id}-heading`}>{column.stage.name}</h2>
                <span className="board-count">
                  {column.offers.length}{' '}
                  {column.offers.length === 1 ? 'offer' : 'offers'}
                </span>
              </header>
              {column.offers.length === 0 ? (
                <p className="board-empty">No offers in this stage.</p>
              ) : (
                <ul className="board-list">
                  {column.offers.map((offer) => (
                    <BoardCard
                      key={offer.id}
                      offer={offer}
                      columns={board}
                      moving={
                        moveMutation.isPending &&
                        moveMutation.variables?.offerId === offer.id
                      }
                      onMove={(stageId) =>
                        moveMutation.mutate({ offerId: offer.id, stageId })
                      }
                    />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function pillClass(effective: string): string {
  switch (effective) {
    case 'OPEN':
      return 'pill pill-open';
    case 'FILLED':
      return 'pill pill-filled';
    default:
      return 'pill pill-closed';
  }
}

/** One draggable card. The move <select> is the accessible path; the drag
 *  handlers are purely supplementary. */
function BoardCard({
  offer,
  columns,
  moving,
  onMove,
}: {
  offer: Offer;
  columns: StageBoard[];
  moving: boolean;
  onMove: (stageId: number) => void;
}) {
  const selectId = useId();
  const pct =
    offer.seats > 0 ? Math.min(100, (offer.filledSeats / offer.seats) * 100) : 0;
  const full = offer.filledSeats >= offer.seats;

  return (
    <li
      className="board-card"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', String(offer.id));
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      <div className="board-card-top">
        <h3>{offer.title}</h3>
        <span className={pillClass(offer.effectiveStatus)}>{offer.effectiveStatus}</span>
      </div>
      {offer.clientName && <div className="muted board-client">{offer.clientName}</div>}
      <div className="progress-track">
        <div
          className={`progress-fill${full ? ' full' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="seat-label">
        {offer.filledSeats}/{offer.seats} seats filled
      </div>
      <div className="board-move">
        <label className="sr-only" htmlFor={selectId}>
          Move {offer.title} to stage
        </label>
        <select
          id={selectId}
          value={String(offer.stageId ?? columns[0]?.stage.id ?? '')}
          disabled={moving}
          onChange={(e) => {
            const stageId = Number(e.target.value);
            if (stageId && stageId !== offer.stageId) {
              onMove(stageId);
            }
          }}
        >
          {columns.map((column) => (
            <option key={column.stage.id} value={column.stage.id}>
              {column.stage.name}
            </option>
          ))}
        </select>
      </div>
    </li>
  );
}
