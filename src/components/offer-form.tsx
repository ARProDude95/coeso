"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TIERS, TIER_LABELS } from "@/lib/tiers";
import {
  OFFER_STATUSES,
  PAY_TYPES,
  ROLE_TYPES,
  type Offer,
} from "@/lib/types";

interface Props {
  offer?: Offer;
  /** Paid plan: shows the role-gate field (the API rejects it on free). */
  canGate: boolean;
  /** Roles already in use on this board, offered as autocomplete options. */
  roleSuggestions?: string[];
  /** Partner submission: no admin-only switches, and a pending-approval note. */
  partner?: boolean;
}

interface ApiFailure {
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const EMPTY = {
  title: "",
  company: "",
  description: "",
  roleType: "setter",
  commission: "",
  payType: "Commission only",
  requirements: "",
  status: "open",
  expiresAt: "",
  featured: false,
  requiredRole: "",
  tier: "free",
  commissionAmount: "",
};

export function OfferForm({
  offer,
  canGate,
  roleSuggestions = [],
  partner = false,
}: Props) {
  const router = useRouter();
  const editing = Boolean(offer);

  const [form, setForm] = useState(() =>
    offer
      ? {
          title: offer.title,
          company: offer.company,
          description: offer.description,
          roleType: offer.roleType,
          commission: offer.commission,
          payType: offer.payType,
          requirements: offer.requirements,
          status: offer.status,
          expiresAt: toLocalInput(offer.expiresAt),
          featured: offer.featured,
          requiredRole: offer.requiredRole ?? "",
          tier: offer.tier,
          commissionAmount:
            offer.commissionAmount === null ? "" : String(offer.commissionAmount),
        }
      : EMPTY,
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    setFieldErrors({});

    const payload: Record<string, unknown> = {
      title: form.title,
      company: form.company,
      description: form.description,
      roleType: form.roleType,
      commission: form.commission,
      payType: form.payType,
      requirements: form.requirements,
      status: form.status,
      expiresAt: fromLocalInput(form.expiresAt),
      tier: form.tier,
      commissionAmount:
        form.commissionAmount.trim() === "" ? null : Number(form.commissionAmount),
    };

    // Featuring is an admin switch; a partner payload must not carry it at
    // all (the API rejects the field for partners).
    if (!partner) payload.featured = form.featured;

    // Only sent while the gate is offered: on a free plan the key is omitted
    // so an existing gate is never silently cleared by an unrelated edit.
    if (canGate) {
      const gate = form.requiredRole.trim().toLowerCase();
      payload.requiredRole = gate === "" ? null : gate;
    }

    try {
      const response = await fetch(
        editing ? `/api/offers/${offer!.id}` : "/api/offers",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (response.ok) {
        router.push("/admin");
        router.refresh();
        return;
      }

      const body = (await response.json().catch(() => ({}))) as ApiFailure;
      setFieldErrors(body.fieldErrors ?? {});
      setFormError(body.error ?? "Something went wrong. Please try again.");
    } catch {
      setFormError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  const error = (key: string) => fieldErrors[key]?.[0];

  return (
    <form onSubmit={submit} className="panel flex flex-col gap-5 p-6">
      {formError && (
        <p
          role="alert"
          className="rounded-lg border border-red-900/70 bg-red-950/50 px-3 py-2 text-sm text-red-200"
        >
          {formError}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="title">Title</label>
          <input
            id="title"
            className="input"
            maxLength={120}
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Senior Closer — Enterprise SaaS"
          />
          {error("title") && <p className="field-error">{error("title")}</p>}
        </div>

        <div>
          <label className="label" htmlFor="company">Company</label>
          <input
            id="company"
            className="input"
            maxLength={80}
            value={form.company}
            onChange={(e) => set("company", e.target.value)}
            placeholder="Acme Corp"
          />
          {error("company") && <p className="field-error">{error("company")}</p>}
        </div>
      </div>

      <div>
        <label className="label" htmlFor="description">Description</label>
        <textarea
          id="description"
          className="textarea"
          rows={7}
          maxLength={5000}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="What the role involves, who it suits, and what success looks like."
        />
        {error("description") && (
          <p className="field-error">{error("description")}</p>
        )}
      </div>

      <div>
        <label className="label" htmlFor="requirements">
          Requirements <span className="text-zinc-500">(optional)</span>
        </label>
        <textarea
          id="requirements"
          className="textarea"
          rows={4}
          maxLength={2000}
          value={form.requirements}
          onChange={(e) => set("requirements", e.target.value)}
          placeholder="• 2+ years closing high-ticket deals&#10;• CRM fluency (HubSpot)"
        />
        {error("requirements") && (
          <p className="field-error">{error("requirements")}</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="roleType">Role type</label>
          <select
            id="roleType"
            className="select"
            value={form.roleType}
            onChange={(e) => set("roleType", e.target.value)}
          >
            {ROLE_TYPES.map((value) => (
              <option key={value} value={value}>
                {value === "both" ? "Setter + Closer" : value[0].toUpperCase() + value.slice(1)}
              </option>
            ))}
          </select>
          {error("roleType") && <p className="field-error">{error("roleType")}</p>}
        </div>

        <div>
          <label className="label" htmlFor="payType">Pay type</label>
          <select
            id="payType"
            className="select"
            value={form.payType}
            onChange={(e) => set("payType", e.target.value)}
          >
            {PAY_TYPES.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
          {error("payType") && <p className="field-error">{error("payType")}</p>}
        </div>

        <div>
          <label className="label" htmlFor="commission">Commission</label>
          <input
            id="commission"
            className="input"
            maxLength={120}
            value={form.commission}
            onChange={(e) => set("commission", e.target.value)}
            placeholder="$1,500 / closed deal"
          />
          {error("commission") && (
            <p className="field-error">{error("commission")}</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="tier">Audience tier</label>
          <select
            id="tier"
            className="select"
            value={form.tier}
            onChange={(e) => set("tier", e.target.value)}
          >
            {TIERS.map((value) => (
              <option key={value} value={value}>
                {TIER_LABELS[value]}
              </option>
            ))}
          </select>
          <p className="hint">Used by saved-search tier filters.</p>
          {error("tier") && <p className="field-error">{error("tier")}</p>}
        </div>

        <div>
          <label className="label" htmlFor="commissionAmount">
            Commission amount <span className="text-zinc-500">(optional)</span>
          </label>
          <input
            id="commissionAmount"
            type="number"
            min={0}
            className="input"
            value={form.commissionAmount}
            onChange={(e) => set("commissionAmount", e.target.value)}
            placeholder="1500"
          />
          <p className="hint">A number so “minimum commission” filters match.</p>
          {error("commissionAmount") && (
            <p className="field-error">{error("commissionAmount")}</p>
          )}
        </div>
      </div>

      {partner && !editing && (
        <p className="rounded-lg border border-indigo-900/70 bg-indigo-950/40 px-3 py-2 text-sm text-indigo-200">
          This offer is submitted for admin approval. It appears on the board
          only after an admin approves it.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {!partner && (
          <div>
            <label className="label" htmlFor="status">Status</label>
            <select
              id="status"
              className="select"
              value={form.status}
              onChange={(e) => set("status", e.target.value)}
            >
              {OFFER_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value[0].toUpperCase() + value.slice(1)}
                </option>
              ))}
            </select>
            <p className="hint">
              Paused hides it from open searches; closed ends it.
            </p>
            {error("status") && <p className="field-error">{error("status")}</p>}
          </div>
        )}

        <div>
          <label className="label" htmlFor="expiresAt">
            Expires at <span className="text-zinc-500">(optional)</span>
          </label>
          <input
            id="expiresAt"
            type="datetime-local"
            className="input"
            value={form.expiresAt}
            onChange={(e) => set("expiresAt", e.target.value)}
          />
          <p className="hint">Expired offers are closed automatically.</p>
          {error("expiresAt") && (
            <p className="field-error">{error("expiresAt")}</p>
          )}
        </div>

        {!partner && (
          <div className="flex items-end pb-1">
            <label className="flex cursor-pointer items-center gap-2.5 text-sm text-zinc-300">
              <input
                type="checkbox"
                className="h-4 w-4 accent-indigo-500"
                checked={form.featured}
                onChange={(e) => set("featured", e.target.checked)}
              />
              Featured (pinned to top)
            </label>
          </div>
        )}
      </div>

      {canGate && (
        <div className="border-t border-zinc-800 pt-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="w-full sm:max-w-md">
              <label className="label" htmlFor="requiredRole">
                Gate to a role <span className="text-zinc-500">(optional)</span>
              </label>
              <input
                id="requiredRole"
                className="input"
                list={
                  roleSuggestions.length > 0
                    ? "offer-role-suggestions"
                    : undefined
                }
                maxLength={32}
                placeholder="closer-vip"
                value={form.requiredRole}
                onChange={(e) => set("requiredRole", e.target.value)}
              />
              {roleSuggestions.length > 0 && (
                <datalist id="offer-role-suggestions">
                  {roleSuggestions.map((role) => (
                    <option key={role} value={role} />
                  ))}
                </datalist>
              )}
            </div>
            <span className="badge badge-accent">Paid plan</span>
          </div>
          <p className="hint">
            Members without this role never see this offer — the page and the
            apply endpoint both return 404 for them. Leave it empty to show the
            offer to everyone.
          </p>
          {error("requiredRole") && (
            <p className="field-error">{error("requiredRole")}</p>
          )}
        </div>
      )}

      <div className="flex gap-3 border-t border-zinc-800 pt-5">
        <button type="submit" disabled={busy} className="btn btn-primary">
          {busy
            ? "Saving…"
            : editing
              ? "Save changes"
              : partner
                ? "Submit for approval"
                : "Publish offer"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => router.push("/admin")}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
