"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useToast } from "@/components/toast";
import type { Offer } from "@/lib/store";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

/**
 * The admin offers table. Closing, reopening and deleting all apply to the row
 * immediately and only roll back if the request fails, so the page never
 * reloads under the owner's cursor.
 */
export function OffersTable({
  offers,
  counts = {},
}: {
  offers: Offer[];
  /** Applications per offer id, so the table shows which offers are working. */
  counts?: Record<string, number>;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<Offer[]>(offers);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  // Re-sync when the server sends fresh data (a create or an edit).
  useEffect(() => {
    setRows(offers);
  }, [offers]);

  // Hired applications close their offer from the applications table below.
  useEffect(() => {
    function onOfferClosed(event: Event) {
      const detail = (event as CustomEvent<{ offerId?: string }>).detail;
      if (!detail?.offerId) return;
      setRows((current) =>
        current.map((offer) =>
          offer.id === detail.offerId ? { ...offer, status: "closed" } : offer,
        ),
      );
    }

    window.addEventListener("coeso:offer-closed", onOfferClosed);
    return () => window.removeEventListener("coeso:offer-closed", onOfferClosed);
  }, []);

  async function toggleStatus(offer: Offer) {
    const next = offer.status === "open" ? "closed" : "open";

    setRows((current) =>
      current.map((row) => (row.id === offer.id ? { ...row, status: next } : row)),
    );
    setBusy((current) => ({ ...current, [offer.id]: true }));

    const response = await fetch(`/api/offers/${offer.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });

    setBusy((current) => ({ ...current, [offer.id]: false }));

    if (!response.ok) {
      setRows((current) =>
        current.map((row) =>
          row.id === offer.id ? { ...row, status: offer.status } : row,
        ),
      );
      toast("Could not change that offer. Try again.", "error");
      return;
    }

    toast(
      next === "closed"
        ? `“${offer.title}” closed — it is off the board.`
        : `“${offer.title}” is back open.`,
    );
  }

  async function remove(offer: Offer) {
    if (
      !window.confirm(`Delete "${offer.title}"? This cannot be undone.`)
    ) {
      return;
    }

    const previous = rows;
    setRows((current) => current.filter((row) => row.id !== offer.id));

    const response = await fetch(`/api/offers/${offer.id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      setRows(previous);
      toast("Could not delete that offer. Try again.", "error");
      return;
    }

    toast(`“${offer.title}” deleted.`);
  }

  if (rows.length === 0) {
    return (
      <p className="mt-4 text-sm text-mute">
        No offers yet. Post one above and it appears here.
      </p>
    );
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[820px] text-left text-sm">
        <thead className="bg-coal font-mono text-[10px] uppercase tracking-[0.2em] text-mute">
          <tr>
            <th className="px-4 py-3">Offer</th>
            <th className="px-4 py-3">Company</th>
            <th className="px-4 py-3">Role</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Applications</th>
            <th className="px-4 py-3">Posted</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((offer) => {
            const working = Boolean(busy[offer.id]);

            return (
              <tr key={offer.id}>
                <td className="px-4 py-3">
                  <Link
                    href={`/offers/${offer.id}`}
                    className="hover:text-ember"
                  >
                    {offer.title}
                  </Link>
                  {offer.featured ? (
                    <span className="ml-2 font-mono text-[9px] uppercase tracking-[0.18em] text-ember">
                      featured
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-mute">{offer.company}</td>
                <td className="px-4 py-3 text-mute">{offer.role_type}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      offer.status === "open" ? "text-ember" : "text-mute"
                    }
                  >
                    {offer.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {(counts[offer.id] ?? 0) === 0 ? (
                    <span className="text-mute">—</span>
                  ) : (
                    <span className="text-paper">{counts[offer.id]}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-mute">
                  {formatDate(offer.created_at)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-end gap-4">
                    <Link
                      href={`/admin/offers/${offer.id}`}
                      className="font-mono text-[10px] uppercase tracking-[0.2em] text-mute underline decoration-line underline-offset-4 hover:text-paper"
                    >
                      Edit
                    </Link>
                    <button
                      type="button"
                      onClick={() => toggleStatus(offer)}
                      disabled={working}
                      className="font-mono text-[10px] uppercase tracking-[0.2em] text-mute underline decoration-line underline-offset-4 hover:text-paper disabled:opacity-50"
                    >
                      {offer.status === "open" ? "Close" : "Reopen"}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(offer)}
                      className="font-mono text-[10px] uppercase tracking-[0.2em] text-mute underline decoration-line underline-offset-4 hover:text-ember"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
