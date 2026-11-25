import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { OfferCard } from "@/components/offer-card";
import { OfferFilters } from "@/components/offer-filters";
import { requireMember } from "@/lib/auth";
import { listOffers } from "@/lib/offers";
import { loadViewer } from "@/lib/roles";
import { parseFilters } from "@/lib/validation";

export const metadata: Metadata = {
  title: "Offers",
};

function ListSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="skeleton h-52 w-full" />
      ))}
    </div>
  );
}

function FiltersFallback() {
  return <div className="skeleton h-10 w-full" />;
}

async function OffersList({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireMember();
  const viewer = await loadViewer(ctx.user);
  const filters = parseFilters(await searchParams);
  const offers = await listOffers(filters, viewer);

  if (offers.length === 0) {
    return (
      <div className="panel flex flex-col items-center gap-3 px-6 py-14 text-center">
        <p className="text-sm font-medium text-zinc-200">No offers match those filters</p>
        <p className="max-w-sm text-sm text-zinc-500">
          Try a different role type or status, or clear the search to see
          everything currently on the board.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {offers.map((offer) => (
        <OfferCard key={offer.id} offer={offer} />
      ))}
    </div>
  );
}

export default function OffersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
            Offers board
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Open setter and closer roles from the Coeso network. Featured
            offers are pinned to the top.
          </p>
        </div>
        <Link href="/applications" className="btn btn-secondary">
          My applications
        </Link>
      </div>

      <Suspense fallback={<FiltersFallback />}>
        <OfferFilters />
      </Suspense>

      <Suspense fallback={<ListSkeleton />}>
        <OffersList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
