"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SelectMenu } from "@/components/select-menu";
import type { Offer } from "@/lib/store";

const ROLE_OPTIONS: Array<{ value: Offer["role_type"]; label: string }> = [
  { value: "setter", label: "Setter" },
  { value: "closer", label: "Closer" },
  { value: "both", label: "Full cycle" },
];

export function OfferForm({ offer }: { offer?: Offer }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [role, setRole] = useState<Offer["role_type"]>(
    offer?.role_type ?? "closer",
  );

  const editing = Boolean(offer);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    setSending(true);
    setError("");

    const response = await fetch(
      editing ? `/api/offers/${offer?.id}` : "/api/offers",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: data.get("title"),
          company: data.get("company"),
          role_type: data.get("role_type"),
          commission: data.get("commission"),
          pay_type: data.get("pay_type"),
          description: data.get("description"),
          requirements: data.get("requirements"),
          featured: data.get("featured") === "on",
        }),
      },
    );

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(
        payload?.error === "unauthorized"
          ? "Your account no longer has admin access — sign in again."
          : "Could not save the offer. Check the fields.",
      );
      setSending(false);
      return;
    }

    if (!editing) {
      form.reset();
      setRole("closer");
    }
    setSending(false);
    router.refresh();
    if (editing) router.push("/admin");
  }

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="label" htmlFor="offer-title">
          Title
        </label>
        <input
          id="offer-title"
          name="title"
          required
          maxLength={140}
          className="field"
          defaultValue={offer?.title}
          placeholder="High-ticket closer — B2B SaaS"
        />
      </div>
      <div>
        <label className="label" htmlFor="offer-company">
          Company
        </label>
        <input
          id="offer-company"
          name="company"
          required
          maxLength={120}
          className="field"
          defaultValue={offer?.company}
        />
      </div>
      <div>
        <span className="label">Role type</span>
        <input type="hidden" name="role_type" value={role} />
        <SelectMenu
          label="Role type"
          value={role}
          options={ROLE_OPTIONS}
          onChange={setRole}
        />
      </div>
      <div>
        <label className="label" htmlFor="offer-commission">
          Commission
        </label>
        <input
          id="offer-commission"
          name="commission"
          required
          maxLength={140}
          className="field"
          defaultValue={offer?.commission}
          placeholder="18% of contract value"
        />
      </div>
      <div>
        <label className="label" htmlFor="offer-pay">
          Pay structure
        </label>
        <input
          id="offer-pay"
          name="pay_type"
          required
          maxLength={80}
          className="field"
          defaultValue={offer?.pay_type}
          placeholder="Commission only"
        />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="offer-description">
          Description
        </label>
        <textarea
          id="offer-description"
          name="description"
          required
          rows={5}
          maxLength={4000}
          className="field resize-y"
          defaultValue={offer?.description}
          placeholder="What the role is, who the leads are, how the cycle works…"
        />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="offer-requirements">
          Requirements (one per line)
        </label>
        <textarea
          id="offer-requirements"
          name="requirements"
          rows={4}
          maxLength={4000}
          className="field resize-y"
          defaultValue={offer?.requirements}
          placeholder="12+ months closing B2B deals over Zoom"
        />
      </div>
      <label className="flex items-center gap-3 text-sm text-mute sm:col-span-2">
        <input
          type="checkbox"
          name="featured"
          defaultChecked={offer ? offer.featured === 1 : undefined}
          className="h-4 w-4 accent-[#ff5a1f]"
        />
        Feature this offer at the top of the board
      </label>

      {error ? (
        <p className="rounded-lg border border-ember/40 bg-ember/10 px-3 py-2 text-xs text-ember sm:col-span-2">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" className="btn btn-primary" disabled={sending}>
          {sending
            ? "Saving…"
            : editing
              ? "Save changes"
              : "Publish offer"}
        </button>
        {editing ? (
          <button
            type="button"
            className="btn"
            onClick={() => router.push("/admin")}
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
