"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface ReviewSummaryView {
  count: number;
  payout: number;
  lead: number;
  support: number;
  overall: number;
}

interface CommentView {
  id: string;
  reviewerName: string;
  payoutRating: number;
  leadRating: number;
  supportRating: number;
  comment: string;
  createdAt: string;
}

interface EligibilityView {
  can: boolean;
  code: "ok" | "not_accepted" | "tier_required";
}

interface Props {
  offerId: string;
  summary: ReviewSummaryView | null;
  comments: CommentView[] | null;
  commentsVisible: boolean;
  eligibility: EligibilityView;
  hasExisting: boolean;
}

interface ApiFailure {
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

const RATING_COPY: Record<EligibilityView["code"], string> = {
  ok: "",
  not_accepted: "Reviews are for members whose application was accepted.",
  tier_required: "Writing reviews is an Elite feature.",
};

function Stars({ value }: { value: number }) {
  return (
    <span aria-label={`${value} out of 5`} className="text-amber-400">
      {"★".repeat(value)}
      <span className="text-zinc-700">{"★".repeat(5 - value)}</span>
    </span>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="flex items-center gap-2 text-sm font-medium text-zinc-200">
        <Stars value={Math.round(value)} />
        <span className="tabular-nums text-zinc-400">{value.toFixed(1)}</span>
      </dd>
    </div>
  );
}

export function OfferReviews({
  offerId,
  summary,
  comments,
  commentsVisible,
  eligibility,
  hasExisting,
}: Props) {
  const router = useRouter();
  const [payout, setPayout] = useState(5);
  const [lead, setLead] = useState(5);
  const [support, setSupport] = useState(5);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      const response = await fetch(`/api/offers/${offerId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payoutRating: payout,
          leadRating: lead,
          supportRating: support,
          comment,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiFailure;
        setFieldErrors(body.fieldErrors ?? {});
        setError(body.error ?? "Could not save your review.");
        return;
      }
      setComment("");
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (key: string) => fieldErrors[key]?.[0];

  return (
    <section className="panel flex flex-col gap-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Reviews
        </h2>
        {summary && (
          <span className="badge badge-neutral">
            {summary.count} review{summary.count === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {summary ? (
        <dl className="grid gap-4 sm:grid-cols-4">
          <Metric label="Overall" value={summary.overall} />
          <Metric label="Payout reliability" value={summary.payout} />
          <Metric label="Lead quality" value={summary.lead} />
          <Metric label="Support" value={summary.support} />
        </dl>
      ) : (
        <p className="text-sm text-zinc-400">No reviews yet.</p>
      )}

      {comments && comments.length > 0 && (
        <ul className="flex flex-col gap-3 border-t border-zinc-800 pt-4">
          {comments.map((review) => (
            <li key={review.id} className="rounded-lg bg-zinc-900/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-zinc-100">
                  {review.reviewerName}
                </span>
                <span className="text-xs text-zinc-500">
                  {new Date(review.createdAt).toLocaleDateString("en-US")}
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-3 text-xs text-zinc-400">
                <div>
                  Payout <Stars value={review.payoutRating} />
                </div>
                <div>
                  Leads <Stars value={review.leadRating} />
                </div>
                <div>
                  Support <Stars value={review.supportRating} />
                </div>
              </dl>
              {review.comment && (
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-300">
                  {review.comment}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {!commentsVisible && summary && summary.count > 0 && (
        <p className="border-t border-zinc-800 pt-4 text-xs text-zinc-500">
          Individual comments are visible to Elite members. The averages above
          are for everyone.
        </p>
      )}

      {eligibility.code === "ok" && !hasExisting && (
        <form onSubmit={submit} className="flex flex-col gap-4 border-t border-zinc-800 pt-5">
          <p className="text-sm font-semibold text-zinc-100">Write a review</p>

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-red-900/70 bg-red-950/50 px-3 py-2 text-sm text-red-200"
            >
              {error}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                ["Payout reliability", payout, setPayout, "payoutRating"],
                ["Lead quality", lead, setLead, "leadRating"],
                ["Support", support, setSupport, "supportRating"],
              ] as const
            ).map(([label, value, setter, key]) => (
              <div key={key}>
                <label className="label" htmlFor={`review-${key}`}>
                  {label}
                </label>
                <select
                  id={`review-${key}`}
                  className="select"
                  value={value}
                  onChange={(event) => setter(Number(event.target.value))}
                >
                  {[5, 4, 3, 2, 1].map((rating) => (
                    <option key={rating} value={rating}>
                      {rating} / 5
                    </option>
                  ))}
                </select>
                {fieldError(key) && <p className="field-error">{fieldError(key)}</p>}
              </div>
            ))}
          </div>

          <div>
            <label className="label" htmlFor="review-comment">
              Comment <span className="text-zinc-500">(optional)</span>
            </label>
            <textarea
              id="review-comment"
              className="textarea"
              rows={4}
              maxLength={1000}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="How were payouts, leads and support?"
            />
            {fieldError("comment") && (
              <p className="field-error">{fieldError("comment")}</p>
            )}
          </div>

          <div>
            <button type="submit" disabled={busy} className="btn btn-primary">
              {busy ? "Saving…" : "Submit review"}
            </button>
          </div>
        </form>
      )}

      {eligibility.code === "ok" && hasExisting && (
        <p className="border-t border-zinc-800 pt-4 text-xs text-zinc-500">
          You&apos;ve already reviewed this offer — one review per member.
        </p>
      )}

      {eligibility.code !== "ok" && (
        <p className="border-t border-zinc-800 pt-4 text-xs text-zinc-500">
          {RATING_COPY[eligibility.code]}
        </p>
      )}
    </section>
  );
}
