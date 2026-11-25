"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TIERS, TIER_LABELS } from "@/lib/tiers";
import type { Tier } from "@/lib/types";

interface Props {
  userId: string;
  tier: Tier;
}

interface ApiFailure {
  error?: string;
}

/** Admin-only tier picker (PROGRESS #3 — tiers are hand-assigned). */
export function MemberTier({ userId, tier: initial }: Props) {
  const router = useRouter();
  const [tier, setTier] = useState<Tier>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(value: Tier) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/members/${userId}/tier`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: value }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiFailure;
        setError(body.error ?? "Could not change that tier");
        return;
      }
      setTier(value);
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-zinc-800 pt-3">
      <span className="text-xs uppercase tracking-wide text-zinc-500">Tier</span>
      <select
        className="select max-w-40"
        aria-label="Membership tier"
        disabled={busy}
        value={tier}
        onChange={(event) => void change(event.target.value as Tier)}
      >
        {TIERS.map((value) => (
          <option key={value} value={value}>
            {TIER_LABELS[value]}
          </option>
        ))}
      </select>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
