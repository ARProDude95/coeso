"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ApplyForm({ offerId }: { offerId: string }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    setSending(true);
    setError("");

    const response = await fetch(`/api/offers/${offerId}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: data.get("email"),
        discord: data.get("discord"),
        experience: data.get("experience"),
        availability_hours: data.get("availability_hours"),
        message: data.get("message"),
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(
        payload?.error === "already_applied"
          ? "You have already applied to this offer."
          : payload?.error === "closed"
            ? "This offer is closed."
            : payload?.error === "unauthorized"
              ? "Your session expired — sign in again."
              : "Could not send your application. Check the fields.",
      );
      setSending(false);
      return;
    }

    form.reset();
    setSending(false);
    setSent(true);
    router.refresh();
  }

  if (sent) {
    return (
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ember">
          Application sent
        </p>
        <p className="mt-3 text-sm leading-relaxed text-mute">
          Coeso’s Owner will review it and reply to the email you gave. Message{" "}
          <span className="font-mono text-ember">a1rymn</span> on Discord if you
          want to follow up.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-3">
      <div>
        <label className="label" htmlFor="apply-email">
          Email
        </label>
        <input
          id="apply-email"
          name="email"
          type="email"
          required
          maxLength={200}
          className="field"
          placeholder="you@example.com"
        />
      </div>
      <div>
        <label className="label" htmlFor="apply-discord">
          Discord
        </label>
        <input
          id="apply-discord"
          name="discord"
          required
          maxLength={80}
          className="field"
          placeholder="yourhandle"
        />
      </div>
      <div>
        <label className="label" htmlFor="apply-experience">
          Experience
        </label>
        <textarea
          id="apply-experience"
          name="experience"
          required
          rows={3}
          maxLength={400}
          className="field resize-y"
          placeholder="Where you have set or closed before, and results."
        />
      </div>
      <div>
        <label className="label" htmlFor="apply-hours">
          Hours per week
        </label>
        <input
          id="apply-hours"
          name="availability_hours"
          type="number"
          min={1}
          max={80}
          required
          className="field"
          placeholder="20"
        />
      </div>
      <div>
        <label className="label" htmlFor="apply-message">
          Anything else <span className="normal-case">(optional)</span>
        </label>
        <textarea
          id="apply-message"
          name="message"
          rows={2}
          maxLength={2000}
          className="field resize-y"
        />
      </div>

      {error ? (
        <p className="rounded-lg border border-ember/40 bg-ember/10 px-3 py-2 text-xs text-ember">
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary w-full" disabled={sending}>
        {sending ? "Sending…" : "Apply to this offer"}
      </button>
      <p className="text-xs leading-relaxed text-mute">
        Applications are only visible to Coeso’s Owner.
      </p>
    </form>
  );
}
