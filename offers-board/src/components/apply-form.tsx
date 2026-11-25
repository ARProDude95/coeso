"use client";

import { useState } from "react";

export function ApplyForm({ offerId }: { offerId: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    setState("sending");
    setError("");

    const response = await fetch("/api/applications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        offer_id: offerId,
        name: form.get("name"),
        email: form.get("email"),
        discord: form.get("discord"),
        experience: form.get("experience"),
        availability_hours: Number(form.get("availability_hours")),
        message: form.get("message"),
      }),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(
        data?.error === "offer_closed"
          ? "This offer just closed — applications are closed."
          : data?.error === "invalid"
            ? "Check the fields — some details look incomplete."
            : "Something went wrong. Try again.",
      );
      setState("idle");
      return;
    }

    setState("sent");
  }

  if (state === "sent") {
    return (
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ember">
          Application sent
        </p>
        <h2 className="mt-3 font-display text-2xl">You&rsquo;re in the queue.</h2>
        <p className="mt-2 text-sm leading-relaxed text-mute">
          The business that posted this offer has your details and will reach
          out directly. Keep an eye on your Discord DMs and inbox.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ember">
        Apply
      </p>
      <h2 className="mt-3 font-display text-2xl">Put yourself forward</h2>
      <p className="mt-2 text-sm leading-relaxed text-mute">
        Goes straight to the business that posted it. No account needed.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label className="label" htmlFor="apply-name">
            Full name
          </label>
          <input
            id="apply-name"
            name="name"
            required
            maxLength={120}
            className="field"
            autoComplete="name"
          />
        </div>
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
            autoComplete="email"
          />
        </div>
        <div>
          <label className="label" htmlFor="apply-discord">
            Discord handle
          </label>
          <input
            id="apply-discord"
            name="discord"
            required
            maxLength={80}
            placeholder="you#0000 or @you"
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="apply-experience">
            Experience
          </label>
          <select
            id="apply-experience"
            name="experience"
            required
            className="field"
            defaultValue=""
          >
            <option value="" disabled>
              Select one
            </option>
            <option>New — under 6 months</option>
            <option>Some — 6–12 months</option>
            <option>Experienced — 1–3 years</option>
            <option>Veteran — 3+ years</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="apply-hours">
            Hours available / week
          </label>
          <input
            id="apply-hours"
            name="availability_hours"
            type="number"
            min={1}
            max={80}
            required
            defaultValue={20}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="apply-message">
            Anything else (optional)
          </label>
          <textarea
            id="apply-message"
            name="message"
            rows={3}
            maxLength={2000}
            className="field resize-y"
            placeholder="Track record, timezone, links…"
          />
        </div>

        {error ? (
          <p className="rounded-lg border border-ember/40 bg-ember/10 px-3 py-2 text-xs text-ember">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          className="btn btn-primary w-full"
          disabled={state === "sending"}
        >
          {state === "sending" ? "Sending…" : "Send application"}
        </button>
      </form>
    </div>
  );
}
