"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EXPERIENCE_LEVELS, EXPERIENCE_LEVEL_LABELS } from "@/lib/types";

interface Props {
  offerId: string;
}

interface ApiFailure {
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

const EMPTY = {
  experienceLevel: "entry",
  availabilityHours: "10",
  pastResults: "",
  message: "",
};

export function ApplyForm({ offerId }: Props) {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  function set<K extends keyof typeof EMPTY>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    setFieldErrors({});

    try {
      const response = await fetch(`/api/offers/${offerId}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          experienceLevel: form.experienceLevel,
          availabilityHours: Number(form.availabilityHours),
          pastResults: form.pastResults,
          message: form.message,
        }),
      });

      if (response.ok) {
        setDone(true);
        router.refresh();
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as ApiFailure;
      setFieldErrors(payload.fieldErrors ?? {});
      setFormError(payload.error ?? "Something went wrong. Please try again.");
    } catch {
      setFormError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="panel flex flex-col items-start gap-3 border-emerald-900/60 p-5">
        <span className="badge badge-accepted">Application sent</span>
        <p className="text-sm leading-6 text-zinc-300">
          Your application is in review. You&apos;ll see status updates on your
          applications page.
        </p>
        <div className="flex gap-2">
          <Link href="/applications" className="btn btn-primary">
            My applications
          </Link>
          <Link href="/offers" className="btn btn-secondary">
            Browse more offers
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="panel flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-base font-semibold text-zinc-50">Apply to this offer</h2>
        <p className="mt-0.5 text-xs text-zinc-500">
          One application per offer. Everything is reviewed by the Coeso team.
        </p>
      </div>

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
          <label className="label" htmlFor="experienceLevel">
            Experience level
          </label>
          <select
            id="experienceLevel"
            className="select"
            value={form.experienceLevel}
            onChange={(e) => set("experienceLevel", e.target.value)}
          >
            {EXPERIENCE_LEVELS.map((level) => (
              <option key={level} value={level}>
                {EXPERIENCE_LEVEL_LABELS[level]}
              </option>
            ))}
          </select>
          {fieldErrors.experienceLevel?.[0] && (
            <p className="field-error">{fieldErrors.experienceLevel[0]}</p>
          )}
        </div>

        <div>
          <label className="label" htmlFor="availabilityHours">
            Availability (hrs / week)
          </label>
          <input
            id="availabilityHours"
            type="number"
            min={1}
            max={168}
            className="input"
            value={form.availabilityHours}
            onChange={(e) => set("availabilityHours", e.target.value)}
          />
          {fieldErrors.availabilityHours?.[0] && (
            <p className="field-error">{fieldErrors.availabilityHours[0]}</p>
          )}
        </div>
      </div>

      <div>
        <label className="label" htmlFor="message">
          Short message
        </label>
        <textarea
          id="message"
          className="textarea"
          maxLength={600}
          placeholder="Why are you a good fit for this offer? (10–600 characters)"
          value={form.message}
          onChange={(e) => set("message", e.target.value)}
        />
        <p className="hint">
          {form.message.trim().length}/600 characters (minimum 10)
        </p>
        {fieldErrors.message?.[0] && (
          <p className="field-error">{fieldErrors.message[0]}</p>
        )}
      </div>

      <div>
        <label className="label" htmlFor="pastResults">
          Past sales results <span className="text-zinc-500">(optional)</span>
        </label>
        <textarea
          id="pastResults"
          className="textarea"
          maxLength={1500}
          placeholder="e.g. Closed $40k MRR in Q3 across 12 enterprise deals."
          value={form.pastResults}
          onChange={(e) => set("pastResults", e.target.value)}
        />
        {fieldErrors.pastResults?.[0] && (
          <p className="field-error">{fieldErrors.pastResults[0]}</p>
        )}
      </div>

      <button type="submit" disabled={busy} className="btn btn-primary w-full">
        {busy ? "Submitting…" : "Submit application"}
      </button>
    </form>
  );
}
