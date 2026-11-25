"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function OfferForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    setSending(true);
    setError("");

    const response = await fetch("/api/offers", {
      method: "POST",
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
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(
        payload?.error === "unauthorized"
          ? "Your admin session expired — reload and sign in again."
          : "Could not publish the offer. Check the fields.",
      );
      setSending(false);
      return;
    }

    form.reset();
    setSending(false);
    router.refresh();
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
        />
      </div>
      <div>
        <label className="label" htmlFor="offer-role">
          Role type
        </label>
        <select id="offer-role" name="role_type" className="field" defaultValue="closer">
          <option value="setter">Setter</option>
          <option value="closer">Closer</option>
          <option value="both">Full cycle</option>
        </select>
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
          placeholder="12+ months closing B2B deals over Zoom"
        />
      </div>
      <label className="flex items-center gap-3 text-sm text-mute sm:col-span-2">
        <input type="checkbox" name="featured" className="h-4 w-4 accent-[#ff5a1f]" />
        Feature this offer at the top of the board
      </label>

      {error ? (
        <p className="rounded-lg border border-ember/40 bg-ember/10 px-3 py-2 text-xs text-ember sm:col-span-2">
          {error}
        </p>
      ) : null}

      <div className="sm:col-span-2">
        <button type="submit" className="btn btn-primary" disabled={sending}>
          {sending ? "Publishing…" : "Publish offer"}
        </button>
      </div>
    </form>
  );
}
