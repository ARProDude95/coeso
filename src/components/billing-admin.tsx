"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface MemberOption {
  id: string;
  name: string;
  email: string;
}

interface Flag {
  id: string;
  name: string;
  email: string;
  kind: string;
  detail: string;
}

interface Props {
  members: MemberOption[];
  flags: Flag[];
}

const TIERS = ["free", "pro", "elite"] as const;

export function BillingAdmin({ members, flags }: Props) {
  const router = useRouter();
  const [userId, setUserId] = useState(members[0]?.id ?? "");
  const [tier, setTier] = useState<(typeof TIERS)[number]>("pro");
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function grant(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/billing/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, tier }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(body.error ?? "Could not grant that tier");
        return;
      }
      setNotice("Tier granted.");
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function grantFounding() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/billing/founding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, tier }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        slot?: number | null;
      };
      if (!response.ok) {
        setError(body.error ?? "Could not grant a founding slot");
        return;
      }
      setNotice(
        body.slot ? `Founding slot ${body.slot} granted.` : "Founding slot granted.",
      );
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resolve(flagId: string) {
    setResolving(flagId);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/billing/flags/${flagId}/resolve`,
        { method: "POST" },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(body.error ?? "Could not resolve that flag");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setResolving(null);
    }
  }

  return (
    <section className="panel flex flex-col gap-5 p-6">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Admin · manual tier override
        </h2>
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          Writes a granted subscription row, which is what access checks read.
          A later Whop webhook takes the subscription back over.
        </p>
      </div>

      <form onSubmit={grant} className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <label className="label" htmlFor="grant-member">Member</label>
          <select
            id="grant-member"
            className="select"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
          >
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name} — {member.email}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="grant-tier">Tier</label>
          <select
            id="grant-tier"
            className="select"
            value={tier}
            onChange={(event) =>
              setTier(event.target.value as (typeof TIERS)[number])
            }
          >
            {TIERS.map((value) => (
              <option key={value} value={value}>
                {value[0].toUpperCase() + value.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || !userId}
        >
          {busy ? "Granting…" : "Grant tier"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || !userId || tier === "free"}
          onClick={() => void grantFounding()}
        >
          Grant founding slot
        </button>
      </form>
      <p className="text-xs text-zinc-500">
        “Grant founding slot” consumes one of the 20 slots and gives the member
        the selected tier at founding status. It fails once the slots are used.
      </p>

      {notice && <p className="text-xs text-emerald-400">{notice}</p>}
      {error && <p className="field-error">{error}</p>}

      <div className="border-t border-zinc-800 pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Needs manual action ({flags.length})
        </h3>
        {flags.length === 0 ? (
          <p className="mt-2 text-xs text-zinc-500">
            Nothing to fix — no founding checkout overflowed the last slot.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {flags.map((flag) => (
              <li
                key={flag.id}
                className="rounded-lg border border-amber-900/60 bg-amber-950/20 px-4 py-3"
              >
                <p className="text-sm font-medium text-amber-100">
                  {flag.kind === "founding_overflow"
                    ? "Founding price charged without a slot"
                    : flag.kind}
                </p>
                <p className="mt-1 text-xs text-amber-200/80">
                  {flag.name} ({flag.email}) — {flag.detail || "no detail"}
                </p>
                <button
                  type="button"
                  className="btn btn-secondary mt-2"
                  disabled={resolving !== null}
                  onClick={() => void resolve(flag.id)}
                >
                  {resolving === flag.id ? "Resolving…" : "Mark resolved"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
