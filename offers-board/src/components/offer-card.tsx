import Link from "next/link";
import type { Offer } from "@/lib/store";

const ROLE_LABEL: Record<Offer["role_type"], string> = {
  setter: "Setter",
  closer: "Closer",
  both: "Full cycle",
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** "Northwind Growth" → "NG", "Palewood" → "P". */
export function monogram(company: string): string {
  const words = company.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "—";
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

export function isNewThisWeek(createdAt: string): boolean {
  const created = new Date(createdAt).getTime();
  return Number.isFinite(created) && Date.now() - created < WEEK_MS;
}

/**
 * The board card. Commission is the thing people compare, so it gets the
 * display face and the only coloured figure on the card.
 */
export function OfferCard({ offer }: { offer: Offer }) {
  const fresh = isNewThisWeek(offer.created_at);

  return (
    <Link
      href={`/offers/${offer.id}`}
      className="card card-link group flex flex-col p-5 sm:p-6"
    >
      <div className="flex items-start gap-4">
        <span className="monogram" aria-hidden="true">
          {monogram(offer.company)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] uppercase tracking-[0.22em] text-paper/90">
            {offer.company}
          </p>
          <p className="eyebrow mt-1.5">{ROLE_LABEL[offer.role_type]} role</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {offer.featured ? (
            <span className="rounded-full bg-ember px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.2em] text-ink">
              Featured
            </span>
          ) : null}
          {fresh ? (
            <span className="pill border-paper/25 py-0.5 text-paper/70">
              New this week
            </span>
          ) : null}
        </div>
      </div>

      <h2 className="mt-6 font-display text-2xl leading-[1.15] transition group-hover:text-ember">
        {offer.title}
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

      <div className="mt-auto flex items-center justify-between gap-4 border-t border-line pt-4 font-mono text-[10px] uppercase tracking-[0.22em] text-mute">
        <span className="truncate">{offer.pay_type}</span>
        <span className="shrink-0 text-paper opacity-0 transition group-hover:opacity-100">
          Open →
        </span>
      </div>
    </Link>
  );
}
