"use client";

import { useEffect, useState } from "react";
import { SelectMenu } from "@/components/select-menu";
import { useToast } from "@/components/toast";
import type { ApplicationStatus as Status } from "@/lib/store";

const OPTIONS: Array<{ value: Status; label: string; past: string }> = [
  { value: "new", label: "New", past: "Received" },
  { value: "reviewing", label: "Reviewing", past: "In review" },
  { value: "shortlisted", label: "Shortlisted", past: "Shortlisted" },
  { value: "hired", label: "Hired", past: "Hired" },
];

export function ApplicationStatus({
  id,
  status,
  offerId,
}: {
  id: string;
  status: Status;
  offerId?: string;
}) {
  const toast = useToast();
  const [current, setCurrent] = useState<Status>(status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setCurrent(status);
  }, [status]);

  async function update(next: Status) {
    if (next === current || busy) return;

    const previous = current;
    setCurrent(next);
    setBusy(true);
    setError("");

    const response = await fetch(`/api/applications/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });

    setBusy(false);

    if (!response.ok) {
      setCurrent(previous);
      setError("Could not save");
      toast("Could not change that application. Try again.", "error");
      return;
    }

    const payload = (await response.json().catch(() => null)) as {
      offerClosed?: boolean;
    } | null;

    if (payload?.offerClosed && offerId) {
      // Let the offers table on the same page close itself, no reload needed.
      window.dispatchEvent(
        new CustomEvent("coeso:offer-closed", { detail: { offerId } }),
      );
      toast("Hired — the offer is closed and off the board.");
      return;
    }

    toast(`Moved to ${OPTIONS.find((o) => o.value === next)?.past ?? next}.`);
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <SelectMenu
        label="Application status"
        value={current}
        options={OPTIONS.map(({ value, label }) => ({ value, label }))}
        onChange={update}
        disabled={busy}
        bare
      />
      {current === "hired" ? (
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-ember">
          offer closed
        </span>
      ) : null}
      {error ? (
        <span className="text-[10px] text-ember" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
