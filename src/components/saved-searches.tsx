"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TIER_LABELS, TIER_FILTERS } from "@/lib/tiers";
import { ROLE_TYPES, type TierFilter } from "@/lib/types";

/** Plain JSON copy of the server's SavedSearch (kept local to stay client-safe). */
interface SearchView {
  id: string;
  name: string;
  roleType: "setter" | "closer" | "both" | "all";
  tier: TierFilter;
  keywords: string;
  minCommission: number | null;
}

interface Props {
  initial: SearchView[];
  limit: number;
  isPaid: boolean;
}

interface ApiFailure {
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

const EMPTY_FORM = {
  name: "",
  roleType: "all" as "setter" | "closer" | "both" | "all",
  tier: "all" as TierFilter,
  keywords: "",
  minCommission: "",
};

function describe(search: SearchView): string {
  const parts: string[] = [];
  if (search.roleType !== "all") {
    parts.push(
      search.roleType === "both" ? "Setter + Closer" : ROLE_TYPES.includes(search.roleType as "setter" | "closer" | "both")
        ? search.roleType[0].toUpperCase() + search.roleType.slice(1)
        : search.roleType,
    );
  }
  if (search.tier !== "all") parts.push(`${TIER_LABELS[search.tier]} tier`);
  if (search.minCommission !== null) parts.push(`≥ ${search.minCommission} commission`);
  if (search.keywords) parts.push(`“${search.keywords}”`);
  return parts.length > 0 ? parts.join(" · ") : "Every open offer";
}

export function SavedSearches({ initial, limit, isPaid }: Props) {
  const router = useRouter();
  const [searches, setSearches] = useState(initial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function startCreate() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowCreate(true);
    setError(null);
    setFieldErrors({});
  }

  function startEdit(search: SearchView) {
    setForm({
      name: search.name,
      roleType: search.roleType,
      tier: search.tier,
      keywords: search.keywords,
      minCommission: search.minCommission === null ? "" : String(search.minCommission),
    });
    setEditingId(search.id);
    setShowCreate(false);
    setError(null);
    setFieldErrors({});
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    const payload = {
      name: form.name,
      roleType: form.roleType,
      tier: form.tier,
      keywords: form.keywords,
      minCommission: form.minCommission.trim() === "" ? null : Number(form.minCommission),
    };

    try {
      const editing = editingId !== null;
      const response = await fetch(
        editing ? `/api/saved-searches/${editingId}` : "/api/saved-searches",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = (await response.json().catch(() => ({}))) as ApiFailure & {
        search?: SearchView;
      };

      if (!response.ok) {
        setFieldErrors(body.fieldErrors ?? {});
        setError(body.error ?? "Something went wrong. Please try again.");
        return;
      }

      if (editing && body.search) {
        setSearches((current) =>
          current.map((item) => (item.id === editingId ? body.search! : item)),
        );
      } else if (body.search) {
        setSearches((current) => [...current, body.search!]);
      }
      setShowCreate(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/saved-searches/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiFailure;
        setError(body.error ?? "Could not delete that search");
        return;
      }
      setSearches((current) => current.filter((item) => item.id !== id));
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!isPaid && searches.length === 0) {
    return (
      <div className="panel p-6">
        <p className="text-sm font-semibold text-zinc-50">Pro feature</p>
        <p className="mt-1 text-sm text-zinc-400">
          Saved searches let you subscribe to a filter set and get alerted when
          a matching offer is published. Available on Pro and Elite.
        </p>
        <a href="/pricing" className="btn btn-primary mt-4 inline-flex">
          See pricing
        </a>
      </div>
    );
  }

  const formId = editingId ?? "new";

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-900/70 bg-red-950/50 px-3 py-2 text-sm text-red-200"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-400">
          {searches.length} of {limit} saved search{limit === 1 ? "" : "es"} used
        </p>
        {!showCreate && searches.length < limit && (
          <button type="button" className="btn btn-primary" onClick={startCreate}>
            New saved search
          </button>
        )}
      </div>

      {showCreate && (
        <form onSubmit={submit} className="panel flex flex-col gap-4 p-5">
          <p className="text-sm font-semibold text-zinc-50">New saved search</p>
          <SearchFields
            formId={formId}
            form={form}
            set={set}
            fieldErrors={fieldErrors}
          />
          <div className="flex gap-3">
            <button type="submit" disabled={busy} className="btn btn-primary">
              {busy ? "Saving…" : "Save search"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowCreate(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <ul className="flex flex-col gap-3">
        {searches.map((search) => (
          <li key={search.id} className="panel p-5">
            {editingId === search.id ? (
              <form onSubmit={submit} className="flex flex-col gap-4">
                <SearchFields
                  formId={search.id}
                  form={form}
                  set={set}
                  fieldErrors={fieldErrors}
                />
                <div className="flex gap-3">
                  <button type="submit" disabled={busy} className="btn btn-primary">
                    {busy ? "Saving…" : "Save changes"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-50">{search.name}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">{describe(search)}</p>
                </div>
                <div className="ml-auto flex gap-2">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => startEdit(search)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy}
                    onClick={() => void remove(search.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {searches.length === 0 && !showCreate && (
        <div className="panel px-6 py-10 text-center">
          <p className="text-sm text-zinc-400">
            No saved searches yet — create one to get notified when a matching
            offer is published.
          </p>
        </div>
      )}
    </div>
  );
}

function SearchFields({
  formId,
  form,
  set,
  fieldErrors,
}: {
  formId: string;
  form: typeof EMPTY_FORM;
  set: <K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) => void;
  fieldErrors: Record<string, string[]>;
}) {
  const error = (key: string) => fieldErrors[key]?.[0];

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`${formId}-name`}>Name</label>
          <input
            id={`${formId}-name`}
            className="input"
            maxLength={60}
            placeholder="Remote closing roles"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
          {error("name") && <p className="field-error">{error("name")}</p>}
        </div>

        <div>
          <label className="label" htmlFor={`${formId}-keywords`}>
            Keywords <span className="text-zinc-500">(optional)</span>
          </label>
          <input
            id={`${formId}-keywords`}
            className="input"
            maxLength={200}
            placeholder="saas remote"
            value={form.keywords}
            onChange={(e) => set("keywords", e.target.value)}
          />
          <p className="hint">Every word must appear in the offer.</p>
          {error("keywords") && <p className="field-error">{error("keywords")}</p>}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor={`${formId}-roleType`}>Role type</label>
          <select
            id={`${formId}-roleType`}
            className="select"
            value={form.roleType}
            onChange={(e) =>
              set("roleType", e.target.value as typeof EMPTY_FORM["roleType"])
            }
          >
            <option value="all">Any role</option>
            {ROLE_TYPES.map((value) => (
              <option key={value} value={value}>
                {value === "both" ? "Setter + Closer" : value[0].toUpperCase() + value.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor={`${formId}-tier`}>Tier</label>
          <select
            id={`${formId}-tier`}
            className="select"
            value={form.tier}
            onChange={(e) => set("tier", e.target.value as TierFilter)}
          >
            {TIER_FILTERS.map((value) => (
              <option key={value} value={value}>
                {value === "all" ? "Any tier" : TIER_LABELS[value as "free" | "pro" | "elite"]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor={`${formId}-minCommission`}>
            Min. commission <span className="text-zinc-500">(optional)</span>
          </label>
          <input
            id={`${formId}-minCommission`}
            type="number"
            min={0}
            className="input"
            placeholder="500"
            value={form.minCommission}
            onChange={(e) => set("minCommission", e.target.value)}
          />
          <p className="hint">Offers without an amount won’t match.</p>
          {error("minCommission") && (
            <p className="field-error">{error("minCommission")}</p>
          )}
        </div>
      </div>
    </>
  );
}
