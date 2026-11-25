"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatRelative } from "@/lib/format";
import { currentMonth, monthLabel } from "@/lib/leaderboard";
import type { DealWithOffer } from "@/lib/types";

interface OfferOption {
  id: string;
  title: string;
  company: string;
}

interface Props {
  deals: DealWithOffer[];
  offers: OfferOption[];
  hideEarnings: boolean;
  username: string;
}

interface ApiFailure {
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

const EMPTY_FORM = {
  offerId: "",
  month: "",
  dealsClosed: "1",
  earningsMin: "",
  earningsMax: "",
};

export function DealLog({
  deals,
  offers,
  hideEarnings: initialHide,
  username,
}: Props) {
  const router = useRouter();
  const [form, setForm] = useState(() => ({
    ...EMPTY_FORM,
    month: currentMonth(),
  }));
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [hide, setHide] = useState(initialHide);
  const [savingHide, setSavingHide] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [notice, setNotice] = useState<string | null>(null);

  // One log per offer per month, so the pair identifies the row being edited.
  const editing = deals.find(
    (deal) => deal.offerId === form.offerId && deal.month === form.month,
  );

  function select(offerId: string, month: string) {
    const existing = deals.find(
      (deal) => deal.offerId === offerId && deal.month === month,
    );
    if (existing) {
      edit(existing);
      return;
    }
    setForm({ ...EMPTY_FORM, offerId, month });
    setError(null);
    setFieldErrors({});
    setNotice(null);
  }

  function set(key: keyof typeof EMPTY_FORM, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function edit(deal: DealWithOffer) {
    setForm({
      offerId: deal.offerId,
      month: deal.month,
      dealsClosed: String(deal.dealsClosed),
      earningsMin: deal.earningsMin === null ? "" : String(deal.earningsMin),
      earningsMax: deal.earningsMax === null ? "" : String(deal.earningsMax),
    });
    setError(null);
    setFieldErrors({});
    setNotice(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    setNotice(null);

    const numberOrNull = (value: string) =>
      value.trim() === "" ? null : Number(value);

    try {
      const response = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerId: form.offerId,
          month: form.month,
          dealsClosed: Number(form.dealsClosed),
          earningsMin: numberOrNull(form.earningsMin),
          earningsMax: numberOrNull(form.earningsMax),
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiFailure;
        setFieldErrors(body.fieldErrors ?? {});
        setError(body.error ?? "Could not save that log");
        return;
      }

      setForm({ ...EMPTY_FORM, month: currentMonth() });
      setNotice("Saved.");
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setDeleting(id);
    setError(null);
    try {
      const response = await fetch(`/api/deals/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiFailure;
        setError(body.error ?? "Could not delete that log");
        return;
      }
      const removed = deals.find((deal) => deal.id === id);
      if (
        removed &&
        form.offerId === removed.offerId &&
        form.month === removed.month
      ) {
        setForm({ ...EMPTY_FORM, month: currentMonth() });
      }
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setDeleting(null);
    }
  }

  async function toggleHide(next: boolean) {
    setSavingHide(true);
    setError(null);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hideEarnings: next }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiFailure;
        setError(body.error ?? "Could not update your profile");
        return;
      }
      setHide(next);
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSavingHide(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="flex flex-col gap-4">
        <form onSubmit={submit} className="panel flex flex-col gap-4 p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
              {editing ? "Edit log" : "Log a deal"}
            </h2>
            {editing && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() =>
                  setForm({ ...EMPTY_FORM, month: currentMonth() })
                }
              >
                New log
              </button>
            )}
          </div>

          {offers.length === 0 ? (
            <p className="text-sm text-zinc-400">
              You can log results once an offer accepts your application.
            </p>
          ) : (
            <>
              <div>
                <label className="label" htmlFor="deal-offer">Offer</label>
                <select
                  id="deal-offer"
                  className="select"
                  value={form.offerId}
                  onChange={(event) =>
                    select(event.target.value, form.month)
                  }
                  required
                >
                  <option value="">Pick an offer…</option>
                  {offers.map((offer) => (
                    <option key={offer.id} value={offer.id}>
                      {offer.title} — {offer.company}
                    </option>
                  ))}
                </select>
                {fieldErrors.offerId && (
                  <p className="field-error">{fieldErrors.offerId[0]}</p>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-4">
                <div>
                  <label className="label" htmlFor="deal-month">Month</label>
                  <input
                    id="deal-month"
                    type="month"
                    className="input"
                    value={form.month}
                    onChange={(event) =>
                      select(form.offerId, event.target.value)
                    }
                    required
                  />
                  {fieldErrors.month && (
                    <p className="field-error">{fieldErrors.month[0]}</p>
                  )}
                </div>
                <div>
                  <label className="label" htmlFor="deals-closed">
                    Deals closed
                  </label>
                  <input
                    id="deals-closed"
                    type="number"
                    min={1}
                    className="input"
                    value={form.dealsClosed}
                    onChange={(event) => set("dealsClosed", event.target.value)}
                  />
                  {fieldErrors.dealsClosed && (
                    <p className="field-error">{fieldErrors.dealsClosed[0]}</p>
                  )}
                </div>
                <div>
                  <label className="label" htmlFor="earnings-min">
                    Earnings from <span className="text-zinc-500">(USD)</span>
                  </label>
                  <input
                    id="earnings-min"
                    type="number"
                    min={0}
                    className="input"
                    value={form.earningsMin}
                    placeholder="3000"
                    onChange={(event) => set("earningsMin", event.target.value)}
                  />
                  {fieldErrors.earningsMin && (
                    <p className="field-error">{fieldErrors.earningsMin[0]}</p>
                  )}
                </div>
                <div>
                  <label className="label" htmlFor="earnings-max">to</label>
                  <input
                    id="earnings-max"
                    type="number"
                    min={0}
                    className="input"
                    value={form.earningsMax}
                    placeholder="5000"
                    onChange={(event) => set("earningsMax", event.target.value)}
                  />
                  {fieldErrors.earningsMax && (
                    <p className="field-error">{fieldErrors.earningsMax[0]}</p>
                  )}
                </div>
              </div>

              <p className="hint">
                Leave the range empty if you would rather only share the deal
                count.
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy || form.offerId === ""}
                >
                  {busy ? "Saving…" : editing ? "Save log" : "Log deal"}
                </button>
                {notice && <p className="text-xs text-emerald-400">{notice}</p>}
              </div>
            </>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-red-900/70 bg-red-950/50 px-3 py-2 text-sm text-red-200"
            >
              {error}
            </p>
          )}
        </form>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
            Your logs
          </h2>
          {deals.length === 0 ? (
            <div className="panel px-6 py-10 text-center">
              <p className="text-sm text-zinc-400">
                Nothing logged yet — your first deal starts your profile.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {deals.map((deal) => (
                <li key={deal.id} className="panel p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">
                        {deal.offer.title}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {deal.offer.company} · {monthLabel(deal.month)} ·
                        updated {formatRelative(deal.updatedAt)}
                      </p>
                    </div>
                    {deal.partnerConfirmedAt ? (
                      <span className="badge badge-open">Partner confirmed</span>
                    ) : (
                      <span className="badge badge-pending">
                        Awaiting confirmation
                      </span>
                    )}
                  </div>

                  <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-zinc-800 pt-3 text-xs">
                    <div>
                      <dt className="text-zinc-500">Deals closed</dt>
                      <dd className="mt-0.5 text-sm font-semibold text-zinc-200">
                        {deal.dealsClosed}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Earnings</dt>
                      <dd className="mt-0.5 text-sm font-semibold text-zinc-200">
                        {deal.earningsMin === null && deal.earningsMax === null
                          ? "Not shared"
                          : `$${(deal.earningsMin ?? 0).toLocaleString()} – $${(deal.earningsMax ?? 0).toLocaleString()}`}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => edit(deal)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={deleting !== null}
                      onClick={() => void remove(deal.id)}
                    >
                      {deleting === deal.id ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <aside className="flex flex-col gap-4">
        <div className="panel p-5">
          <p className="text-xs uppercase tracking-wide text-zinc-500">
            Public profile
          </p>
          <Link
            href={`/reps/${username}`}
            className="mt-1 block text-sm font-semibold text-indigo-300 hover:text-indigo-200"
          >
            /reps/{username}
          </Link>
          <p className="mt-2 text-xs leading-5 text-zinc-500">
            Deals closed, offers worked and your partner rating are always
            shown. Only you (and admins) can see the earnings range while it is
            hidden.
          </p>
        </div>

        <div className="panel p-5">
          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-zinc-300">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-indigo-500"
              checked={hide}
              disabled={savingHide}
              onChange={(event) => void toggleHide(event.target.checked)}
            />
            <span>
              Hide my earnings range
              <span className="mt-1 block text-xs text-zinc-500">
                Deal counts and your rating stay visible.
              </span>
            </span>
          </label>
        </div>
      </aside>
    </div>
  );
}
