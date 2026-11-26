"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ApplicationStatus as Status } from "@/lib/store";

const OPTIONS: Array<{ value: Status; label: string }> = [
  { value: "new", label: "New" },
  { value: "reviewing", label: "Reviewing" },
  { value: "shortlisted", label: "Shortlisted" },
  { value: "hired", label: "Hired" },
];

export function ApplicationStatus({
  id,
  status,
}: {
  id: string;
  status: Status;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function update(next: string) {
    if (next === status) return;
    setBusy(true);
    setError("");

    const response = await fetch(`/api/applications/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });

    setBusy(false);

    if (!response.ok) {
      setError("Could not save");
      return;
    }

    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <select
        value={status}
        onChange={(event) => update(event.target.value)}
        disabled={busy}
        aria-label="Application status"
        className="rounded-md border border-line bg-coal px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-paper disabled:opacity-50"
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {status === "hired" ? (
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
