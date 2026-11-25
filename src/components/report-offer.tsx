"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  offerId: string;
}

interface ApiFailure {
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

/** Inline report form behind a single "Report" button on the offer page. */
export function ReportOffer({ offerId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/offers/${offerId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = (await response.json().catch(() => ({}))) as ApiFailure & {
        paused?: boolean;
      };

      if (!response.ok) {
        setError(body.error ?? "Could not file that report.");
        return;
      }

      setDone(true);
      setOpen(false);
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="panel p-5">
        <p className="text-sm text-zinc-300">
          Thanks — your report was filed and the team will review it.
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-secondary w-full"
        onClick={() => setOpen(true)}
      >
        Report this offer
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="panel flex flex-col gap-3 p-5">
      <p className="text-sm font-semibold text-zinc-100">Report this offer</p>
      <p className="text-xs text-zinc-500">
        Three unique reports pause the offer automatically.
      </p>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-900/70 bg-red-950/50 px-3 py-2 text-sm text-red-200"
        >
          {error}
        </p>
      )}

      <div>
        <label className="label" htmlFor={`report-${offerId}`}>Reason</label>
        <textarea
          id={`report-${offerId}`}
          className="textarea"
          rows={3}
          minLength={5}
          maxLength={500}
          required
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Scam, wrong payout, misleading description…"
        />
      </div>

      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn btn-danger">
          {busy ? "Filing…" : "Submit report"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
