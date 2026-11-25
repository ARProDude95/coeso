"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Confirm a rep's logged numbers on an offer this partner owns. */
export function DealConfirm({ dealId }: { dealId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/deals/${dealId}/confirm`, {
        method: "POST",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(body.error ?? "Could not confirm that deal");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className="btn btn-secondary"
        disabled={busy}
        onClick={() => void confirm()}
      >
        {busy ? "Confirming…" : "Confirm"}
      </button>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
