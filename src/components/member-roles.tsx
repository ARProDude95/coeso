"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  userId: string;
  roles: string[];
  /** Every role already in use on this board — offered as suggestions. */
  suggestions: string[];
}

interface ApiFailure {
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

export function MemberRoles({ userId, roles: initial, suggestions }: Props) {
  const router = useRouter();
  const [roles, setRoles] = useState(initial);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(role: string, action: "add" | "remove") {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/members/${userId}/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, action }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiFailure;
        setError(body.error ?? "Could not update that role");
        return;
      }

      setRoles((current) =>
        action === "add"
          ? current.includes(role)
            ? current
            : [...current, role].sort()
          : current.filter((existing) => existing !== role),
      );
      setValue("");
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const role = value.trim().toLowerCase();
    if (!role) return;
    void save(role, "add");
  }

  const datalistId = `role-suggestions-${userId}`;

  return (
    <div className="mt-4 border-t border-zinc-800 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-zinc-500">
          Roles
        </span>
        {roles.length === 0 && (
          <span className="text-xs text-zinc-500">
            none — this member sees every ungated offer
          </span>
        )}
        {roles.map((role) => (
          <span key={role} className="badge badge-accent">
            {role}
            <button
              type="button"
              aria-label={`Remove ${role}`}
              disabled={busy}
              onClick={() => void save(role, "remove")}
              className="ml-1 font-bold text-zinc-700 transition-colors hover:text-zinc-950 disabled:opacity-50"
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {!roles.includes("partner") && (
        <button
          type="button"
          className="mt-3 btn btn-secondary"
          disabled={busy}
          onClick={() => void save("partner", "add")}
        >
          Grant partner access
        </button>
      )}

      <form onSubmit={submit} className="mt-3 flex flex-wrap items-center gap-2">
        <input
          className="input max-w-56"
          list={suggestions.length > 0 ? datalistId : undefined}
          maxLength={32}
          placeholder="closer-vip"
          aria-label="Role to add"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        {suggestions.length > 0 && (
          <datalist id={datalistId}>
            {suggestions.map((role) => (
              <option key={role} value={role} />
            ))}
          </datalist>
        )}
        <button
          type="submit"
          disabled={busy || value.trim() === ""}
          className="btn btn-secondary"
        >
          {busy ? "Saving…" : "Add role"}
        </button>
        {error && <p className="field-error">{error}</p>}
      </form>
    </div>
  );
}
