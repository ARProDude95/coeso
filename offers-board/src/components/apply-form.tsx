"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  APPLY_FIELD_ORDER,
  EMPTY_APPLY_FIELDS,
  applyDraftKey,
  normalizeDraft,
  validateApplyFields,
  type ApplyErrors,
  type ApplyFieldName,
  type ApplyFields,
} from "@/lib/apply-fields";

export function ApplyForm({ offerId }: { offerId: string }) {
  const router = useRouter();

  const [fields, setFields] = useState<ApplyFields>(EMPTY_APPLY_FIELDS);
  const [errors, setErrors] = useState<ApplyErrors>({});
  const [touched, setTouched] = useState<
    Partial<Record<ApplyFieldName, boolean>>
  >({});
  const [restored, setRestored] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  // A closed tab should not cost the member their answers.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(applyDraftKey(offerId));
      if (!raw) return;
      const draft = normalizeDraft(JSON.parse(raw) as unknown);
      if (Object.values(draft).some((value) => value.trim())) {
        setFields(draft);
        setRestored(true);
      }
    } catch {
      // A corrupt draft just means starting fresh.
    }
  }, [offerId]);

  function saveDraft(next: ApplyFields) {
    try {
      if (Object.values(next).every((value) => value.trim() === "")) {
        window.localStorage.removeItem(applyDraftKey(offerId));
        setSavedAt(null);
        setRestored(false);
        return;
      }
      window.localStorage.setItem(applyDraftKey(offerId), JSON.stringify(next));
      setSavedAt(
        new Date().toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    } catch {
      // No storage available: the form still submits normally.
    }
  }

  function update(name: ApplyFieldName, value: string) {
    const next = { ...fields, [name]: value };
    setFields(next);
    saveDraft(next);
    if (touched[name]) setErrors(validateApplyFields(next));
  }

  function blur(name: ApplyFieldName) {
    setTouched((current) => ({ ...current, [name]: true }));
    setErrors(validateApplyFields(fields));
  }

  function clearDraft() {
    try {
      window.localStorage.removeItem(applyDraftKey(offerId));
    } catch {
      // Nothing to clear.
    }
    setFields(EMPTY_APPLY_FIELDS);
    setErrors({});
    setTouched({});
    setSavedAt(null);
    setRestored(false);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const found = validateApplyFields(fields);
    setErrors(found);
    setTouched(
      Object.fromEntries(
        APPLY_FIELD_ORDER.map((name) => [name, true]),
      ) as Record<ApplyFieldName, boolean>,
    );

    const firstInvalid = APPLY_FIELD_ORDER.find((name) => found[name]);
    if (firstInvalid) {
      document.getElementById(`apply-${firstInvalid}`)?.focus();
      return;
    }

    setSending(true);
    setError("");

    const response = await fetch(`/api/offers/${offerId}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: fields.email.trim(),
        discord: fields.discord.trim(),
        experience: fields.experience.trim(),
        availability_hours: fields.availability_hours.trim(),
        message: fields.message,
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

    try {
      window.localStorage.removeItem(applyDraftKey(offerId));
    } catch {
      // Nothing to clear.
    }

    setSending(false);
    setSent(true);
    router.refresh();
  }

  if (sent) {
    return (
      <div>
        <p className="eyebrow eyebrow-ember">Application sent</p>
        <p className="mt-3 text-sm leading-relaxed text-mute">
          Coeso’s Owner will review it and reply to the email you gave. Message{" "}
          <span className="font-mono text-ember">a1rymn</span> on Discord if you
          want to follow up.{" "}
          <Link href="/applications" className="text-ember underline">
            Track its status
          </Link>
          .
        </p>
      </div>
    );
  }

  const fieldError = (name: ApplyFieldName) =>
    touched[name] ? errors[name] : undefined;

  return (
    <form onSubmit={submit} className="mt-5 space-y-3" noValidate>
      {restored ? (
        <p className="rounded-lg border border-line bg-ink px-3 py-2 text-xs text-mute">
          Picked up where you left off.
          {savedAt ? ` Draft saved at ${savedAt}.` : ""}{" "}
          <button
            type="button"
            onClick={clearDraft}
            className="underline underline-offset-4 hover:text-paper"
          >
            Start over
          </button>
        </p>
      ) : savedAt ? (
        <p className="text-[11px] text-mute" aria-live="polite">
          Draft saved on this device at {savedAt}.
        </p>
      ) : null}

      <div>
        <label className="label" htmlFor="apply-email">
          Email
        </label>
        <input
          id="apply-email"
          name="email"
          type="email"
          autoComplete="email"
          maxLength={200}
          value={fields.email}
          onChange={(event) => update("email", event.target.value)}
          onBlur={() => blur("email")}
          aria-invalid={Boolean(fieldError("email"))}
          aria-describedby={fieldError("email") ? "apply-email-error" : undefined}
          className="field"
          placeholder="you@example.com"
        />
        {fieldError("email") ? (
          <p
            id="apply-email-error"
            role="alert"
            className="mt-1.5 text-xs text-ember"
          >
            {errors.email}
          </p>
        ) : null}
      </div>

      <div>
        <label className="label" htmlFor="apply-discord">
          Discord
        </label>
        <input
          id="apply-discord"
          name="discord"
          maxLength={80}
          value={fields.discord}
          onChange={(event) => update("discord", event.target.value)}
          onBlur={() => blur("discord")}
          aria-invalid={Boolean(fieldError("discord"))}
          aria-describedby={
            fieldError("discord") ? "apply-discord-error" : undefined
          }
          className="field"
          placeholder="yourhandle"
        />
        {fieldError("discord") ? (
          <p
            id="apply-discord-error"
            role="alert"
            className="mt-1.5 text-xs text-ember"
          >
            {errors.discord}
          </p>
        ) : null}
      </div>

      <div>
        <label className="label" htmlFor="apply-experience">
          Experience
        </label>
        <textarea
          id="apply-experience"
          name="experience"
          rows={3}
          maxLength={400}
          value={fields.experience}
          onChange={(event) => update("experience", event.target.value)}
          onBlur={() => blur("experience")}
          aria-invalid={Boolean(fieldError("experience"))}
          aria-describedby={
            fieldError("experience") ? "apply-experience-error" : undefined
          }
          className="field resize-y"
          placeholder="Where you have set or closed before, and results."
        />
        <div className="mt-1.5 flex items-start justify-between gap-3">
          {fieldError("experience") ? (
            <p
              id="apply-experience-error"
              role="alert"
              className="text-xs text-ember"
            >
              {errors.experience}
            </p>
          ) : (
            <span />
          )}
          <span className="shrink-0 font-mono text-[10px] text-mute">
            {fields.experience.length}/400
          </span>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="apply-hours">
          Hours per week
        </label>
        <input
          id="apply-hours"
          name="availability_hours"
          type="number"
          inputMode="numeric"
          min={1}
          max={80}
          value={fields.availability_hours}
          onChange={(event) => update("availability_hours", event.target.value)}
          onBlur={() => blur("availability_hours")}
          aria-invalid={Boolean(fieldError("availability_hours"))}
          aria-describedby={
            fieldError("availability_hours") ? "apply-hours-error" : undefined
          }
          className="field"
          placeholder="20"
        />
        {fieldError("availability_hours") ? (
          <p
            id="apply-hours-error"
            role="alert"
            className="mt-1.5 text-xs text-ember"
          >
            {errors.availability_hours}
          </p>
        ) : null}
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
          value={fields.message}
          onChange={(event) => update("message", event.target.value)}
          onBlur={() => blur("message")}
          aria-invalid={Boolean(fieldError("message"))}
          aria-describedby={
            fieldError("message") ? "apply-message-error" : undefined
          }
          className="field resize-y"
        />
        {fieldError("message") ? (
          <p
            id="apply-message-error"
            role="alert"
            className="mt-1.5 text-xs text-ember"
          >
            {errors.message}
          </p>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-ember/40 bg-ember/10 px-3 py-2 text-xs text-ember"
        >
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary w-full" disabled={sending}>
        {sending ? "Sending…" : "Apply to this offer"}
      </button>
      <p className="text-xs leading-relaxed text-mute">
        Applications are only visible to Coeso’s Owner. Your answers are kept on
        this device until you send them.
      </p>
    </form>
  );
}
