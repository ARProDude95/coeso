import Link from "next/link";
import { formatDate, formatRelative, pluralise } from "@/lib/format";
import {
  OFFER_STATUS_LABELS,
  ROLE_TYPE_LABELS,
  type OfferWithCounts,
} from "@/lib/types";

const STATUS_CLASS: Record<string, string> = {
  open: "badge badge-open",
  paused: "badge badge-paused",
  closed: "badge badge-closed",
};

export function OfferCard({ offer }: { offer: OfferWithCounts }) {
  const expiresIn = offer.expiresAt
    ? `Expires ${formatDate(offer.expiresAt)}`
    : "No expiry";

  return (
    <article className="panel flex flex-col gap-3 p-5 transition-colors hover:border-zinc-700">
      <div className="flex flex-wrap items-center gap-2">
        <span className={STATUS_CLASS[offer.status]}>
          {OFFER_STATUS_LABELS[offer.status]}
        </span>
        {offer.featured && <span className="badge badge-featured">Featured</span>}
        <span className="badge badge-neutral">{ROLE_TYPE_LABELS[offer.roleType]}</span>
        {offer.partnerId && (
          <span
            className="badge badge-verified"
            title="Submitted by a verified Coeso partner"
          >
            Verified Partner
          </span>
        )}
        {offer.requiredRole && (
          <span
            className="badge badge-accent"
            title="Only members holding this role can see this offer"
          >
            {offer.requiredRole}
          </span>
        )}
        <span className="ml-auto text-xs text-zinc-500">
          {formatRelative(offer.createdAt)}
        </span>
      </div>

      <div>
        <h2 className="text-base font-semibold leading-6 text-zinc-50">
          <Link href={`/offers/${offer.id}`} className="hover:text-indigo-300">
            {offer.title}
          </Link>
        </h2>
        <p className="mt-0.5 text-sm text-zinc-400">{offer.company}</p>
      </div>

      <p className="line-clamp-2 text-sm leading-6 text-zinc-400">
        {offer.description}
      </p>

      <dl className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-zinc-800 pt-3 text-xs text-zinc-400">
        <div className="flex items-center gap-1.5">
          <dt className="text-zinc-500">Pay</dt>
          <dd className="font-medium text-zinc-300">{offer.payType}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="text-zinc-500">Commission</dt>
          <dd className="font-medium text-zinc-300">{offer.commission}</dd>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span>{pluralise(offer.applicationCount, "applicant")}</span>
          <span className={offer.status === "closed" ? "text-zinc-500" : ""}>
            {expiresIn}
          </span>
        </div>
      </dl>
    </article>
  );
}
