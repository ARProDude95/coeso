"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { initials } from "@/lib/initials";
import { formatRelative } from "@/lib/format";
import {
  APPLICATION_STATUS_LABELS,
  EXPERIENCE_LEVEL_LABELS,
  type ApplicationStatus,
  type ApplicationWithApplicant,
} from "@/lib/types";

const STATUS_BADGE: Record<ApplicationStatus, string> = {
  pending: "badge badge-pending",
  accepted: "badge badge-accepted",
  rejected: "badge badge-rejected",
};

export function ApplicantReview({
  application,
}: {
  application: ApplicationWithApplicant;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<ApplicationStatus>(application.status);
  const [note, setNote] = useState(application.adminNote ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function patch(body: Record<string, unknown>, action: string) {
    setBusy(action);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(
        `/api/admin/applications/${application.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          fieldErrors?: Record<string, string[]>;
        };
        setError(
          payload.fieldErrors?.adminNote?.[0] ??
            payload.error ??
            "Could not save the review",
        );
        return;
      }
      if (typeof body.status === "string") {
        setStatus(body.status as ApplicationStatus);
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(null);
    }
  }

  const applicant = application.applicant;

  return (
    <li className="panel flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-700 text-sm font-semibold text-zinc-200">
            {initials(applicant.name)}
          </span>
          <div>
            <p className="text-sm font-semibold text-zinc-100">
              {applicant.name}
            </p>
            <p className="text-xs text-zinc-500">
              {applicant.email} · applied {formatRelative(application.createdAt)}
            </p>
          </div>
        </div>
        <span className={STATUS_BADGE[status]}>
          {APPLICATION_STATUS_LABELS[status]}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-3 border-y border-zinc-800 py-3 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-zinc-500">Experience</dt>
          <dd className="mt-0.5 font-medium text-zinc-200">
            {EXPERIENCE_LEVEL_LABELS[application.experienceLevel]}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Availability</dt>
          <dd className="mt-0.5 font-medium text-zinc-200">
            {application.availabilityHours} hrs / week
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Past results</dt>
          <dd className="mt-0.5 font-medium text-zinc-200">
            {application.pastResults ? "Provided" : "Not provided"}
          </dd>
        </div>
      </dl>

      <div>
        <p className="text-xs uppercase tracking-wide text-zinc-500">Message</p>
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-zinc-300">
          {application.message}
        </p>
        {application.pastResults && (
          <>
            <p className="mt-3 text-xs uppercase tracking-wide text-zinc-500">
              Past sales results
            </p>
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-zinc-300">
              {application.pastResults}
            </p>
          </>
        )}
      </div>

      <div>
        <label className="label" htmlFor={`note-${application.id}`}>
          Private note{" "}
          <span className="text-zinc-500">(admins only — never shown to the applicant)</span>
        </label>
        <textarea
          id={`note-${application.id}`}
          className="textarea"
          rows={3}
          maxLength={2000}
          value={note}
          placeholder="e.g. Strong closer, schedule a second call with Marcus."
          onChange={(event) => {
            setNote(event.target.value);
            setSaved(false);
          }}
        />
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-900/70 bg-red-950/50 px-3 py-2 text-sm text-red-200"
        >
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="text-xs text-emerald-400">Saved.</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-success"
          disabled={busy !== null}
          onClick={() => patch({ status: "accepted", adminNote: note }, "accept")}
        >
          {busy === "accept" ? "Saving…" : "Accept"}
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy !== null}
          onClick={() => patch({ status: "rejected", adminNote: note }, "reject")}
        >
          {busy === "reject" ? "Saving…" : "Reject"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy !== null || note === (application.adminNote ?? "")}
          onClick={() => patch({ adminNote: note }, "note")}
        >
          {busy === "note" ? "Saving…" : "Save note"}
        </button>
      </div>
    </li>
  );
}
