import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireMember } from "@/lib/auth";
import { getRepRating, listDealsForUser } from "@/lib/deals";
import { formatRelative } from "@/lib/format";
import { initials } from "@/lib/initials";
import { monthLabel } from "@/lib/leaderboard";
import { earningsVisible, summariseDeals } from "@/lib/reps";
import { OFFER_STATUS_LABELS } from "@/lib/types";
import { getUserByUsername } from "@/lib/users";

export const metadata: Metadata = {
  title: "Rep profile",
};

function Stat({
  label,
  value,
  caption,
}: {
  label: string;
  value: string | number;
  caption?: string;
}) {
  return (
    <div className="panel p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <p className="mt-1.5 text-3xl font-semibold text-zinc-50">{value}</p>
      {caption && <p className="mt-1 text-xs text-zinc-500">{caption}</p>}
    </div>
  );
}

async function RepProfile({ username }: { username: string }) {
  const ctx = await requireMember();
  const user = await getUserByUsername(username);
  if (!user) notFound();

  const [deals, rating] = await Promise.all([
    listDealsForUser(user.id),
    getRepRating(user.id),
  ]);
  const totals = summariseDeals(deals);
  const showEarnings = earningsVisible(
    user.hide_earnings === 1,
    ctx.user,
    user.id,
  );
  const isOwner = ctx.user.id === user.id;

  return (
    <div className="flex flex-col gap-6">
      <header className="panel flex flex-wrap items-center gap-4 p-6">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-700 text-lg font-semibold text-zinc-100">
          {initials(user.name)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
            {user.name}
          </h1>
          <p className="text-sm text-zinc-500">
            @{user.username ?? username} · member since{" "}
            {formatRelative(user.created_at)}
          </p>
        </div>
        {isOwner && (
          <Link href="/deals" className="btn btn-secondary">
            Edit my deals
          </Link>
        )}
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Deals closed"
          value={totals.totalDeals}
          caption={`${totals.confirmedDeals} partner-confirmed`}
        />
        <Stat label="Offers worked" value={totals.offersWorked} />
        <Stat
          label="Partner rating"
          value={rating === null ? "—" : rating.toFixed(1)}
          caption={rating === null ? "no reviews yet" : "average offer rating"}
        />
        <Stat
          label="Earnings"
          value={
            !showEarnings
              ? "Hidden"
              : totals.earningsMin === null && totals.earningsMax === null
                ? "Not shared"
                : `$${(totals.earningsMin ?? 0).toLocaleString()}–$${(
                    totals.earningsMax ?? 0
                  ).toLocaleString()}`
          }
          caption={showEarnings ? "range across logged offers" : "private"}
        />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Offers worked
        </h2>
        {deals.length === 0 ? (
          <div className="panel px-6 py-10 text-center">
            <p className="text-sm text-zinc-400">
              No results logged yet.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {deals.map((deal) => (
              <li
                key={deal.id}
                className="panel flex flex-wrap items-center gap-3 p-5"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/offers/${deal.offer.id}`}
                    className="text-sm font-semibold text-zinc-100 hover:text-indigo-300"
                  >
                    {deal.offer.title}
                  </Link>
                  <p className="text-xs text-zinc-500">
                    {deal.offer.company} · {monthLabel(deal.month)} ·{" "}
                    {OFFER_STATUS_LABELS[deal.offer.status]}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="badge badge-neutral">
                    {deal.dealsClosed} closed
                  </span>
                  {deal.partnerConfirmedAt && (
                    <span className="badge badge-open">Partner confirmed</span>
                  )}
                  {showEarnings &&
                    (deal.earningsMin !== null ||
                      deal.earningsMax !== null) && (
                      <span className="badge badge-accent">
                        ${(deal.earningsMin ?? 0).toLocaleString()}–$
                        {(deal.earningsMax ?? 0).toLocaleString()}
                      </span>
                    )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function RepProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  return (
    <Suspense fallback={<div className="skeleton h-96 w-full" />}>
      <RepProfileSlot params={params} />
    </Suspense>
  );
}

async function RepProfileSlot({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  return <RepProfile username={username} />;
}
