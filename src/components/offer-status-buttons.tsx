"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OfferStatus } from "@/lib/types";

interface Props {
  offerId: string;
  status: OfferStatus;
}

const ACTIONS: Array<{
  to: OfferStatus;
  label: string;
  className: string;
  when: OfferStatus[];
}> = [
  {
    to: "open",
    label: "Reopen",
    className: "btn btn-success",
    when: ["paused", "closed"],
  },
  {
    to: "paused",
    label: "Pause",
    className: "btn btn-secondary",
    when: ["open"],
  },
  {
    to: "closed",
    label: "Close",
    className: "btn btn-danger",
    when: ["open", "paused"],
  },
];

export function OfferStatusButtons({ offerId, status }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<OfferStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(next: OfferStatus) {
    setBusy(next);
    setError(null);
    try {
      const response = await fetch(`/api/offers/${offerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(body.error ?? "Could not update the status");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap justify-end gap-2">
        {ACTIONS.filter((action) => action.when.includes(status)).map(
          (action) => (
            <button
              key={action.to}
              type="button"
              className={action.className}
              disabled={busy !== null}
              onClick={() => setStatus(action.to)}
            >
              {busy === action.to ? "…" : action.label}
            </button>
          ),
        )}
      </div>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
