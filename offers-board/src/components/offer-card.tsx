"use client";

import Link from "next/link";
import { ROLE_LABELS, isNewThisWeek, monogram } from "@/lib/offer-format";
import type { Offer } from "@/lib/store";

/**
 * Board card. The title link stretches over the whole card, and the two
 * controls sit above it so the card stays one big target without nesting
 * buttons inside an anchor.
 */
export function OfferCard({
  offer,
  applied = false,
  shortlisted,
  compared,
  compareDisabled,
  onToggleShortlist,
  onToggleCompare,
}: {
  offer: Offer;
  /** The member already has an application for this offer. */
  applied?: boolean;
  shortlisted: boolean;
  compared: boolean;
  compareDisabled: boolean;
  onToggleShortlist: (id: string) => void;
  onToggleCompare: (id: string) => void;
}) {
  const fresh = isNewThisWeek(offer.created_at);

  return (
    <article className="card card-link group relative flex flex-col p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <span className="monogram" aria-hidden="true">
          {monogram(offer.company)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] uppercase tracking-[0.22em] text-paper/90">
            {offer.company}
          </p>
          <p className="eyebrow mt-1.5">{ROLE_LABELS[offer.role_type]} role</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {offer.featured ? (
            <span className="rounded-full bg-ember px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.2em] text-ink">
              Featured
            </span>
          ) : null}
          {applied ? (
            <span className="pill border-ember/50 py-0.5 text-ember">
              ✓ Applied
            </span>
          ) : null}
          {fresh ? (
            <span className="pill border-paper/25 py-0.5 text-paper/70">
              New this week
            </span>
          ) : null}
        </div>
      </div>

      <h2 className="mt-6 font-display text-2xl leading-[1.15]">
        <Link
          href={`/offers/${offer.id}`}
          className="transition group-hover:text-ember after:absolute after:inset-0 after:content-['']"
        >
          {offer.title}
        </Link>
      </h2>

      <div className="mt-6 border-t border-line pt-5">
        <p className="eyebrow">Commission</p>
        <p className="mt-2 font-display text-2xl leading-[1.1] tracking-tight text-ember sm:text-[1.9rem]">
          {offer.commission}
        </p>
      </div>

      <p className="mt-5 line-clamp-2 text-sm leading-relaxed text-mute">
        {offer.description}
      </p>

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-4">
        <span className="truncate font-mono text-[10px] uppercase tracking-[0.22em] text-mute">
          {offer.pay_type}
        </span>
        <div className="relative z-10 flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => onToggleShortlist(offer.id)}
            aria-pressed={shortlisted}
            aria-label={
              shortlisted
                ? `Remove ${offer.title} from shortlist`
                : `Shortlist ${offer.title}`
            }
            title={shortlisted ? "Remove from shortlist" : "Shortlist"}
            className={`pill px-2 py-1 text-[13px] leading-none tracking-normal ${
              shortlisted ? "border-ember text-ember" : ""
            }`}
          >
            {shortlisted ? "★" : "☆"}
          </button>
          <button
            type="button"
            onClick={() => onToggleCompare(offer.id)}
            aria-pressed={compared}
            disabled={!compared && compareDisabled}
            aria-label={
              compared
                ? `Remove ${offer.title} from comparison`
                : `Add ${offer.title} to comparison`
            }
            className={`pill px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-40 ${
              compared ? "pill-active" : ""
            }`}
          >
            {compared ? "Comparing" : "Compare"}
          </button>
        </div>
      </div>
    </article>
  );
}
