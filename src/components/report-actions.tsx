"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  reportId: string;
  offerId: string;
  offerStatus: string;
}

interface ApiFailure {
  error?: string;
}

/** Dismiss the report, or close the offer it targets (both admin-only). */
export function ReportActions({ reportId, offerId, offerStatus }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(kind: "dismiss" | "close") {
    setBusy(kind);
    setError(null);
    try {
      const response =
        kind === "dismiss"
          ? await fetch(`/api/admin/reports/${reportId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "dismiss" }),
            })
          : await fetch(`/api/offers/${offerId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "closed" }),
            });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiFailure;
        setError(body.error ?? "That didn't work");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn btn-secondary"
        disabled={busy !== null}
        onClick={() => void act("dismiss")}
      >
        {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
      </button>
      {offerStatus !== "closed" && (
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy !== null}
          onClick={() => void act("close")}
        >
          {busy === "close" ? "Closing…" : "Close offer"}
        </button>
      )}
      <Link href={`/offers/${offerId}`} className="btn btn-secondary">
        View
      </Link>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
